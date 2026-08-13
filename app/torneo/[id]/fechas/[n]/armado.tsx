'use client'

import { useState, useTransition } from 'react'
import { MAX_PLAYERS, MIN_PLAYERS } from '@/core'
import { initials } from '@/app/format'
import {
  addGuestPair,
  confirmMatchday,
  drawPairs,
  removeGuestPair,
  saveGuestName,
  setGuestPartner,
  toggleAttendance,
  type WriteResult,
} from './actions'

export interface SeatVM {
  entryId: string
  name: string
  /** Sin fila de asistencia es `true`: el default es venir, y `seedAttendances` hace que la base opine lo mismo. */
  playing: boolean
}

/** Un invitado SUELTO: juega con alguien del torneo, y ese compañero sí cobra. */
export interface GuestVM {
  entryId: string
  name: string
  /** El asiento con el que está trabado, o `null` si juega con el que toque. */
  partnerId: string | null
}

/** Una pareja invitada: los dos juegan juntos y ninguno de los dos cobra. */
export interface GuestPairVM {
  lockId: string
  a: { entryId: string; name: string }
  b: { entryId: string; name: string }
}

export interface DraftPairVM {
  key: string
  names: string
  defending: boolean
  withGuest: boolean
}

interface ArmadoProps {
  seasonId: string
  matchdayId: string
  matchdayNumber: number
  /** El plantel en orden de siembra. Los invitados van aparte: son un asiento de esta fecha, no del torneo. */
  seats: SeatVM[]
  /** Como máximo uno: el que aparece cuando el plantel da impar. */
  looseGuests: GuestVM[]
  guestPairs: GuestPairVM[]
  pairs: DraftPairVM[]
}

const STEP_TITLE = 'text-[15px] font-extrabold tracking-[-.02em]'

/**
 * El armado de una fecha en `DRAFT`, que es la pantalla que el admin usa parado
 * en el club. Sólo dibuja e invoca: cada botón llama a una action, y toda la
 * verdad vuelve del servidor. No hay estado optimista, y es a propósito — el
 * asiento del invitado aparece y desaparece según la paridad, así que adivinar
 * el resultado de un tilde es adivinar mal.
 */
