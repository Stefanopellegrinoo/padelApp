'use client'

import { useState, useTransition } from 'react'
import { sumarInvitado } from './actions'

/**
 * Los tres estados en los que puede estar un invitado de una fecha cerrada, y
 * son tres porque `promote_guest` (0014_promote_guest.sql) contesta tres cosas
 * distintas — no dos:
 *
 *   · `PUEDE`            su compañero tiene un award CONGELADO en esta fecha.
 *                        Es el único caso que la base acepta, y `partnerPoints`
 *                        son los puntos de esa fila de `awards` (no un
 *                        recálculo): exactamente lo que se le va a copiar.
 *   · `PAREJA_INVITADA`  jugó con otro invitado. Esa pareja quedó afuera del
 *                        reparto, y meterlo al plantel desde acá correría las
 *                        posiciones pagas de todos los demás. La base lo
 *                        refusa (spec 3.2).
 *   · `SIN_PAREJA`       nunca quedó adentro de una pareja de esta fecha
 *                        (spec 3.4). No hay nada suyo que conservar, y la base
 *                        también lo refusa.
 *
 * Es un union y no un `partnerPoints: number | null` porque `null` tapaba DOS
 * casos con un solo copy, y el copy afirmaba sólo uno de los dos: un invitado
 * que nunca jugó leía "jugó con otro invitado".
 */
export type GuestPromoteVM = { entryId: string; name: string } & (
  | { estado: 'PUEDE'; partnerPoints: number }
  | { estado: 'PAREJA_INVITADA' }
  | { estado: 'SIN_PAREJA' }
)

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
 * Y por el MISMO criterio, el botón tampoco aparece cuando el invitado no
 * tiene un award de compañero que copiar: desde esta fecha `promote_guest` lo
 * va a refusar SIEMPRE, así que ofrecer el botón es ofrecer un rebote seguro.
 * En su lugar va la explicación de por qué no se puede y qué hacer.
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
      {guests.map((guest) =>
        guest.estado === 'PUEDE' ? (
          <PromoteGuestCard key={guest.entryId} seasonId={seasonId} guest={guest} seats={seats} />
        ) : (
          <p key={guest.entryId} className="text-[11.5px] font-[600] text-muted">
            {guest.estado === 'PAREJA_INVITADA'
              ? `${guest.name} jugó esta fecha con otro invitado, así que esa pareja no cobró puntos. Sumarlo desde acá le cambiaría los puntos a los demás, por eso no se puede: si va a jugar el torneo, agregalo al plantel desde Ajustes › Plantel.`
              : `${guest.name} no quedó en ninguna pareja de esta fecha, así que no hay ningún punto suyo que conservar. Si va a jugar el torneo, agregalo al plantel desde Ajustes › Plantel.`}
          </p>
        ),
      )}
    </div>
  )
}

function PromoteGuestCard({
  seasonId,
  guest,
  seats,
}: {
  seasonId: string
  guest: Extract<GuestPromoteVM, { estado: 'PUEDE' }>
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

  // Los puntos son los de la fila de `awards` de su compañero — la MISMA que
  // `promote_guest` copia. No una cuenta paralela: la tarjeta promete
  // exactamente lo que la escritura va a grabar.
  const copy = `Pasa a ser uno más del plantel y se lleva los ${guest.partnerPoints} puntos que le tocaron a su pareja en esta fecha. Las demás fechas no se tocan.`

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
