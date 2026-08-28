'use client'

import { useOptimistic, useState, useTransition } from 'react'
import { MAX_PLAYERS, MIN_PLAYERS } from '@/core'
import { initials } from '@/app/format'
import {
  addGuestPair,
  addLooseGuest,
  confirmMatchday,
  drawPairs,
  removeGuestPair,
  removeLooseGuest,
  saveGuestName,
  setGuestPartner,
  toggleAttendance,
  type WriteResult,
} from './actions'
import { applySeatTick, drawRoom, partnersTakenBy, type SeatVM } from './armado-state'
import { BorrarFecha } from './borrar'

// `SeatVM` vive en `armado-state.ts` —con el reducer que lo usa— y se re-exporta
// acá porque `page.tsx` lo importa de esta pantalla desde antes.
export type { SeatVM }

/** Un invitado SUELTO: juega con alguien del torneo, y ese compañero sí cobra. */
export interface GuestVM {
  entryId: string
  name: string
  /** El asiento con el que está trabado, o `null` si va al sorteo. */
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
  /**
   * Uno o más: el que aparece cuando el plantel da impar, y los que el admin
   * suma a mano con "+ Agregar invitado" para tapar huecos que se abrieron
   * después de armada la fecha por equipos.
   */
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
  matchdayNumber,
  seats,
  looseGuests,
  guestPairs,
  pairs,
  loadedResults,
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
  const guestCount = looseGuests.length + guestPairs.length * 2
  // Mientras el tilde vuela, `confirmed` ya es el nuevo y `guestCount` sigue
  // siendo el viejo: el asiento del invitado lo decide `syncGuestSeat` en el
  // servidor y no se adivina. TODO lo que mezcla esos dos —`size`,
  // `eventualSize`, la banda de paridad, y los avisos de "no alcanza" / "entran
  // hasta N"— puede leer un número que no existe en ningún momento.
  //
  // Con 11 confirmados y un invitado sin nombre, tildar al 12° daba
  // `eventualSize` 13 y encendía "Son 12 y entran hasta 12" — falso y además
  // contradictorio consigo mismo. Nada derivado del tamaño se muestra hasta que
  // el servidor confirme.
  const sizeSettled = !seatPending
  // El tamaño de la fecha es el plantel confirmado MÁS los invitados: una pareja
  // invitada suma dos jugadores de verdad y el panel tiene que decirlo, o dice
  // "la fecha es de 8" con diez personas adentro.
  const size = confirmed + guestCount

  // La línea de "son impares" describe al invitado suelto que `syncGuestSeat`
  // agrega, y ése se decide por la paridad del PLANTEL: la pareja invitada suma
  // dos y no la cambia. Se muestra sólo cuando todavía no hay ningún suelto, que
  // es exactamente el momento que la frase explica.
  //
  // Queda un caso que esta línea no dibuja — plantel par con un invitado suelto
  // que `syncGuestSeat` conserva (ya nombrado) o que el admin acaba de agregar.
  // Ahí la fecha es impar y lo dice la rama de abajo, "Son N y sólo se juega de
  // a pares"; `canDraw` mira la paridad, así que además el botón queda apagado
  // en vez de rebotar con `assertMatchdaySize`. Se sale sacando al invitado,
  // borrándole el nombre, o sumándole una pareja.
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

  // El asiento que la paridad EXIGE, y por eso el único sin cruz: con el plantel
  // impar y un solo suelto, sacarlo es un no-op —`removeLooseGuestSeat` cierra
  // con `syncGuestSeat`, que lo repone en el acto— y una cruz que no hace nada
  // confunde igual que una que rompe. Con el plantel par, o con un segundo
  // suelto en pantalla, el asiento lo puso el admin y se lo puede llevar.
  const parityGuestSeat = confirmed % 2 !== 0 && looseGuests.length === 1

  // Los jugadores del torneo que ya están trabados con un invitado. Ofrecerlos
  // en el `<select>` de OTRO invitado es ofrecer algo que siempre rebota
  // ("Alguien está fijado en dos parejas a la vez"), el defecto que ya apareció
  // en "Reabrir fecha". Incluye al compañero propio: el filtro lo readmite
  // aparte, o el select no podría mostrar su propio valor.
  const partnersTaken = partnersTakenBy(looseGuests)

