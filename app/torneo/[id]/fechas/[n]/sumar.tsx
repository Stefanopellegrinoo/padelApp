'use client'

import { useState, useTransition } from 'react'
import { sumarInvitado } from './actions'
import type { GuestPromoteVM } from './sumar-state'

// `GuestPromoteVM` vive en `sumar-state.ts` —con la función que lo produce— y
// se re-exporta acá para que quien monta la pantalla traiga el componente y su
// VM del mismo lado: `page.tsx` importa los dos de `./sumar`, igual que hace
// con `Armado` y `SeatVM` (que vive en `armado-state.ts`) tres líneas antes.
export type { GuestPromoteVM }

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
              ? `${guest.name} jugó esta fecha en una pareja que no cobró puntos —lo habitual es que haya jugado con otro invitado—. Sumarlo desde acá le cambiaría los puntos a los demás, por eso no se puede: si va a jugar el torneo, agregalo al plantel desde Ajustes › Plantel.`
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
        // `setError(null)` también acá. No es un bug que se pueda mostrar hoy:
        // el único cierre con un error puesto es "Cancelar", que ya lo limpia
        // (el submit fallido deja la tarjeta ABIERTA, y no revalida). Es dónde
        // vive la invariante: "abrir la tarjeta empieza limpio" se cumple en
        // la apertura, en vez de depender de que cada cierre futuro se acuerde.
        onClick={() => {
          setError(null)
          setAsking(true)
        }}
        className="flex min-h-[44px] items-center justify-center rounded-field border-[1.5px] border-line p-3 text-center text-[13.5px] font-extrabold"
      >
        ¿{guest.name} se suma al torneo?
      </button>
    )
  }

  // Los puntos son los de la fila de `awards` de su compañero — la MISMA que
  // `promote_guest` copia. No una cuenta paralela: la tarjeta promete
  // exactamente lo que la escritura va a grabar.
  //
  // "Las demás fechas no se tocan" es cierto y no alcanzaba: juntas, esas dos
  // frases se leían como "no cambia nada más", y cambian DOS cosas medidas
  // sobre una temporada de 8 después de promover un suelto:
  //   asientos del plantel: 9   ·   config.squadSize: 8
  //   próximo sorteo con todos presentes: "Son 9 y sólo se juega de a pares."
  //   deshacer (removeSeat): rebota, "ya jugó alguna fecha"
  // El desajuste asiento/config es la decisión registrada 3 —agregar un
  // asiento no toca `squadSize` ni `points`— y todas las demás pantallas que
  // agregan asientos lo dicen (`ajustes/page.tsx:60-67`, con `validateConfig`).
  // Ésta era la única que no, y encima es la única cuya acción no se puede
  // deshacer desde ninguna pantalla.
  const copy = `Pasa a ser uno más del plantel y se lleva los ${guest.partnerPoints} puntos que le tocaron a su pareja en esta fecha. Las demás fechas no se tocan. El plantel queda con un asiento más del que dice Formato —hay que actualizarlo antes de sortear la próxima fecha— y esto no se deshace: como ya jugó ésta, Ajustes › Plantel no lo va a dejar sacar.`

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
