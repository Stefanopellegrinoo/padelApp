import Link from 'next/link'
import { redirect } from 'next/navigation'
import { serverClient } from '@/db/client'
import { claimSeat } from './actions'

interface PageProps {
  params: Promise<{ token: string }>
  searchParams: Promise<{ selected?: string; error?: string }>
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
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
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-text">
        <h1 className="text-2xl font-extrabold">Este link no es válido</h1>
        <p className="text-muted">Pedile al organizador que te pase el link de nuevo.</p>
        <Link href="/" className="mt-4 font-semibold text-accent-link">
          Volver al inicio
        </Link>
      </main>
    )
  }

  const first = seats[0]
  if (first === undefined) throw new Error('unreachable: seats.length ya se verificó arriba')

  // Ya tiene lugar en este torneo: is_participant lo confirma solo, vía RLS —
  // si `entries` le devuelve una fila de esta temporada es porque ya es
  // participante (admin o asiento reclamado), y si no, RLS le filtra todo.
  const { data: myEntries } = await supabase
    .from('entries')
    .select('id')
    .eq('season_id', first.season_id)
    .limit(1)
  if (myEntries !== null && myEntries.length > 0) {
    redirect('/')
  }

  const selectedSeat = seats.find((seat) => seat.entry_id === selected && !seat.claimed) ?? null

  return (
    <main className="flex min-h-screen flex-col gap-5 bg-bg px-6 pt-4 pb-6 text-text">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-extrabold text-muted">Te invitaron a</p>
        <h1 className="text-3xl font-extrabold tracking-tight">{first.season_name}</h1>
        <p className="text-sm text-muted">
          {seats.length} jugadores · organiza {first.admin_name}
        </p>
      </div>

      <p className="text-xs font-extrabold text-muted">¿Cuál sos vos?</p>

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
                <span className="flex-1 text-[15px] font-semibold">{seat.display_name}</span>
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
              <span className={`flex-1 text-[15px] ${isSelected ? 'font-extrabold' : 'font-semibold'}`}>
                {seat.display_name}
              </span>
              {isSelected && <span className="text-[11.5px] font-extrabold text-up">Sos vos</span>}
            </Link>
          )
        })}
      </div>

      {claimError !== undefined && <p className="text-sm font-bold text-live">{claimError}</p>}

      <div className="mt-auto flex flex-col gap-3">
        {selectedSeat !== null ? (
          <form action={claimSeat}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="entryId" value={selectedSeat.entry_id} />
            <button
              type="submit"
              className="w-full rounded-field bg-accent p-4 text-center font-extrabold text-accent-text"
            >
              Entrar como {selectedSeat.display_name}
            </button>
          </form>
        ) : (
          <button
            type="button"
            disabled
            className="w-full rounded-field bg-chip p-4 text-center font-extrabold text-muted"
          >
            Elegí tu nombre
          </button>
        )}
        <p className="text-center text-xs text-muted">
          Si tu nombre no está o ya lo tomó otro, avisale a {first.admin_name}.
        </p>
      </div>
    </main>
  )
}