  // Cada invitado tiene las DOS opciones: compañero elegido a mano, o el
  // sorteo. Que varios vayan al sorteo es válido y está soportado — `orderPool`
  // los manda al fondo del pool y `buildPairs` empareja el fondo con la cabeza,
  // así que cada uno sale con un jugador del torneo DISTINTO mientras alcancen.
  //
  // Lo que no entra es que sean MÁS que los libres: ahí el pigeonhole obliga a
  // una pareja invitado-invitado y `assertSquadCoversLooseGuests` rebota la
  // fecha, así que el botón se apaga en vez de rebotar después del click. La
  // cuenta vive en `armado-state.ts` y espeja a la del borde.
  const { toTheDraw, freeSquad } = drawRoom(optimisticSeats, looseGuests)
  const guestsOutnumberSquad = toTheDraw > freeSquad

  // La paridad nunca estuvo en `canDraw` y hasta ahora no hacía falta: nada
  // dejaba la fecha impar de a un asiento, porque la pareja invitada suma dos.
  // "+ Agregar invitado" suma UNO, así que un plantel par más un invitado da 11
  // y el botón tiene que apagarse en vez de rebotar con el mismo texto que la
  // banda ya muestra arriba.
  const canDraw =
    !tooFew && !tooMany && eventualSize % 2 === 0 && !guestsOutnumberSquad && !pending
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
          ) : size % 2 === 0 ? (
            <p className="mt-2 text-center text-[12.5px] font-[600] text-muted">
              La fecha es de {size} · {size / 2} parejas
            </p>
          ) : (
            <p className="mt-2 rounded-field bg-warn-bg px-3 py-2 text-center text-[12.5px] font-bold">
              Son {size} y sólo se juega de a pares. Falta uno.
            </p>
          )}
        </div>
      </section>

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

      {/* El botón va acá, pegado a las tarjetas que crea. Vivía adentro de
          "Parejas invitadas", debajo del párrafo que dice que los invitados
          juegan juntos y no cobran — lo contrario de lo que hace un suelto— y
          la tarjeta que creaba aparecía arriba, fuera de la vista. */}
      <section className="flex flex-col gap-2">
        {looseGuests.map((guest, index) => (
          <GuestCard
            key={guest.entryId}
            guest={guest}
            seats={optimisticSeats}
            partnersTaken={partnersTaken}
            position={looseGuests.length === 1 ? null : index + 1}
            required={parityGuestSeat}
            pending={pending}
            onName={(name) =>
              run(() => saveGuestName(seasonId, matchdayId, matchdayNumber, guest.entryId, name))
            }
            onPartner={(partnerId) =>
              run(() =>
                setGuestPartner(seasonId, matchdayId, matchdayNumber, guest.entryId, partnerId),
              )
            }
            onRemove={() =>
              run(() => removeLooseGuest(seasonId, matchdayId, matchdayNumber, guest.entryId))
            }
          />
        ))}

        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => addLooseGuest(seasonId, matchdayId, matchdayNumber))}
          // `min-h-11` = 44px: `p-3` sobre 13.5px daba 42 y esta pantalla se usa
          // parado en el club, con el celular en una mano.
          className="min-h-11 rounded-field border-[1.5px] border-line p-3 text-[13.5px] font-extrabold"
        >
          + Agregar invitado
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={`${STEP_TITLE} border-b border-line pb-2`}>Parejas invitadas</h2>

        {guestPairs.map((pair, index) => (
          <ParejaInvitada
            key={pair.lockId}
            pair={pair}
            position={guestPairs.length === 1 ? null : index + 1}
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
          className="min-h-11 rounded-field border-[1.5px] border-line p-3 text-[13.5px] font-extrabold"
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

      {/* Los dos salen de `eventualSize`, que mezcla el `confirmed` optimista
          con el `guestCount` que todavía no cambió — ver `sizeSettled`. Sin esta
          guarda, tildar al 12° con un invitado sin nombre prendía "Son 12 y
          entran hasta 12" en rojo durante toda la espera. */}
      {/* `role="alert"` en los cuatro: son los que apagan un botón, y aparecen
          por algo que el admin acaba de hacer. Sin anunciarlos, el botón se
          grisa y el lector de pantalla no dice por qué. La banda de paridad de
          arriba queda afuera a propósito: cambia con cada tilde y anunciarla
          sería ruido encima del ruido. */}
      {sizeSettled && tooFew && (
        <p role="alert" className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          Con {confirmed} no alcanza para armar una fecha. Hacen falta {MIN_PLAYERS}.
        </p>
      )}
      {sizeSettled && tooMany && (
        <p role="alert" className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          Son {confirmed} y entran hasta {MAX_PLAYERS}. Con más, la fecha no termina nunca.
        </p>
      )}
      {/* No es "hay dos invitados al sorteo" —eso es válido y el sorteo los
          separa—, es que sean más que los jugadores del torneo que quedan
          libres. Nombra las TRES salidas porque las tres están en esta misma
          pantalla, a un scroll de distancia.

          Va detrás de `sizeSettled` por lo mismo que los dos de arriba:
          `freeSquad` sale del tilde optimista y `toTheDraw` del prop viejo, así
          que mientras el tilde vuela la comparación puede cruzar dos momentos
          distintos. `canDraw` sí lo mira siempre — apagar un botón de más es
          barato, un cartel rojo que miente no. */}
      {sizeSettled && guestsOutnumberSquad && (
        <p role="alert" className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          Hay {toTheDraw} invitados al sorteo y quedan {freeSquad} jugadores del torneo libres para
          acompañarlos. Elegiles compañero en “Juega con”, poné a los que sobran en una pareja
          invitada, o sacalos.
        </p>
      )}
      {guestUnnamed && pairs.length > 0 && (
        <p role="alert" className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          Ponele nombre al invitado antes de confirmar.
        </p>
      )}
      {error !== null && (
        <p role="alert" className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          {error}
        </p>
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

      <BorrarFecha seasonId={seasonId} matchdayId={matchdayId} loadedResults={loadedResults} />
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
  position,
  pending,
  onName,
  onRemove,
}: {
  pair: GuestPairVM
  /** `null` si es la única pareja invitada; si no, su número en la lista. */
  position: number | null
  pending: boolean
  onName: (entryId: string, name: string) => void
  onRemove: () => void
}) {
  const [focused, setFocused] = useState(false)

  // Con dos parejas en pantalla, cuatro campos "Nombre" y dos cruces "Sacar la
  // pareja invitada" quedaban indistinguibles para un lector de pantalla.
  const label = position === null ? 'la pareja invitada' : `la pareja invitada ${position}`
  const named = [pair.a.name, pair.b.name].map((name) => name.trim()).filter((name) => name.length > 0)
  const removeLabel = named.length > 0 ? `Sacar la pareja de ${named.join(' y ')}` : `Sacar ${label}`

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
        {[pair.a, pair.b].map((guest, index) => (
          <input
            key={guest.entryId}
            defaultValue={guest.name}
            placeholder="Nombre"
            aria-label={`Nombre del invitado ${index + 1} de ${label}`}
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
  /** Los del torneo ya trabados con algún invitado, el propio incluido. */
  partnersTaken: ReadonlySet<string>
  /** `null` si es el único invitado suelto; si no, su número en la lista. */
  position: number | null
  /** El asiento que la paridad exige: va sin cruz porque sacarlo lo repondría en el acto. */
  required: boolean
  pending: boolean
  onName: (name: string) => void
  onPartner: (partnerId: string | null) => void
  onRemove: () => void
}

/**
 * Un invitado suelto de la fecha. Va montado con `key={guest.entryId}` para
 * que el nombre a medio tipear se vaya con el asiento cuando `syncGuestSeat`
 * lo saca.
 *
 * El handoff dibuja acá un `⠿` y dos flechas para moverlo en el orden. Ese
 * control no se puede construir: `orderPool` manda a los invitados al final del
 * pool siempre, así que arrastrarlo no cambiaría nada (decisión registrada 2).
 * Lo que sí implementa el spec 2.6 es elegir con quién juega, y eso es lo que
 * hay acá.
 *
 * La cruz sigue el mismo patrón que `ParejaInvitada`: aparece cuando la
 * tarjeta pierde el foco, y sólo escucha sobre los campos —no sobre sí
 * misma— para no ocultarse al recibir el foco de su propio click. Con
 * `required` no aparece nunca: ver `parityGuestSeat` en `Armado`.
 *
 * Los textos hablan de UNA tarjeta o de varias: "El invitado" y "Falta uno
 * para armar parejas" se escribieron para el asiento único que pone
 * `syncGuestSeat`, y repetidos en dos tarjetas dejaban de ser ciertos.
 */
function GuestCard({
  guest,
  seats,
  partnersTaken,
  position,
  required,
  pending,
  onName,
  onPartner,
  onRemove,
}: GuestCardProps) {
  const [name, setName] = useState(guest.name)
  const [focused, setFocused] = useState(false)

  const heading = position === null ? 'El invitado' : `Invitado ${position}`
  const partnerName = seats.find((seat) => seat.entryId === guest.partnerId)?.name ?? null
  // Quién es esta tarjeta, para los controles que se repiten idénticos entre
  // tarjetas: sin esto, tres `<select>` seguidos se llaman los tres "Juega con"
  // y un lector de pantalla no los distingue.
  const who = guest.name.trim().length > 0 ? guest.name.trim() : heading
  const removeLabel =
    guest.name.trim().length > 0
      ? `Sacar a ${guest.name.trim()}`
      : position === null
        ? 'Sacar al invitado'
        : `Sacar al invitado ${position}`

  return (
    <section className="relative rounded-card border-[1.5px] border-dashed border-line bg-surface p-4">
      <div
        className="flex flex-col gap-2"
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return
          setFocused(false)
        }}
      >
        <h2 className={STEP_TITLE}>{heading}</h2>
        <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
          {required ? 'Falta uno para armar parejas' : 'Lo agregaste a mano'}
        </p>

        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name.trim() !== guest.name.trim()) onName(name)
          }}
          disabled={pending}
          // El campo no tiene `<label>` ni `placeholder`: el encabezado lo
          // nombra a la vista y nada lo nombraba para un lector de pantalla. Va
          // por posición y no por `who`, que acá sería el propio valor.
          aria-label={position === null ? 'Nombre del invitado' : `Nombre del invitado ${position}`}
          className={`rounded-field border-[1.5px] bg-surface p-[15px] text-[16px] font-[750] outline-none ${
            name.trim().length === 0 ? 'border-accent' : 'border-line'
          }`}
        />

        {/* Las dos opciones del invitado en un solo control: un nombre, o el
            sorteo. La consecuencia de puntos va DEBAJO porque cambia con lo que
            se elija acá — leerla antes es leerla sobre una elección que todavía
            no se hizo. */}
        <label className="flex items-center gap-2 text-[12.5px] font-bold">
          Juega con
          <select
            value={guest.partnerId ?? ''}
            disabled={pending}
            onChange={(event) => onPartner(event.target.value === '' ? null : event.target.value)}
            // Empieza con el texto visible de la etiqueta y sigue con quién es
            // esta tarjeta: así el nombre accesible contiene al visible (WCAG
            // 2.5.3) y además distingue un `<select>` del de al lado.
            aria-label={`Juega con — ${who}`}
            className="min-h-11 flex-1 rounded-field border border-line bg-surface p-[10px] text-[13.5px] font-bold outline-none"
          >
            {/* Es la opción "al sorteo", y tiene que decir qué va a pasar:
                "El que toque" no se leía como una opción, se leía como que
                todavía no se eligió nada. */}
            <option value="">El que salga en el sorteo</option>
            {seats
              // El que ya está trabado con OTRO invitado no se ofrece: elegirlo
              // rebota en el acto con "Alguien está fijado en dos parejas a la
              // vez". El compañero propio sí se ofrece, o el select no podría
              // mostrar su propio valor.
              .filter(
                (seat) =>
                  seat.playing &&
                  (seat.entryId === guest.partnerId || !partnersTaken.has(seat.entryId)),
              )
              .map((seat) => (
                <option key={seat.entryId} value={seat.entryId}>
                  {seat.name}
                </option>
              ))}
          </select>
        </label>

        {/* La diferencia que le cambia el campeonato al admin: un invitado
            suelto le hace cobrar puntos a su compañero del torneo, y una pareja
            invitada no le hace cobrar a ninguno de los dos. */}
        <p className="text-[11.5px] font-[600] text-muted">
          Los puntos de la pareja los cobra{' '}
          {partnerName === null ? 'el que salga en el sorteo' : partnerName}. En una pareja invitada
          no cobra ninguno de los dos.
        </p>

        {/* Decía "Movelo si lo conocés" y no hay con qué: `orderPool` manda a
            los invitados al fondo del pool siempre, así que el control para
            moverlo no existe ni se puede construir (decisión registrada 2). Lo
            que sí se puede es elegirle compañero, que es el control de arriba. */}
        <p className="text-[11.5px] font-[600] text-muted">
          Va último en el sorteo: nadie sabe cómo juega. Si lo conocés, elegile compañero.
        </p>
      </div>

      {!focused && !required && (
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
    </section>
  )
}