export function Armado({
  seasonId,
  matchdayId,
  matchdayNumber,
  seats,
  looseGuests,
  guestPairs,
  pairs,
}: ArmadoProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (work: () => Promise<WriteResult>) => {
    setError(null)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) setError(result.error)
    })
  }

  const confirmed = seats.filter((seat) => seat.playing).length
  const guestCount = looseGuests.length + guestPairs.length * 2
  // El tamaño de la fecha es el plantel confirmado MÁS los invitados: una pareja
  // invitada suma dos jugadores de verdad y el panel tiene que decirlo, o dice
  // "la fecha es de 8" con diez personas adentro.
  const size = confirmed + guestCount

  // La línea de "son impares" describe al invitado suelto que `syncGuestSeat`
  // agrega, y ése se decide por la paridad del PLANTEL: la pareja invitada suma
  // dos y no la cambia. Se muestra sólo cuando todavía no hay ningún suelto, que
  // es exactamente el momento que la frase explica.
  //
  // ponytail: queda un caso que esto no dibuja — plantel par con un invitado
  // suelto YA NOMBRADO, que `syncGuestSeat` conserva a propósito. Ahí la fecha
  // es impar; lo agarra `assertMatchdaySize` al generar, con su mensaje, y se
  // sale borrándole el nombre al invitado o sumándole una pareja.
  const needsLooseGuest = confirmed % 2 !== 0 && looseGuests.length === 0

  // Los bloqueos se miden sobre el tamaño que la fecha VA a tener, contando el
  // suelto que todavía no está. Por eso 7 confirmados no bloquea: van a ser 8.
  const eventualSize = size + (needsLooseGuest ? 1 : 0)
  const tooFew = eventualSize < MIN_PLAYERS
  const tooMany = eventualSize > MAX_PLAYERS
  const guestUnnamed = [
    ...looseGuests.map((guest) => guest.name),
    ...guestPairs.flatMap((pair) => [pair.a.name, pair.b.name]),
  ].some((name) => name.trim().length === 0)

  const canDraw = !tooFew && !tooMany && !pending
  const canConfirm = canDraw && pairs.length > 0 && !guestUnnamed

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-card border border-line bg-surface p-4">
        <p className="text-center text-[32px] font-extrabold leading-none">{confirmed} confirmados</p>
        {needsLooseGuest ? (
          <p className="mt-2 rounded-field bg-warn-bg px-3 py-2 text-center text-[12.5px] font-bold">
            Son impares. Se suma 1 invitado y la fecha queda de {eventualSize}.
          </p>
        ) : size % 2 === 0 ? (
          <p className="mt-2 text-center text-[12.5px] font-[600] text-muted">
            La fecha es de {size} · {size / 2} parejas
          </p>
        ) : (
          <p className="mt-2 rounded-field bg-warn-bg px-3 py-2 text-center text-[12.5px] font-bold">
            Son {size} y sólo se juega de a pares. Falta uno.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
          <h2 className={STEP_TITLE}>Quién viene</h2>
          <span className="text-[12.5px] font-bold text-muted">
            {confirmed}/{seats.length}
          </span>
        </div>

        {seats.map((seat) => (
          <button
            key={seat.entryId}
            type="button"
            disabled={pending}
            onClick={() =>
              run(() =>
                toggleAttendance(
                  seasonId,
                  matchdayId,
                  matchdayNumber,
                  seat.entryId,
                  seat.playing ? 'ABSENT' : 'PLAYING',
                ),
              )
            }
            // Opacity is reserved for "the system is working" (the global
            // `:disabled` rule). Resting states speak in color instead — the
            // "No viene" chip and the "Avisó que no va" line already carry
            // this state, so dimming the whole row here would also swallow
            // the `disabled:opacity-45` feedback on tap.
            className={`flex items-center gap-3 rounded-field border border-line bg-surface p-3 text-left ${
              seat.playing ? '' : 'text-muted'
            }`}
          >
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-chip text-[11px] font-extrabold text-muted">
              {initials(seat.name)}
            </span>
            <span className="flex flex-1 flex-col">
              <span className="text-[14.5px] font-bold">{seat.name}</span>
              {/* ponytail: `attendances` no guarda quién escribió la fila, así que
                  "avisó" es todo ausente. Si algún día importa distinguir al que
                  avisó del que sacó el admin, es una columna nueva. */}
              {!seat.playing && <span className="text-[11.5px] font-[600] text-muted">Avisó que no va</span>}
            </span>
            <span
              className={`shrink-0 rounded-full px-[10px] py-[6px] text-[10.5px] font-extrabold ${
                seat.playing ? 'bg-ok-bg text-up' : 'bg-chip text-muted'
              }`}
            >
              {seat.playing ? 'Viene' : 'No viene'}
            </span>
          </button>
        ))}
      </section>

      {looseGuests.map((guest) => (
        <GuestCard
          key={guest.entryId}
          guest={guest}
          seats={seats}
          pending={pending}
          onName={(name) =>
            run(() => saveGuestName(seasonId, matchdayId, matchdayNumber, guest.entryId, name))
          }
          onPartner={(partnerId) =>
            run(() => setGuestPartner(seasonId, matchdayId, matchdayNumber, guest.entryId, partnerId))
          }
        />
      ))}

      <section className="flex flex-col gap-2">
        <h2 className={`${STEP_TITLE} border-b border-line pb-2`}>Parejas invitadas</h2>

        {guestPairs.map((pair) => (
          <ParejaInvitada
            key={pair.lockId}
            pair={pair}
            pending={pending}
            onName={(entryId, name) =>
              run(() => saveGuestName(seasonId, matchdayId, matchdayNumber, entryId, name))
            }
            onRemove={() =>
              run(() =>
                removeGuestPair(
                  seasonId,
                  matchdayId,
                  matchdayNumber,
                  pair.a.entryId,
                  pair.b.entryId,
                ),
              )
            }
          />
        ))}

        <p className="text-[11.5px] font-[600] text-muted">
          Juegan juntos y no suman puntos para el campeonato: es un amistoso adentro de la fecha.
        </p>

        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => addGuestPair(seasonId, matchdayId, matchdayNumber))}
          className="rounded-field border-[1.5px] border-line p-3 text-[13.5px] font-extrabold"
        >
          + Agregar pareja invitada
        </button>
      </section>

      {pairs.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className={`${STEP_TITLE} border-b border-line pb-2`}>Parejas</h2>
          {pairs.map((pair, index) => (
            <div
              key={pair.key}
              className={`flex items-center gap-3 rounded-field border bg-surface p-3 ${
                pair.defending ? 'border-up' : 'border-line'
              }`}
            >
              <span className="w-4 shrink-0 text-[14px] font-extrabold text-muted">{index + 1}</span>
              <span className="flex-1 text-[14.5px] font-[750]">{pair.names}</span>
              {pair.defending && (
                <span className="shrink-0 rounded-full bg-ok-bg px-[10px] py-[6px] text-[10.5px] font-extrabold text-up">
                  Defensora
                </span>
              )}
              {pair.withGuest && (
                <span className="shrink-0 rounded-full bg-chip px-[10px] py-[6px] text-[10.5px] font-extrabold text-muted">
                  Invitado
                </span>
              )}
            </div>
          ))}
          <p className="text-[11.5px] font-[600] text-muted">
            Los defensores quedan fijos. El resto se arma cruzando la tabla: 1° con último, 2° con
            anteúltimo, y así.
          </p>
        </section>
      )}

      {tooFew && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          Con {confirmed} no alcanza para armar una fecha. Hacen falta {MIN_PLAYERS}.
        </p>
      )}
      {tooMany && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          Son {confirmed} y entran hasta {MAX_PLAYERS}. Con más, la fecha no termina nunca.
        </p>
      )}
      {guestUnnamed && pairs.length > 0 && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          Ponele nombre al invitado antes de confirmar.
        </p>
      )}
      {error !== null && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canDraw}
          onClick={() => run(() => drawPairs(seasonId, matchdayId, matchdayNumber))}
          className={`rounded-field p-4 text-[15px] font-extrabold ${
            pairs.length > 0 ? 'border-[1.5px] border-line' : 'flex-1 text-center'
          } ${!canDraw ? 'bg-chip text-muted' : pairs.length > 0 ? '' : 'bg-accent text-accent-text'}`}
        >
          {pairs.length > 0 ? 'Regenerar' : 'Generar parejas'}
        </button>

        {pairs.length > 0 && (
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => run(() => confirmMatchday(seasonId, matchdayId, matchdayNumber))}
            className={`flex-1 rounded-field p-4 text-center text-[15px] font-extrabold ${
              canConfirm ? 'bg-accent text-accent-text' : 'bg-chip text-muted'
            }`}
          >
            Confirmar fecha
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Una pareja invitada: dos nombres y la cruz para sacarla.
 *
 * La cruz aparece **cuando la tarjeta pierde el foco**, no mientras se escribe:
 * mientras estás tipeando los nombres, un botón de borrar al lado del campo es
 * lo último que querés tocar sin querer. El salto de un campo al otro no cuenta
 * como perder el foco — `relatedTarget` dice a dónde se fue, y si sigue adentro
 * de la tarjeta la cruz no aparece y no parpadea.
 */
function ParejaInvitada({
  pair,
  pending,
  onName,
  onRemove,
}: {
  pair: GuestPairVM
  pending: boolean
  onName: (entryId: string, name: string) => void
  onRemove: () => void
}) {
  const [focused, setFocused] = useState(false)

  return (
    <div className="relative rounded-card border-[1.5px] border-dashed border-line bg-surface p-4">
      {/* El foco se escucha SÓLO sobre los campos. La cruz queda afuera de esta
          región a propósito: adentro, al apretarla recibía el foco, eso la
          ocultaba a sí misma y el click no llegaba a dispararse nunca. */}
      <div
        className="flex flex-col gap-2"
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          // Saltar de un campo al otro no es perder el foco: si el destino
          // sigue adentro, la cruz no tiene que parpadear.
          if (event.currentTarget.contains(event.relatedTarget)) return
          setFocused(false)
        }}
      >
        {[pair.a, pair.b].map((guest) => (
          <input
            key={guest.entryId}
            defaultValue={guest.name}
            placeholder="Nombre"
            disabled={pending}
            onBlur={(event) => {
              if (event.target.value.trim() === guest.name.trim()) return
              onName(guest.entryId, event.target.value)
            }}
            className={`rounded-field border-[1.5px] bg-surface p-[15px] text-[15px] font-[750] outline-none placeholder:font-medium placeholder:text-muted ${
              guest.name.trim().length === 0 ? 'border-accent' : 'border-line'
            }`}
          />
        ))}
      </div>

      {!focused && (
        <button
          type="button"
          disabled={pending}
          onClick={onRemove}
          aria-label="Sacar la pareja invitada"
          className="absolute top-0 right-0 flex h-11 w-11 items-center justify-center"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-chip text-[15px] font-extrabold text-muted">
            ×
          </span>
        </button>
      )}
    </div>
  )
}

