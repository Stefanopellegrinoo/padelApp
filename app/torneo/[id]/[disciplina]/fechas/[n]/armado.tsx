'use client'

import { useOptimistic, useState, useTransition } from 'react'
import { MAX_PLAYERS, MIN_PLAYERS, type MatchdayFormat, type SideSize } from '@/core'
import { initials } from '@/app/format'
import {
  addGuestPair,
  changeMatchdayFormat,
  confirmMatchday,
  drawPairs,
  removeGuestPair,
  saveGuestName,
  setGuestPartner,
  toggleAttendance,
  type WriteResult,
} from './actions'
import { applySeatTick, matchdayShape, type SeatVM } from './armado-state'
import { BorrarFecha } from './borrar'

// `SeatVM` vive en `armado-state.ts` —con el reducer que lo usa— y se re-exporta
// acá porque `page.tsx` lo importa de esta pantalla desde antes.
export type { SeatVM }

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

/**
 * El vocabulario de la disciplina. Un lado de uno no es "una pareja" y su
 * fecha no tiene "parejas invitadas": son jugadores invitados que juegan
 * solos, igual que todos.
 */
function words(sideSize: SideSize) {
  return sideSize === 1
    ? {
        sides: 'jugadores',
        guestSection: 'Jugadores invitados',
        guestNote:
          'Juegan solos, como todos, y no suman puntos para el campeonato. Entran de a dos.',
        addGuest: '+ Agregar 2 invitados',
        removeGuest: 'Sacar los dos invitados',
        draw: 'Ordenar jugadores',
        drawn: 'Orden de la fecha',
        drawNote: 'Juegan todos contra todos, en el orden de la tabla.',
      }
    : {
        sides: 'parejas',
        guestSection: 'Parejas invitadas',
        guestNote:
          'Juegan juntos y no suman puntos para el campeonato: es un amistoso adentro de la fecha.',
        addGuest: '+ Agregar pareja invitada',
        removeGuest: 'Sacar la pareja invitada',
        draw: 'Generar parejas',
        drawn: 'Parejas',
        drawNote:
          'Los defensores quedan fijos. El resto se arma cruzando la tabla: 1° con último, 2° con anteúltimo, y así.',
      }
}

interface ArmadoProps {
  seasonId: string
  matchdayId: string
  /** El slug de la URL desde la que se abrió esta fecha — lo necesita `BorrarFecha` para volver a la lista correcta. */
  disciplina: string
  /**
   * Cuántas entries hacen un lado en ESTA disciplina. Sin esto la pantalla
   * hardcodeaba 2 en las dos puntas (S31): pedía un invitado para emparejar
   * donde no hay a quién emparejar, y dividía el plantel por 2.
   */
  sideSize: SideSize
  matchdayNumber: number
  /** El plantel en orden de siembra. Los invitados van aparte: son un asiento de esta fecha, no del torneo. */
  seats: SeatVM[]
  /** Como máximo uno: el que aparece cuando el plantel da impar. */
  looseGuests: GuestVM[]
  guestPairs: GuestPairVM[]
  pairs: DraftPairVM[]
  /**
   * Cuántos partidos ya tienen sets cargados. En DRAFT no siempre es cero:
   * `redraft_matchday` trae una fecha de OPEN a DRAFT sin borrar un solo
   * resultado. Sólo lo usa el aviso de "Borrar fecha", para nombrar lo que
   * realmente se pierde.
   */
  loadedResults: number
  /** El `matchdays.formato` guardado hoy (REQ-D8-1) — `ROUND_ROBIN` por default hasta que se elija otro. */
  formato: MatchdayFormat
}

const STEP_TITLE = 'text-[15px] font-extrabold tracking-[-.02em]'

