'use client'

import { useState, useTransition } from 'react'
import { sumarInvitado } from './actions'

export interface GuestPromoteVM {
  entryId: string
  name: string
  /**
   * Los puntos que se llevó SU pareja en esta fecha, o `null` cuando no hay
   * nada que copiarle: la pareja era toda invitada (spec 3.2) o, por algún
   * motivo, el invitado nunca quedó en ninguna pareja de esta fecha (spec
   * 3.4). `promote_guest` decide lo mismo del lado de la base con un `join`
   * contra `awards`; esto es sólo la copia que necesita el copy de acá.
   */
  partnerPoints: number | null
}

export interface SumarSeatVM {
  entryId: string
  name: string
}

/**
 * Suma un invitado que ya jugó al plantel. `promote_guest` copia el award
 * congelado de su pareja y nunca recalcula (spec 3.1) — el copy de acá es
 * honesto sobre eso: dice qué puntos se lleva y de dónde salen, no promete
 * un recálculo que no existe.
 *
 * Sólo se monta en CLOSED (page.tsx): `promote_guest` rechaza cualquier fecha
 * que no lo esté, así que el botón nunca ofrece algo que va a fallar por
 * estado — mismo criterio que "Reabrir fecha" (`plantel.tsx:28-30`).
 *
 * Un `<PromoteGuestCard>` por invitado, cada uno con su propio `asking`:
 * puede haber dos a la vez (una pareja invitada entera, spec 3.2), y abrir
 * uno no tiene por qué cerrar ni compartir estado con el otro.
 */
export function SumarInvitado({
  seasonId,
  guests,
  seats,
}: {
  seasonId: string
  guests: GuestPromoteVM[]
  seats: SumarSeatVM[]
}) {
  if (guests.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {guests.map((guest) => (
        <PromoteGuestCard key={guest.entryId} seasonId={seasonId} guest={guest} seats={seats} />
      ))}
    </div>
  )
}

function PromoteGuestCard({
  seasonId,
  guest,
  seats,
}: {
  seasonId: string
  guest: GuestPromoteVM
  seats: SumarSeatVM[]
}) {
  const [asking, setAsking] = useState(false)
  const [before, setBefore] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="flex min-h-[44px] items-center justify-center rounded-field border-[1.5px] border-line p-3 text-center text-[13.5px] font-extrabold"
      >
        ¿{guest.name} se suma al torneo?
      </button>
    )
  }

  const copy =
    guest.partnerPoints === null
      ? 'Pasa a ser uno más del plantel. En esta fecha jugó con otro invitado, así que esa pareja no cobró y no hay puntos que sumarle.'
      : `Pasa a ser uno más del plantel y se lleva los ${guest.partnerPoints} puntos que le tocaron a su pareja en esta fecha. Las demás fechas no se tocan.`

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        // Mismo motivo que el alta de plantel (`plantel.tsx`): un Enter en el
        // select dispara el submit del form igual, y `pending` no lo cubre un
        // `disabled` solo — el handler es el último freno contra un doble alta.
        if (pending) return
        setError(null)
        startTransition(async () => {
          const result = await sumarInvitado(seasonId, guest.entryId, before === '' ? null : before)
          if (!result.ok) {
            setError(result.error)
            return
          }
          setAsking(false)
        })
      }}
      className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
    >
      <p className="text-[12.5px] font-bold">{copy}</p>

      <label className="flex items-center gap-2 text-[12.5px] font-bold">
        Posición
        {/* `min-h-[44px]` y `text-[16px]`: misma regla que el select de
            `plantel.tsx` — abajo de 16px iOS hace zoom solo al enfocar. */}
        <select
          value={before}
          disabled={pending}
          onChange={(event) => setBefore(event.target.value)}
          className="min-h-[44px] flex-1 rounded-field border border-line bg-surface p-[10px] text-[16px] font-bold outline-none"
        >
          <option value="">Al final</option>
          {seats.map((seat) => (
            <option key={seat.entryId} value={seat.entryId}>
              Antes de {seat.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className={`flex min-h-[44px] flex-1 items-center justify-center rounded-field p-3 text-center text-[14px] font-extrabold ${
            pending ? 'bg-chip text-muted' : 'bg-accent text-accent-text'
          }`}
        >
          Sumarlo al plantel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null)
            setAsking(false)
          }}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-field bg-chip p-3 text-center text-[14px] font-extrabold text-muted"
        >
          Cancelar
        </button>
      </div>

      {error !== null && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}
    </form>
  )
}
