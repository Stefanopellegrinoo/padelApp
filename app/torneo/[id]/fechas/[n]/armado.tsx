'use client'

import { useState, useTransition } from 'react'
import { MAX_PLAYERS, MIN_PLAYERS } from '@/core'
import { initials } from '@/app/format'
import {
  confirmMatchday,
  drawPairs,
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

export interface GuestVM {
  entryId: string
  name: string
  /** El asiento con el que está trabado, o `null` si juega con el que toque. */
  partnerId: string | null
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
  guest: GuestVM | null
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
export function Armado({ seasonId, matchdayId, matchdayNumber, seats, guest, pairs }: ArmadoProps) {
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
  // La paridad se mide sobre el PLANTEL, no sobre el total con invitado: para
  // cuando esta pantalla se dibuja, `syncGuestSeat` ya agregó el asiento, y
  // contarlo dejaría el número siempre par y la línea de "son impares" no se
  // vería nunca — que es justo la que explica por qué apareció la tarjeta.
  //
  // ponytail: queda un caso que esto no dibuja — número par con un invitado ya
  // nombrado, que `syncGuestSeat` conserva a propósito. Ahí el panel dice un
  // número y la fecha tiene otro; lo agarra `assertMatchdaySize` al generar,
  // con su mensaje, y se sale borrándole el nombre al invitado.
  const isOdd = confirmed % 2 !== 0
  // El invitado es el que empareja el número, así que el tamaño de la fecha no
  // es la cuenta de tildes: es esa cuenta redondeada para arriba al par.
  const size = isOdd ? confirmed + 1 : confirmed

  // El bloqueo de "pocos" arranca en 7 y no en 8: con 7 confirmados la app suma
  // el invitado y la fecha queda de 8, que es el mínimo. La frase habla del
  // tamaño de la fecha, no de cuántos tildaste.
  const tooFew = confirmed < MIN_PLAYERS - 1
  const tooMany = confirmed > MAX_PLAYERS
  const guestUnnamed = guest !== null && guest.name.trim().length === 0

  const canDraw = !tooFew && !tooMany && !pending
  const canConfirm = canDraw && pairs.length > 0 && !guestUnnamed

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-card border border-line bg-surface p-4">
        <p className="text-center text-[32px] font-extrabold leading-none">{confirmed} confirmados</p>
        {isOdd ? (
          <p className="mt-2 rounded-field bg-warn-bg px-3 py-2 text-center text-[12.5px] font-bold">
            Son impares. Se suma 1 invitado y la fecha queda de {confirmed + 1}.
          </p>
        ) : (
          <p className="mt-2 text-center text-[12.5px] font-[600] text-muted">
            La fecha es de {size} · {size / 2} parejas
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
            className={`flex items-center gap-3 rounded-field border border-line bg-surface p-3 text-left ${
              seat.playing ? '' : 'opacity-50'
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

      {guest !== null && (
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
      )}

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
        className={`rounded-field border-[1.5px] bg-surface p-[15px] text-[15px] font-[750] outline-none ${
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