interface GuestCardProps {
  guest: GuestVM
  seats: SeatVM[]
  pending: boolean
  onName: (name: string) => void
  onPartner: (partnerId: string | null) => void
}

/**
 * El invitado de la fecha. Va montado con `key={guest.entryId}` para que el
 * nombre a medio tipear se vaya con el asiento cuando `syncGuestSeat` lo saca.
 *
 * El handoff dibuja acá un `⠿` y dos flechas para moverlo en el orden. Ese
 * control no se puede construir: `orderPool` manda a los invitados al final del
 * pool siempre, así que arrastrarlo no cambiaría nada (decisión registrada 2).
 * Lo que sí implementa el spec 2.6 es elegir con quién juega, y eso es lo que
 * hay acá.
 */
function GuestCard({ guest, seats, pending, onName, onPartner }: GuestCardProps) {
  const [name, setName] = useState(guest.name)

  return (
    <section className="flex flex-col gap-2 rounded-card border-[1.5px] border-dashed border-line bg-surface p-4">
      <h2 className={STEP_TITLE}>El invitado</h2>
      <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
        Falta uno para armar parejas
      </p>

      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (name.trim() !== guest.name.trim()) onName(name)
        }}
        disabled={pending}
        className={`rounded-field border-[1.5px] bg-surface p-[15px] text-[16px] font-[750] outline-none ${
          name.trim().length === 0 ? 'border-accent' : 'border-line'
        }`}
      />

      <p className="text-[11.5px] font-[600] text-muted">
        No suma puntos para el campeonato, pero su compañero sí.
      </p>

      <label className="flex items-center gap-2 text-[12.5px] font-bold">
        Juega con
        <select
          value={guest.partnerId ?? ''}
          disabled={pending}
          onChange={(event) => onPartner(event.target.value === '' ? null : event.target.value)}
          className="flex-1 rounded-field border border-line bg-surface p-[10px] text-[13.5px] font-bold outline-none"
        >
          <option value="">El que toque</option>
          {seats
            .filter((seat) => seat.playing)
            .map((seat) => (
              <option key={seat.entryId} value={seat.entryId}>
                {seat.name}
              </option>
            ))}
        </select>
      </label>

      <p className="text-[11.5px] font-[600] text-muted">
        Va último porque nadie sabe cómo juega. Movelo si lo conocés.
      </p>
    </section>
  )
}
