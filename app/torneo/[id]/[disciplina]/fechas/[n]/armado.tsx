'use client'

import { useOptimistic, useState, useTransition } from 'react'
import { MAX_PAIRING_POOL, minSquadFor, offerableFormats, type MatchdayFormat, type Duo, type SideSize } from '@/core'
import { initials } from '@/app/format'
import {
  addGuestPair,
  addLooseGuest,
  changeMatchdayFormat,
  confirmMatchday,
  drawPairs,
  removeGuestPair,
  removeLooseGuest,
  saveGuestName,
  setGuestPartner,
  toggleAttendance,
  type WriteResult,
} from './actions'
import {
  applySeatTick,
  drawRoom,
  guestPartnerAbsent,
  matchdayShape,
  parityGuestSeat,
  partnersTakenBy,
  type SeatVM,
} from './armado-state'
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

/**
 * Un grupo de la vista previa (S83, verify-report-pr21 #4004): a quiénes
 * dejaría `generatePairs` en este grupo si se confirmara la fecha con el
 * orden de HOY. `null` (no `[]`) cuando no hay vista previa que mostrar —
 * `page.tsx` no sabe repartir sin partidos generados, así que un array
 * vacío sería un reparto inventado, no la ausencia de uno.
 */
export interface GroupPreviewVM {
  number: number
  names: string[]
}

/**
 * El vocabulario de la disciplina. Un lado de uno no es "una pareja" y su
 * fecha no tiene "parejas invitadas": son jugadores invitados que juegan
 * solos, igual que todos.
 *
 * `drawNote` (W80, verify-report-pr21-cierre #4016): antes dependía SÓLO de
 * `sideSize`, nunca del `formato` elegido — con "N grupos + llave" elegido,
 * la vista previa de S83 ("Cómo quedan los grupos") dibujaba arriba un
 * reparto en grupos y esta nota, dos pantallazos más abajo, seguía
 * prometiendo "todos contra todos, en el orden de la tabla" (o el cruce de
 * defensores del pádel): la misma clase de contradicción que W55-W57.
 * `formato.qualifiersPerGroup` es literal en el texto — no un "2" fijo — para
 * que la nota se rompa sola si algún día deja de ser siempre 2 (`core/knockout.ts`,
 * `knockoutMatchups` hoy sólo arma cruces con 2 clasificados por grupo).
 *
 * S93 (verify-report-pre-contract #4026): el fix de W80 de arriba
 * REEMPLAZABA `base.drawNote` entero al elegir grupos. Para pádel
 * (`sideSize === 2`) esa nota base no habla de grupos: dice CÓMO SE ARMARON
 * las parejas que la lista de arriba muestra (defensores fijos, cruce de
 * tabla) — una pregunta distinta de CÓMO SE VAN A JUGAR, que es lo que la
 * nota de grupos contesta. Perder la primera al elegir grupos dejaba la
 * lista de parejas sin ninguna explicación. Para singles (`sideSize === 1`)
 * no hay paso de "armar parejas": la nota base y la de grupos contestan la
 * MISMA pregunta (cómo se arman los partidos), así que ahí sigue
 * reemplazando, como antes.
 *
 * S94 (verify-report-pre-contract #4026): `formato` puede cambiar DESPUÉS
 * de que el fixture YA se sorteó, sin volver a sortear (mismo estado
 * divergido que vigila C32 y que W86 cierra en la tabla del día) —
 * `formatDrifted` (calculado en `page.tsx` contra `detail.matches`, no
 * contra `formato` solo) dice si eso pasó. Prometer grupos sobre un
 * fixture que sigue siendo el de antes es la misma mentira que W86 cerró
 * del otro lado de la pantalla.
 */