/**
 * El armado de una fecha en `DRAFT`, que es la pantalla que el admin usa parado
 * en el club. Casi todo sigue siendo sólo dibujar e invocar: cada botón llama
 * a una action y espera la verdad del servidor.
 *
 * El tilde de asistencia es la excepción, a propósito: `optimisticSeats`
 * predice el asiento tocado apenas se toca, sin esperar el viaje a la base.
 * Lo que NO predice es el asiento del invitado — eso lo decide `syncGuestSeat`
 * en el servidor según la paridad del plantel, y adivinarlo es adivinar mal.
 * La banda de paridad se apaga mientras el tilde está en vuelo por la misma
 * razón: `confirmed` ya cambió pero `guestCount` todavía no, así que por
 * 300-500ms la cuenta puede leer "impar" sobre un tilde que en realidad
 * arregló la paridad. Mejor una banda ausente un instante que una mintiendo.
 */
export function Armado({
  seasonId,
  matchdayId,
  disciplina,
  sideSize,
  matchdayNumber,
  seats,
  looseGuests,
  guestPairs,
  pairs,
  loadedResults,
  formato,
}: ArmadoProps) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Predice el asiento tocado, no lo que el servidor decide a partir de él. El
  // reducer vive en `armado-state.ts` y tiene test propio: es absoluto y no un
  // toggle, y de eso depende que el tilde no se dé vuelta solo cuando React
  // reaplica las acciones pendientes sobre props nuevos.
  const [optimisticSeats, tickSeat] = useOptimistic(seats, applySeatTick)
  // Transición propia del tilde, separada de `pending`: así el tilde no dispara
  // el `disabled` compartido que grisa toda la pantalla, y este booleano sólo
  // se usa para apagar la banda de paridad mientras el tilde está en vuelo.
  const [seatPending, startSeatTransition] = useTransition()

  const run = (work: () => Promise<WriteResult>) => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await work()
        if (!result.ok) setError(result.error)
      } catch {
        // `inDraft` deja pasar cualquier error que no sea `EdgeError` (caída de
        // red, 500): sin este catch la promesa de la transición rechazaba sin
        // que nadie llamara a `setError`, y el control volvía a su estado
        // anterior sin ninguna explicación en pantalla. El admin parado en el
        // club con wifi del lugar es exactamente ese caso.
        setError('No pudimos guardar el cambio. Probá de nuevo.')
      }
    })
  }

  const tickAttendance = (seat: SeatVM) => {
    const playing = !seat.playing
    setError(null)
    startSeatTransition(async () => {
      tickSeat({ entryId: seat.entryId, playing })
      try {
        const result = await toggleAttendance(
          seasonId,
          matchdayId,
          matchdayNumber,
          seat.entryId,
          playing ? 'PLAYING' : 'ABSENT',
        )
        if (!result.ok) setError(result.error)
      } catch {
        setError('No pudimos guardar el tilde. Probá de nuevo.')
      }
    })
  }

  const confirmed = optimisticSeats.filter((seat) => seat.playing).length
  // Mientras el tilde vuela, `confirmed` ya es el nuevo y la cuenta de
  // invitados sigue siendo la vieja: el asiento del invitado lo decide
  // `syncGuestSeat` en el servidor y no se adivina. TODO lo que mezcla esos
  // dos —`size`, `eventualSize`, la banda de paridad, y los avisos de "no
  // alcanza" / "entran hasta N"— puede leer un número que no existe en ningún
  // momento.
  //
  // Con 11 confirmados y un invitado sin nombre, tildar al 12° daba
  // `eventualSize` 13 y encendía "Son 12 y entran hasta 12" — falso y además
  // contradictorio consigo mismo. Nada derivado del tamaño se muestra hasta que
  // el servidor confirme.
  const sizeSettled = !seatPending
  // Toda la aritmética vive en `armado-state.ts`, condicionada por `sideSize`
  //Acá estaba suelta con el 2 hardcodeado en las dos puntas, y por eso
  // una disciplina de a uno pedía un invitado para emparejar y mostraba media
  // pareja. Tiene test propio; adentro de esta pantalla no lo podía tener.
  const shape = matchdayShape({
    confirmed,
    looseGuests: looseGuests.length,
    guestPairs: guestPairs.length,
    sideSize,
  })
  const { size, sides, matches, complete, needsLooseGuest, eventualSize, tooFew, tooMany } = shape
  const label = words(sideSize)
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
        {/* `invisible` y no desmontar: el bloque mide unos 36px justo encima de
            la lista de asientos, así que sacarlo del layout hace saltar las
            filas bajo el dedo en el primer toque de una ráfaga y volver a
            bajarlas al asentarse. Ocultarlo reserva el lugar y no muestra nada
            —`visibility:hidden` tampoco lo lee un lector de pantalla—, que es
            lo que se busca: mejor una banda ausente un instante que una
            mintiendo. */}
        <div className={sizeSettled ? '' : 'invisible'}>
          {needsLooseGuest ? (
            <p className="mt-2 rounded-field bg-warn-bg px-3 py-2 text-center text-[12.5px] font-bold">
              Son impares. Se suma 1 invitado y la fecha queda de {eventualSize}.
            </p>
          ) : complete ? (
            // Los partidos se muestran porque son el costo real de la fecha, y
            // de a uno crecen distinto: 12 jugadores son 66 partidos donde 12
            // de a dos son 15. Ese número es el que hace pedir el formato de
            //Grupos (REQ-D8-1, PR21), que es la salida a W32.
            <p className="mt-2 text-center text-[12.5px] font-[600] text-muted">
              La fecha es de {size} · {sides} {label.sides} · {matches} partidos
            </p>
          ) : (
            <p className="mt-2 rounded-field bg-warn-bg px-3 py-2 text-center text-[12.5px] font-bold">
              Son {size} y sólo se juega de a pares. Falta uno.
            </p>
          )}
        </div>
      </section>

      <SelectorDeFormato
        formato={formato}
        // Gateado por `sizeSettled` por el mismo motivo que la banda de
        // arriba: mientras el tilde vuela, `eventualSize` puede leer un
        // número que no existe en ningún momento, y con él la sugerencia
        // podría prender y apagar el botón de grupos sin que nada haya
        // cambiado de verdad todavía.
        suggested={sizeSettled ? shape.suggestedFormat : formato}
        pending={pending}
        onChange={(next) => run(() => changeMatchdayFormat(seasonId, matchdayId, matchdayNumber, next))}
      />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
          <h2 className={STEP_TITLE}>Quién viene</h2>
          <span className="text-[12.5px] font-bold text-muted">
            {confirmed}/{seats.length}
          </span>
        </div>

        {optimisticSeats.map((seat) => (
          <button
            key={seat.entryId}
            type="button"
            // Sin `disabled`, a propósito: `setAttendance` escribe un estado
            // ABSOLUTO (no un toggle), así que un segundo toque mientras el
            // primero sigue en vuelo es inofensivo — como mucho el usuario
            // pidió lo mismo dos veces, o volvió al estado del que salió.
            // Next además serializa las Server Actions en orden de toque, así
            // que no hay escritura corriendo por delante de otra.
            onClick={() => tickAttendance(seat)}
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
              {/*Nota: `attendances` no guarda quién escribió la fila, así que
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
          seats={optimisticSeats}
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
        <h2 className={`${STEP_TITLE} border-b border-line pb-2`}>{label.guestSection}</h2>

        {guestPairs.map((pair) => (
          <ParejaInvitada
            key={pair.lockId}
            pair={pair}
            pending={pending}
            removeLabel={label.removeGuest}
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

        {/*Nota: `addGuestPair` no tiene guard de `pairSize` y suma los
            invitados de a DOS incluso donde no hay parejas — con `sideSize=1`
            el lock que los traba lo ignora `buildSides` entero (su propio
            comentario: "a constraint on a pairing that never happens
            constrains nothing"), así que quedan dos invitados jugando solos.
            No revienta y hoy es el ÚNICO camino para sumar un invitado a una
            fecha de a uno, así que el copy lo dice en vez de esconderlo. El
            arreglo real es una action de un invitado suelto; va en su propia
            rebanada, no acá. */}
        <p className="text-[11.5px] font-[600] text-muted">{label.guestNote}</p>

        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => addGuestPair(seasonId, matchdayId, matchdayNumber))}
          className="rounded-field border-[1.5px] border-line p-3 text-[13.5px] font-extrabold"
        >
          {label.addGuest}
        </button>
      </section>

      {pairs.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className={`${STEP_TITLE} border-b border-line pb-2`}>{label.drawn}</h2>
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
          <p className="text-[11.5px] font-[600] text-muted">{label.drawNote}</p>
        </section>
      )}

      {/* Los dos salen de `eventualSize`, que mezcla el `confirmed` optimista
          con el `guestCount` que todavía no cambió — ver `sizeSettled`. Sin esta
          guarda, tildar al 12° con un invitado sin nombre prendía "Son 12 y
          entran hasta 12" en rojo durante toda la espera. */}
      {sizeSettled && tooFew && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          Con {confirmed} no alcanza para armar una fecha. Hacen falta {MIN_PLAYERS}.
        </p>
      )}
      {sizeSettled && tooMany && (
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
          {pairs.length > 0 ? 'Regenerar' : label.draw}
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

      <BorrarFecha seasonId={seasonId} matchdayId={matchdayId} disciplina={disciplina} loadedResults={loadedResults} />
    </div>
  )
}

