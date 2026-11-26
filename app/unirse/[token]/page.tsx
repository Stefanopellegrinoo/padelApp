import Link from 'next/link'
import { redirect } from 'next/navigation'
import { myEntryId } from '@/db/read'
import { serverClient } from '@/db/server'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'
import { Picker } from './picker'

interface PageProps {
  params: Promise<{ token: string }>
  searchParams: Promise<{ selected?: string; error?: string }>
}

export default async function UnirsePage({ params, searchParams }: PageProps) {
  const { token } = await params
  const { selected, error: claimError } = await searchParams
  const supabase = await serverClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user === null) {
    redirect(`/registro?next=/unirse/${token}`)
  }

  const { data: seats, error } = await supabase.rpc('season_invite', { p_token: token })
  if (error !== null || seats === null || seats.length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-8 text-text">
        <Hero back={{ href: '/', label: 'Inicio' }} title="Este link no es válido" />
        <div className="flex flex-col gap-5 px-4 pt-6">
          <p className="text-[17px]">Pedile al organizador que te pase el link de nuevo.</p>
          <Link href="/" className={button('secondary', { size: 'lg', full: true })}>
            Volver al inicio
          </Link>
        </div>
      </main>
    )
  }

  const first = seats[0]
  if (first === undefined) throw new Error('unreachable: seats.length ya se verificó arriba')

  // Tener asiento es tener un `entries.player_id` propio, y nada más.
  //
  // Antes esto preguntaba si `entries` le devolvía ALGUNA fila de la temporada,
  // apoyándose en RLS para filtrar. Pero quien organiza ve el plantel entero
  // por ser admin, así que la pregunta le daba que sí sin haber reclamado nada
  // y este redirect lo sacaba de la única pantalla donde podía reclamar: el que
  // creaba el torneo no podía jugarlo. `claim_seat` nunca lo prohibió — sólo
  // pide que no tengas ya un asiento— era esta pantalla la que no lo dejaba
  // llegar.
  //
  // Al torneo, NO a la landing: el link se pega una vez en el grupo y se toca
  // muchas, así que todo el que ya reclamó vuelve a caer acá.
  if ((await myEntryId(supabase, first.season_id)) !== null) {
    redirect(`/torneo/${first.season_id}`)
  }

  const selectedSeat = seats.find((seat) => seat.entry_id === selected && !seat.claimed) ?? null

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg text-text">
      <Hero
        back={{ href: '/', label: 'Inicio' }}
        kicker="Te invitaron a"
        title={first.season_name}
        subtitle={`Organiza ${first.admin_name}`}
        right={
          <p className="pb-0.5">
            <span className="font-cond block text-[52px]">{seats.length}</span>
            <span className="text-[14px] text-on-block-soft">jugadores</span>
          </p>
        }
      />

      <Picker
        token={token}
        seats={seats}
        initialSelected={selectedSeat?.entry_id ?? null}
        claimError={claimError}
        adminName={first.admin_name}
      />
    </main>
  )
}
