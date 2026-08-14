import Link from 'next/link'
import { redirect } from 'next/navigation'
import { myEntryId } from '@/db/read'
import { serverClient } from '@/db/server'
import { claimSeat } from './actions'
import { initials } from '@/app/format'
import { SubmitButton } from '@/app/submit-button'

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
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-text">
        <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Este link no es válido</h1>
        <p className="text-[14px] font-[550] text-muted">
          Pedile al organizador que te pase el link de nuevo.
        </p>
        <Link href="/" className="mt-4 text-[12.5px] font-[750] text-accent-link">
          Volver al inicio
        </Link>
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
    <main className="flex min-h-dvh flex-col gap-5 bg-bg px-6 pt-4 pb-[26px] text-text">
      <div className="flex flex-col gap-1">
        <p className="text-[11.5px] font-extrabold text-muted">Te invitaron a</p>
        <h1 className="text-[32px] font-extrabold tracking-[-.03em]">{first.season_name}</h1>
        <p className="text-[14px] font-[550] text-muted">
          {seats.length} jugadores · organiza {first.admin_name}
        </p>
      </div>

      <p className="text-[11.5px] font-extrabold text-muted">¿Cuál sos vos?</p>

      <div className="flex flex-col gap-2">
        {seats.map((seat) => {
          if (seat.claimed) {
            return (
              <div
                key={seat.entry_id}
                className="flex items-center gap-3 rounded-field border border-line bg-surface p-3 opacity-45"
              >
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-chip text-[11px] font-extrabold">
                  {initials(seat.display_name)}
                </span>
                <span className="flex-1 text-[15px] font-[650]">{seat.display_name}</span>
                <span className="text-[11.5px] font-extrabold text-muted">Ya entró</span>
              </div>
            )
          }

          const isSelected = seat.entry_id === selected
          return (
            <Link
              key={seat.entry_id}
              href={`/unirse/${token}${isSelected ? '' : `?selected=${seat.entry_id}`}`}
              className={`flex items-center gap-3 rounded-field border p-3 ${
                isSelected ? 'border-[1.5px] border-accent bg-ok-bg' : 'border-line bg-surface'
              }`}
            >
              <span
                className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${
                  isSelected ? 'bg-accent text-accent-text' : 'bg-chip text-text'
                }`}
              >
                {initials(seat.display_name)}
              </span>
              <span className={`flex-1 text-[15px] ${isSelected ? 'font-extrabold' : 'font-[650]'}`}>
                {seat.display_name}
              </span>
              {isSelected && <span className="text-[11.5px] font-extrabold text-up">Sos vos</span>}
            </Link>
          )
        })}
      </div>

      {claimError !== undefined && <p className="text-[12px] font-bold text-live">{claimError}</p>}

      <div className="mt-auto flex flex-col gap-3">
        {selectedSeat !== null ? (
          <form action={claimSeat}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="entryId" value={selectedSeat.entry_id} />
            <SubmitButton className="w-full rounded-field bg-accent p-4 text-center text-[15px] font-extrabold text-accent-text">
              Entrar como {selectedSeat.display_name}
            </SubmitButton>
          </form>
        ) : (
          <button
            type="button"
            disabled
            className="w-full rounded-field bg-chip p-4 text-center text-[15px] font-extrabold text-muted"
          >
            Elegí tu nombre
          </button>
        )}
        <p className="text-center text-[12px] font-[550] text-muted">
          Si tu nombre no está o ya lo tomó otro, avisale a {first.admin_name}.
        </p>
      </div>
    </main>
  )
}