const FORMATO_BOTON = 'flex-1 rounded-field border-[1.5px] p-3 text-[13.5px] font-extrabold'
const FORMATO_ELEGIDO = 'border-accent bg-accent text-accent-text'
const FORMATO_LIBRE = 'border-line'

/**
 * El selector de formato de la fecha (REQ-D8-1): `suggestFormat` propone uno
 * — `matchdayShape.suggestedFormat`, arriba en `Armado` — y esto lo hace
 * EDITABLE: dos botones, el elegido queda marcado, tocar el otro lo cambia.
 *
 * Exportado y afuera de `Armado` para poder RENDERIZARLO en la suite, mismo
 * precedente que `PanelGoles` (`./carga.tsx`) y `PasoFormato`
 * (`app/torneos/nuevo/wizard.tsx`): recibe `onChange` en vez de importar la
 * action, así que la suite no arrastra `next/headers` al renderizarlo.
 *
 * Sólo dos botones, nunca tres: "Todos contra todos" siempre, y el de grupos
 * únicamente cuando `suggested` es `GROUPS_KNOCKOUT` — con un plantel chico
 * (`suggestFormat` da `ROUND_ROBIN`) no hay un `groups` sensato que ofrecer,
 * y `knockoutMatchups` sólo sabe armar G∈{1,2,4} de todas formas.
 */