function words(sideSize: SideSize, formato: MatchdayFormat, formatDrifted: boolean) {
  const base =
    sideSize === 1
      ? {
          sides: 'jugadores',
          guestSection: 'Jugadores invitados',
          guestNote:
            'Juegan solos, como todos, y no suman puntos para el campeonato. Entran de a dos.',
          addGuest: '+ Agregar 2 invitados',
          guestPairNoun: 'los dos invitados',
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
          guestPairNoun: 'la pareja invitada',
          draw: 'Generar parejas',
          drawn: 'Parejas',
          drawNote:
            'Los defensores quedan fijos. El resto se arma cruzando la tabla: 1° con último, 2° con anteúltimo, y así.',
        }

  if (formato.kind !== 'GROUPS_KNOCKOUT') return base

  const groupsNote = formatDrifted
    ? 'El formato cambió después de sortear: para jugar por grupos hay que volver a sortear la fecha.'
    : `Juegan por grupos: todos contra todos adentro de cada grupo, y los ${formato.qualifiersPerGroup} primeros de cada uno pasan a la llave.`

  return {
    ...base,
    drawNote: sideSize === 2 ? `${base.drawNote} ${groupsNote}` : groupsNote,
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
  /**
   * El techo de partidos de ESTA disciplina (`config.maxMatches`, con el
   * default de su `sideSize`). Viaja desde `page.tsx` porque el menú de
   * formatos es suyo: sin esto la pantalla ofrecía el techo por default y
   * `generatePairs` rechazaba después lo que la pantalla había ofrecido.
   */
  maxMatches: number
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
   * Los defensores del título, ya filtrados por la repetición: `null` cuando
   * no hay o cuando la gastaron. Es el mismo dato que dibuja el chip
   * "Defensora", y acá se usa para la cuenta de invitados que puede el sorteo
   * — `buildPairs` los saca del pool antes de sortear, así que no son
   * acompañantes disponibles.
   */
  defenders: Duo | null
  /**
   * Cuántos partidos ya tienen sets cargados. En DRAFT no siempre es cero:
   * `redraft_matchday` trae una fecha de OPEN a DRAFT sin borrar un solo
   * resultado. Sólo lo usa el aviso de "Borrar fecha", para nombrar lo que
   * realmente se pierde.
   */
  loadedResults: number
  /** El `matchdays.formato` guardado hoy (REQ-D8-1) — `ROUND_ROBIN` por default hasta que se elija otro. */
  formato: MatchdayFormat
  /**
   * `true` cuando `formato` es `GROUPS_KNOCKOUT` pero el fixture YA
   * sorteado no lo cubre (S94, verify-report-pre-contract #4026) — mismo
   * estado divergido que C32/W86, calculado en `page.tsx` contra
   * `detail.matches`, no contra `formato` solo.
   */
  formatDrifted: boolean
  /**
   * El reparto real en grupos (S83, verify-report-pr21 #4004), calculado en
   * `page.tsx` con las MISMAS funciones que `generatePairs` usa para armar
   * de verdad. `null` con `ROUND_ROBIN` elegido, o mientras el armado está
   * incompleto y `pairingContextFor` todavía no puede resolver un orden.
   */
  groupPreview: GroupPreviewVM[] | null
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
  maxMatches,
  matchdayNumber,
  seats,
  looseGuests,
  guestPairs,
  pairs,
  defenders,
  loadedResults,
  formato,
  formatDrifted,
  groupPreview,
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
  // `syncGuestSeat` en el servidor y no se adivina. Todo lo que mezcla esos
  // dos —`size`, `eventualSize`, la banda de paridad, y los avisos que salen
  // de `eventualSize` (`tooFew`, `tooManyToPair`)— puede leer un número que
  // no existe en ningún momento.
  //
  // Con 11 confirmados y un invitado sin nombre, tildar al 12° daba
  // `eventualSize` 13 y encendía "Son 12 y entran hasta 12" — el aviso plano
  // que existía antes de que docs/plan-piso-y-techo-del-plantel.md Task 3 lo
  // borrara. Era falso y además contradictorio consigo mismo. Nada derivado
  // del tamaño se muestra hasta que el servidor confirme.
  const sizeSettled = !seatPending
  // Toda la aritmética vive en `armado-state.ts`, condicionada por `sideSize`
  // acá estaba suelta con el 2 hardcodeado en las dos puntas, y por eso
  // una disciplina de a uno pedía un invitado para emparejar y mostraba media
  // pareja. Tiene test propio; adentro de esta pantalla no lo podía tener.
  const shape = matchdayShape({
    confirmed,
    looseGuests: looseGuests.length,
    guestPairs: guestPairs.length,
    sideSize,
    maxMatches,
    // El GUARDADO, no la sugerencia (W72): `matches` tiene que contar los
    // partidos del formato que ya está en la base, no asumir round robin.
    formato,
  })
  const { size, sides, matches, complete, needsLooseGuest, eventualSize, tooFew, tooManyToPair, suggestedFormat } =
    shape
  const label = words(sideSize, formato, formatDrifted)
  const guestUnnamed = [
    ...looseGuests.map((guest) => guest.name),
    ...guestPairs.flatMap((pair) => [pair.a.name, pair.b.name]),
  ].some((name) => name.trim().length === 0)

  // El asiento que la paridad EXIGE, y por eso el único sin cruz. La cuenta
  // vive en `armado-state.ts` y tiene test propio: decide qué se puede sacar y
  // qué no, y acá adentro no la podía tener.
  const requiredGuestSeat = parityGuestSeat(optimisticSeats, looseGuests.length)

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
  // cuenta vive en `armado-state.ts` y espeja a la del borde, defensores
  // incluidos: la pareja que defiende sale del pool antes del sorteo y no
  // acompaña a nadie.
  const { toTheDraw, freeSquad } = drawRoom(optimisticSeats, looseGuests, defenders)
  const guestsOutnumberSquad = toTheDraw > freeSquad

  // El compañero que el admin trabó y que después avisó que no va: el lock
  // sobrevive al destilde y `assertLocksArePlaying` rebota la fecha. Sin esto
  // el botón quedaba verde y el click volvía con "No pudimos guardar el
  // cambio. Probá de nuevo.", que no describe nada y no se arregla insistiendo.
  const someGuestPartnerAbsent = looseGuests.some((guest) =>
    guestPartnerAbsent(optimisticSeats, guest),
  )

  // La paridad nunca estuvo en `canDraw` y hasta ahora no hacía falta: nada
  // dejaba la fecha impar de a un asiento, porque la pareja invitada suma dos.
  // "+ Agregar invitado" suma UNO, así que un plantel par más un invitado da 11
  // y el botón tiene que apagarse en vez de rebotar con el mismo texto que la
  // banda ya muestra arriba.
  const canDraw =
    !tooFew &&
    !tooManyToPair &&
    eventualSize % 2 === 0 &&
    !guestsOutnumberSquad &&
    !someGuestPartnerAbsent &&
    !pending
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
            // grupos (REQ-D8-1, PR21), que es la salida a W32.
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
        // arriba: mientras el tilde vuela, `eventualSize`/`sides` puede leer
        // un número que no existe en ningún momento, y con él la lista de
        // ofrecidos podría prender y apagar botones sin que nada haya
        // cambiado de verdad todavía. `0` lados no ofrece ningún grupo
        // (`offerableFormats(0)` es sólo `ROUND_ROBIN`), así que el merge de
        // `SelectorDeFormato` con el `formato` guardado (W73) deja ver
        // exactamente lo mismo que antes de settear.
        sides={sizeSettled ? shape.sides : 0}
        maxMatches={shape.maxMatches}
        suggested={suggestedFormat}
        pending={pending}
        onChange={(next) => run(() => changeMatchdayFormat(seasonId, matchdayId, matchdayNumber, next))}
      />

      {/* S83 (verify-report-pr21 #4004): entre elegir "2 grupos + llave" y
          confirmar no había forma de ver quién cae en cada grupo — recién se
          sabía con la fecha ya armada, tarde para cambiar de opinión.
          `groupPreview` sale de `page.tsx` con las MISMAS funciones que
          `generatePairs` corre al confirmar, así que el reparto que se ve
          acá es el reparto real, no uno inventado. */}
      {groupPreview !== null && (
        <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
          <div className="flex flex-col gap-1">
            <h2 className={STEP_TITLE}>Cómo quedan los grupos</h2>
            <p className="text-[11.5px] font-[600] text-muted">
              Con el orden de hoy. Si cambia quién viene, puede cambiar el reparto.
            </p>
          </div>
          {groupPreview.map((group) => (
            <div key={group.number} className="flex flex-col gap-1.5">
              <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
                Grupo {group.number}
              </p>
              <p className="text-[13.5px] font-[650]">{group.names.join(' · ')}</p>
            </div>
          ))}
        </section>
      )}

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
            required={requiredGuestSeat}
            partnerAbsent={guestPartnerAbsent(optimisticSeats, guest)}
            toTheDraw={toTheDraw}
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
        <h2 className={`${STEP_TITLE} border-b border-line pb-2`}>{label.guestSection}</h2>

        {guestPairs.map((pair, index) => (
          <ParejaInvitada
            key={pair.lockId}
            pair={pair}
            position={guestPairs.length === 1 ? null : index + 1}
            pending={pending}
            pairNoun={label.guestPairNoun}
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

        {/* ponytail: `addGuestPair` no tiene guard de `pairSize` y suma los
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
          className="min-h-11 rounded-field border-[1.5px] border-line p-3 text-[13.5px] font-extrabold"
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
              {/* S85 (verify-report-pr21-cierre #4016): `w-4` (16px) recorta "10"/"11"/"12"
                  (18px medidos con Chromium real, Archivo 800) — sólo muerde con 10+
                  lados, la capacidad que abrió esta cadena. `w-5` (20px) los contiene
                  sin overflow, medido a 360 px y 390 px. */}
              <span className="w-5 shrink-0 text-[14px] font-extrabold text-muted">{index + 1}</span>
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
          con el `guestCount` que todavía no cambió — ver `sizeSettled` y el
          caso medido en la definición de `confirmed`, arriba en este mismo
          archivo: la misma staleness que hacía leer de más también puede
          hacer leer de menos, así que ninguno de los dos se muestra hasta
          que el servidor confirme. */}
      {/* `role="alert"` en los cinco: son los que apagan un botón, y aparecen
          por algo que el admin acaba de hacer. Sin anunciarlos, el botón se
          grisa y el lector de pantalla no dice por qué. La banda de paridad de
          arriba queda afuera a propósito: cambia con cada tilde y anunciarla
          sería ruido encima del ruido. */}
      {sizeSettled && tooFew && (
        <p role="alert" className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          Con {confirmed} no alcanza para armar una fecha. Hacen falta {minSquadFor(sideSize)}.
        </p>
      )}
      {/* Fix round 1 (Task 3): el techo de CPU del sorteo por fuerza bruta
          (`core/matchings.ts`, contra `MAX_PAIRING_POOL` de
          `core/constants.ts`) sigue en pie — sólo el de plantel se borró, y
          coincidían en 12 "de casualidad". Sin este aviso el botón quedaba
          habilitado y el sorteo se caía adentro de `core/` con un `Error`
          crudo en vez de un mensaje pensado para que alguien lo lea. */}
      {sizeSettled && tooManyToPair && (
        <p role="alert" className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          Con {confirmed} no se puede sortear: el máximo para armar parejas es {MAX_PAIRING_POOL}.
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

/**
 * S86 (verify-report-pr21-cierre #4016, decisión #4014 sobre el techo de
 * tres botones): con 12 lados a 360px, "Todos contra todos" envuelve en tres
 * renglones ("Todos" / "contra" / "todos") y fija la altura de toda la fila
 * de botones — sin overflow horizontal, y legible (medido con Chromium real,
 * fuente Archivo 800: `scrollWidth === innerWidth` en las dos anchuras).
 *
 * QUEDA ASÍ, decisión escrita: las dos alternativas baratas que se probaron
 * (medido con Chromium, el mismo layout — `flex gap-2` de tres `flex-1`
 * dentro de 320px útiles a 360px) cuestan más de lo que arreglan.
 * - **Achicar sólo la tipografía de este botón**: rompe la equivalencia
 *   visual de un `role="radiogroup"` — tres opciones mutuamente excluyentes
 *   con tamaños de letra distintos leen como si una pesara menos que las
 *   otras, justo lo que S81/W77 ya cuidaron con `aria-checked` en vez de
 *   apoyarse sólo en la clase.
 * - **Acortar el texto** ("Todos vs. todos"): sí baja la fila a dos líneas
 *   (medido: 71px → 56px), pero `formatoLabel` es el MISMO texto para el
 *   botón y para la leyenda "Sugerido:" (línea de abajo), así que cambiarlo
 *   tocaría 7+ asserts en dos archivos de test y la copia que el resto del
 *   código escribe siempre entera ("todos contra todos", en comentarios y en
 *   `core/knockout.ts`) — por 15px de fila, a cambio de una abreviatura que
 *   no está en ningún otro lado de la app.
 *
 * El techo de tres botones ya lo aceptó #4014; esto es sólo la primera vez
 * que se vio el wrinkle y se lo mide en vez de forzar un arreglo.
 */
const FORMATO_BOTON = 'flex-1 rounded-field border-[1.5px] p-3 text-[13.5px] font-extrabold'
const FORMATO_ELEGIDO = 'border-accent bg-accent text-accent-text'
const FORMATO_LIBRE = 'border-line'

/** "Todos contra todos" o "N grupos + llave" — el mismo texto para el botón y para la leyenda de "Sugerido". */
function formatoLabel(formato: MatchdayFormat): string {
  return formato.kind === 'ROUND_ROBIN' ? 'Todos contra todos' : `${formato.groups} grupos + llave`
}

/**
 * El selector de formato de la fecha (REQ-D8-1): "todos contra todos"
 * siempre, más un botón por CADA tamaño de grupo OFRECIBLE para `sides`
 * lados hoy (W75, verify-report-pr21 #4004 / decisión de Stefano en
 * `decisions/formatos-ofrecidos-en-el-armado`) — no un único botón que sólo
 * deja aceptar o rechazar la sugerencia. `offerableFormats` (`core/knockout.ts`)
 * es la fuente de qué grupos son ofrecibles: `ROUND_ROBIN` siempre, más cada
 * `groups ∈ {2, 4}` donde CADA grupo tenga 3 lados o más — `groups = 1` no
 * se ofrece NUNCA (es el mismo round robin más un partido, no ahorra nada) y
 * un grupo de 2 tiene tasa de eliminación cero (pasan los dos).
 *
 * Exportado y afuera de `Armado` para poder RENDERIZARLO en la suite, mismo
 * precedente que `PanelGoles` (`./carga.tsx`) y `PasoFormato`
 * (`app/torneos/nuevo/wizard.tsx`): recibe `onChange` en vez de importar la
 * action, así que la suite no arrastra `next/headers` al renderizarlo.
 *
 * El `formato` YA GUARDADO se dibuja SIEMPRE, esté ofrecible hoy o no (W73,
 * verify-report-pr21 #4004): con 12 presentes el admin elige "4 grupos +
 * llave", bajan dos y `offerableFormats(10)` ya no lo incluye — eso no borra
 * el botón ni lo deja sin marcar, porque la base sigue armando con ese
 * formato hasta que alguien elija otro. Lo que NO hace es ofrecer un
 * `groups` nuevo que nadie propuso: un `formato` huérfano se agrega a la
 * lista ofrecida, no la reemplaza.
 *
 * `role="radiogroup"` + `role="radio"`/`aria-checked` por botón (S81,
 * verify-report-pr21 #4004): antes, "cuál está elegido" sólo se distinguía
 * por la clase de Tailwind (`FORMATO_ELEGIDO` vs `FORMATO_LIBRE`) — sin
 * ninguna señal semántica, un lector de pantalla no tenía forma de saber cuál
 * de los formatos está marcado. Es exactamente el patrón "radio group" de la
 * ARIA Authoring Practices para un conjunto de opciones mutuamente
 * excluyentes, sobre `<button>` en vez de `<input type="radio">` porque acá
 * no hay un `<form>` que serialice el valor — el estado lo maneja `onChange`.
 *
 * `suggested` (W77, verify-report-pr21-cierre #4016 / decisión #4022):
 * `suggestFormat` (`core/knockout.ts`) se había quedado sin consumidor de
 * producción, y con eso desaparecía de la pantalla el primer GIVEN de
 * REQ-D8-1 ("propone 2 grupos de 4"). La marca es una LEYENDA de texto
 * aparte (`Sugerido: …`), nunca una clase ni un `aria-checked` sobre el
 * botón — a propósito, para que no repita el error de S81: "sugerido" y
 * "elegido" son preguntas distintas y un lector de pantalla (o un test) no
 * tiene por qué confundirlas.
 *
 * La leyenda sólo se dibuja si `suggested` es de verdad una de las opciones
 * que este selector está mostrando (ofrecida hoy, o el `formato` guardado
 * como huérfano de W73) — nunca nombra un botón que no existe. `suggested`
 * llega con `eventualSize` (cuenta al invitado suelto que todavía no está
 * sentado, `armado-state.ts`) mientras que `sides` acá es el tamaño de HOY;
 * en el hueco donde los dos difieren, la leyenda calla en vez de mentir.
 */
export function SelectorDeFormato({
  formato,
  sides,
  maxMatches,
  suggested,
  pending,
  onChange,
}: {
  formato: MatchdayFormat
  /** Lados de HOY: de acá sale qué botones de grupos se ofrecen (`offerableFormats`), no de una sugerencia. */
  sides: number
  /** El techo de partidos de ESTA disciplina (`config.maxMatches`): con él se arma el menú. */
  maxMatches: number
  /** El formato que `suggestFormat` propone (REQ-D8-1) — se marca con una leyenda, no reemplaza los botones de #4014. */
  suggested: MatchdayFormat
  pending: boolean
  onChange: (formato: MatchdayFormat) => void
}) {
  const menu = offerableFormats(sides, maxMatches)
  const ofertados = menu.filter(
    (candidato): candidato is Extract<MatchdayFormat, { kind: 'GROUPS_KNOCKOUT' }> => candidato.kind === 'GROUPS_KNOCKOUT',
  )
  // El botón de todos contra todos estaba HARDCODEADO: se dibujaba siempre,
  // mientras los de grupos salían de `offerableFormats`. Con el techo de la
  // disciplina (`config.maxMatches`) dejó de ser incondicional —12 lados de a
  // uno son 66 partidos— así que ahora sale del menú como cualquier otro.
  //
  // Y NO lleva la escotilla de "mostralo igual si es el formato guardado" que
  // sí tiene `grupos` acá abajo, aunque parezca el mismo caso. No lo es: un
  // `GROUPS_KNOCKOUT` guardado es siempre una elección deliberada, mientras que
  // un `ROUND_ROBIN` guardado puede ser el DEFAULT DE COLUMNA (`0040`) que
  // nadie eligió. Con la escotilla, toda fecha recién creada ofrecía el botón
  // aunque el techo lo prohibiera —medido en el navegador— y `generatePairs` lo
  // rechazaba después: la pantalla ofreciendo lo que la base rebota, que es
  // exactamente el patrón de guards en serie de #3989.
  const ofreceRoundRobin = menu.some((candidato) => candidato.kind === 'ROUND_ROBIN')
  const grupos =
    formato.kind === 'GROUPS_KNOCKOUT' && !ofertados.some((candidato) => candidato.groups === formato.groups)
      ? [...ofertados, formato]
      : ofertados
  const suggestedIsShown =
    suggested.kind === 'ROUND_ROBIN' || grupos.some((candidato) => candidato.groups === suggested.groups)
  return (
    <section className="flex flex-col gap-2">
      <h2 className={`${STEP_TITLE} border-b border-line pb-2`}>Formato de la fecha</h2>
      {suggestedIsShown && (
        <p className="text-[11.5px] font-[600] text-muted">Sugerido: {formatoLabel(suggested)}</p>
      )}
      <div className="flex gap-2" role="radiogroup" aria-label="Formato de la fecha">
        {ofreceRoundRobin && (
          <button
            type="button"
            role="radio"
            aria-checked={formato.kind === 'ROUND_ROBIN'}
            disabled={pending}
            onClick={() => onChange({ kind: 'ROUND_ROBIN' })}
            className={`${FORMATO_BOTON} ${formato.kind === 'ROUND_ROBIN' ? FORMATO_ELEGIDO : FORMATO_LIBRE}`}
          >
            Todos contra todos
          </button>
        )}
        {grupos.map((candidato) => (
          <button
            key={candidato.groups}
            type="button"
            role="radio"
            aria-checked={formato.kind === 'GROUPS_KNOCKOUT' && formato.groups === candidato.groups}
            disabled={pending}
            onClick={() => onChange(candidato)}
            className={`${FORMATO_BOTON} ${
              formato.kind === 'GROUPS_KNOCKOUT' && formato.groups === candidato.groups ? FORMATO_ELEGIDO : FORMATO_LIBRE
            }`}
          >
            {candidato.groups} grupos + llave
          </button>
        ))}
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
  position,
  pending,
  pairNoun,
  onName,
  onRemove,
}: {
  pair: GuestPairVM
  /** `null` si es la única pareja invitada; si no, su número en la lista. */
  position: number | null
  pending: boolean
  /** "la pareja invitada" o "los dos invitados", según la aridad. */
  pairNoun: string
  onName: (entryId: string, name: string) => void
  onRemove: () => void
}) {
  const [focused, setFocused] = useState(false)

  // Con dos parejas en pantalla, cuatro campos "Nombre" y dos cruces "Sacar la
  // pareja invitada" quedaban indistinguibles para un lector de pantalla.
  const label = position === null ? pairNoun : `${pairNoun} ${position}`
  const named = [pair.a.name, pair.b.name].map((name) => name.trim()).filter((name) => name.length > 0)
  const removeLabel = named.length > 0 ? `Sacar a ${named.join(' y ')}` : `Sacar ${label}`

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
  /** El compañero elegido a mano no juega esta fecha: la fecha no se puede sortear así. */
  partnerAbsent: boolean
  /** Cuántos invitados van al sorteo en total, este incluido. Decide si "va último" o va al fondo con otros. */
  toTheDraw: number
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
 * `required` no aparece nunca: ver `parityGuestSeat` en `armado-state.ts`.
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
  partnerAbsent,
  toTheDraw,
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
        {/* Decía "Lo agregaste a mano" y eso es la PROCEDENCIA del asiento, que
            la pantalla no sabe: `required` sale de la paridad. Con 9
            confirmados la app agrega el asiento, el admin lo nombra, se baja
            otro y quedan 8 — `syncGuestSeat` lo conserva, `required` pasa a
            false y la tarjeta afirmaba que lo había puesto el admin. Separarlo
            de verdad pide una columna nueva en `entries` (ver
            `addLooseGuestSeat`), así que el texto dice lo que la pantalla SÍ
            sabe: si la paridad exige ese asiento, o si se lo puede llevar. */}
        <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
          {required ? 'Falta uno para armar parejas' : 'Lo podés sacar'}
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

        {/* El compañero trabado que después avisó que no va. El `<select>` de
            arriba filtra por `seat.playing`, así que muestra "El que salga en
            el sorteo" mientras este párrafo —que busca en `seats`, ausentes
            incluidos— afirmaba que los puntos los cobra alguien que no viene.
            La fecha además rebota: el lock sobrevive al destilde. */}
        {partnerAbsent ? (
          <p
            role="alert"
            className="rounded-field bg-live-bg px-3 py-2.5 text-[11.5px] font-bold text-live"
          >
            {partnerName ?? 'El compañero elegido'} no juega esta fecha. Elegile otro compañero, o
            dejalo al sorteo.
          </p>
        ) : (
          /* La diferencia que le cambia el campeonato al admin: un invitado
             suelto le hace cobrar puntos a su compañero del torneo, y una
             pareja invitada no le hace cobrar a ninguno de los dos. */
          <p className="text-[11.5px] font-[600] text-muted">
            Los puntos de la pareja los cobra{' '}
            {partnerName === null ? 'el que salga en el sorteo' : partnerName}. En una pareja
            invitada no cobra ninguno de los dos.
          </p>
        )}

        {/* Decía "Movelo si lo conocés" y no hay con qué: `orderPool` manda a
            los invitados al fondo del pool siempre, así que el control para
            moverlo no existe ni se puede construir (decisión registrada 2). Lo
            que sí se puede es elegirle compañero, que es el control de arriba.

            Sale sólo con el invitado librado al sorteo: con compañero elegido
            entra en `fixedPairs` y `resolveSettled` lo saca del pool ANTES de
            que exista un orden, así que no va último ni está en el sorteo — y
            "elegile compañero" le pedía lo que acababa de hacer.

            "Va último" es de a uno. Con varios al sorteo los tres decían lo
            mismo y sólo uno lo es: el ÚLTIMO de la lista es el que cae con el
            líder de la tabla (ver `PairingInput.guestIds`). */}
        {guest.partnerId === null && (
          <p className="text-[11.5px] font-[600] text-muted">
            {toTheDraw > 1
              ? 'Va al fondo del sorteo, con los otros invitados: nadie sabe cómo juegan. Si lo conocés, elegile compañero.'
              : 'Va último en el sorteo: nadie sabe cómo juega. Si lo conocés, elegile compañero.'}
          </p>
        )}
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