export function SelectorDeFormato({
  formato,
  suggested,
  pending,
  onChange,
}: {
  formato: MatchdayFormat
  suggested: MatchdayFormat
  pending: boolean
  onChange: (formato: MatchdayFormat) => void
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className={`${STEP_TITLE} border-b border-line pb-2`}>Formato de la fecha</h2>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => onChange({ kind: 'ROUND_ROBIN' })}
          className={`${FORMATO_BOTON} ${formato.kind === 'ROUND_ROBIN' ? FORMATO_ELEGIDO : FORMATO_LIBRE}`}
        >
          Todos contra todos
        </button>
        {suggested.kind === 'GROUPS_KNOCKOUT' && (
          <button
            type="button"
            disabled={pending}
            onClick={() => onChange(suggested)}
            className={`${FORMATO_BOTON} ${formato.kind === 'GROUPS_KNOCKOUT' ? FORMATO_ELEGIDO : FORMATO_LIBRE}`}
          >
            {suggested.groups} grupos + llave
          </button>
        )}
      </div>
    </section>
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
  removeLabel,
  onName,
  onRemove,
}: {
  pair: GuestPairVM
  pending: boolean
  /** "Sacar la pareja invitada" o "Sacar los dos invitados", según la aridad. */
  removeLabel: string
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
          aria-label={removeLabel}
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
