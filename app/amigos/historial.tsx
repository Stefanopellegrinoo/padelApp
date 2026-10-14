import type { CasualMatch, SharedMatch, TournamentMatch } from '@/db/friends'
import { matchdayDay } from '@/app/format'
import { DISCIPLINE_LABELS } from '@/app/torneos/nuevo/wizard-state'
import { CasualMatchRow } from './[playerId]/cargar'

export interface HistorialProps {
  nombre: string
  /**
   * El id del amigo de esta pantalla -- Task 4 lo necesita para Editar/Borrar
   * (`CasualMatchRow`, `[playerId]/cargar.tsx`): el formulario de edición
   * manda un `friendPlayerId` oculto, y borrar redirige a
   * `/amigos/{friendPlayerId}`, no a la lista. No hace falta para las filas
   * de torneo, pero `HistorialProps` es una sola interfaz para las dos clases.
   */
  friendPlayerId: string
  /**
   * Ya viene en el orden en que se tiene que dibujar -- `historyWith`
   * (`db/friends.ts`) mezcla torneo y casual y ordena por fecha descendente
   * entre las dos fuentes (`porFechaDescendente`, ahí). Este componente NO
   * vuelve a ordenar: dos comparadores sobre la misma regla es la forma en
   * que un día divergen y dos pantallas terminan en desacuerdo sobre el
   * mismo historial.
   */
  partidos: readonly SharedMatch[]
}

type Resultado = NonNullable<TournamentMatch['outcome']>

// De compañeros el resultado es el de LA PAREJA ("ganaron"); enfrentados es
// el TUYO contra él ("ganaste") -- diseño §4.4, y es lo que separa un
// partido de dobles de uno 1v1 sin necesitar un campo aparte.
const VERBOS_JUNTOS: Record<Resultado, string> = { won: 'Ganaron', lost: 'Perdieron', drew: 'Empataron' }
const VERBOS_CONTRA: Record<Resultado, string> = { won: 'Ganaste', lost: 'Perdiste', drew: 'Empataste' }

// Reusa `matchdayDay` (`app/format.ts`), la misma fecha que ya se lee en
// Fechas, la tarjeta de próxima fecha y Mis torneos -- no hay motivo para que
// el historial invente un cuarto formato de fecha en la app.
function fechaDe(partido: TournamentMatch): string {
  return partido.playedOn !== null ? matchdayDay(partido.playedOn) : `Fecha ${partido.matchdayNumber}`
}

// El copy dice el hecho ("Juntos: Ganaron 6-3"), nunca la forma cruda del
// dato ("outcome: won") -- es para quien juega, no para quien programa.
function resultadoDe(partido: TournamentMatch): string {
  const quien = partido.together ? 'Juntos' : 'En contra'
  if (partido.outcome === null) return `${quien}: todavía sin resultado`
  const verbo = (partido.together ? VERBOS_JUNTOS : VERBOS_CONTRA)[partido.outcome]
  const marcador = partido.score !== null ? ` ${partido.score.mine}-${partido.score.theirs}` : ''
  return `${quien}: ${verbo}${marcador}`
}

/**
 * El resultado de un partido casual, con el mismo prefijo que el torneo:
 * "Juntos: Ganaron 4-2" si el amigo jugó de TU lado (verbos de pareja), "En
 * contra: Perdiste 1-3" si no (verbos en segunda persona). El marcador son los
 * sets (PADEL, separados por espacio) o los goles (FIFA), en tu orientación.
 * §4.3 manda mostrar el HECHO: `winner_side` no se deduce del marcador, así
 * que con el marcador empatado y un ganador se lo nombra en vez de "Ganaste
 * 2-2": "En contra: 2-2 · Ganó Juan". Juntos no hay a quién nombrar, el verbo
 * de pareja alcanza: "Juntos: 2-2 · Perdieron".
 */
function resultadoCasualDe(partido: CasualMatch, nombreAmigo: string): string {
  const quien = partido.together ? 'Juntos' : 'En contra'
  const verbo = (partido.together ? VERBOS_JUNTOS : VERBOS_CONTRA)[partido.outcome]
  // PADEL: los sets en mi orientación; FIFA: los goles. Nunca los dos.
  const marcador =
    partido.sets !== null
      ? partido.sets.map((set) => `${set.mine}-${set.theirs}`).join(' ')
      : partido.score !== null
        ? `${partido.score.mine}-${partido.score.theirs}`
        : ''
  const marcadorEmpatado = partido.score !== null && partido.score.mine === partido.score.theirs
  if (marcadorEmpatado && partido.outcome !== 'drew') {
    const ganador = partido.outcome === 'won' || partido.together ? verbo : `Ganó ${nombreAmigo}`
    return `${quien}: ${marcador} · ${ganador}`
  }
  return `${quien}: ${marcador !== '' ? `${verbo} ${marcador}` : verbo}`
}

// "con Juan · vs Ana, Beto"; en 1v1 no hay compañero y se omite el "con".
function nombresDe(partido: CasualMatch): string {
  const con = partido.partners.length > 0 ? `con ${partido.partners.join(', ')} · ` : ''
  return `${con}vs ${partido.rivals.join(', ')}`
}

// El equipo con el que jugaste VOS -- el ejemplo del diseño (§4.4) sólo
// muestra ese lado ("jugaste con Boca"); el del amigo se guarda
// (`CasualMatch.teams.theirs`) pero no hace falta para leer el partido en tu
// propio historial.
function equipoDe(partido: CasualMatch): string | null {
  return partido.teams.mine !== null ? `jugaste con ${partido.teams.mine}` : null
}

// §3.2: dos datos y una línea, no un log de auditoría ni un historial de
// versiones -- eso sí sería sobreconstruir, dice el diseño con esas palabras.
// Si cargó y editó la misma persona, se dice una sola vez: dos líneas iguales
// apiladas es ruido, no información.
//
// La comparación es por ID (`createdById`/`updatedById`), NUNCA por nombre --
// review final de 2b, Important 2: `display_name` es texto libre sin
// `unique` (`players`, 0001_schema.sql), así que dos amigos DISTINTOS pueden
// compartir nombre. Comparar `createdBy === updatedBy` (los nombres)
// colapsaba ese caso exactamente en el momento en que §3.2 existe para
// evitarlo: "Juan cargó, editó Juan" (dos Juanes distintos) leía como que
// nadie tocó nada.
function autoriaDe(partido: CasualMatch): string {
  if (partido.createdById === partido.updatedById) return `Cargó ${partido.createdBy}`
  return `Cargó ${partido.createdBy} · editó ${partido.updatedBy}`
}

/**
 * El historial (torneo + casual) con un amigo, sin leer nada -- recibe
 * `SharedMatch[]` ya mezclado y ordenado por props (`historyWith`, Task 2).
 * Mismo reparto que `rules-body.tsx`: la página lee, esto dibuja.
 *
 * Una lista, no dos contadores (diseño §4.4: *"un historial para acordarte
 * bien de cada partido que jugaste"*). Cada fila trae su propio detalle --
 * `historyWith` ya lo entrega por partido, así que agregarlo de nuevo en un
 * número sería tirar la mitad del dato que se acaba de pagar por leer.
 */
export function Historial({ nombre, friendPlayerId, partidos }: HistorialProps) {
  return (
    <div className="flex flex-col gap-4">
      {partidos.length === 0 ? (
        // Estado vacío: dice qué falta, no dibuja una tabla sin filas.
        <p className="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">
          Todavía no jugaron ningún partido juntos.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {partidos.map((partido) => {
            if (partido.kind === 'tournament') {
              return (
                <div
                  key={partido.matchId}
                  className="flex flex-col gap-1 rounded-field border-[1.5px] border-line p-[14px]"
                >
                  <p className="text-[13.5px] font-[550] text-muted">
                    {/* Mismo mapa que ya usa el wizard de creación de torneos para
                        'PADEL' -> 'Pádel' (`DISCIPLINE_LABELS`, `app/torneos/nuevo/wizard-state.ts:102`)
                        -- mismo split que ya sigue `PublicFormat`/`DisciplineHeader`
                        (`db/read.ts:156-166`): la capa de datos tipa el literal, la
                        PANTALLA lo traduce a etiqueta con este mapa (acá; y en
                        `app/torneo/[id]/page.tsx:136`, `ajustes/page.tsx:132`,
                        `[disciplina]/ajustes/page.tsx:61`, `reglas/page.tsx:65,92`,
                        `ajustes/disciplinas.tsx:75,208`).
                        `db/read.ts` no traduce nada -- no importa `DISCIPLINE_LABELS`.
                        Sin cast: `partido.sport` ya es literal `'PADEL' | 'FIFA'`
                        (`db/friends.ts`), lo mismo que tipa `DisciplineKind`. */}
                    {fechaDe(partido)} · {DISCIPLINE_LABELS[partido.sport]} · torneo {partido.seasonName}
                  </p>
                  <p className="text-[15px] font-extrabold tracking-[-.02em]">{resultadoDe(partido)}</p>
                </div>
              )
            }

            const equipo = equipoDe(partido)
            return (
              <CasualMatchRow
                key={partido.matchId}
                friendPlayerId={friendPlayerId}
                partido={partido}
              >
                <p className="text-[13.5px] font-[550] text-muted">
                  {matchdayDay(partido.playedOn)} · {DISCIPLINE_LABELS[partido.sport]}
                </p>
                <p className="text-[15px] font-extrabold tracking-[-.02em]">
                  {resultadoCasualDe(partido, nombre)}
                  {equipo !== null ? `, ${equipo}` : ''}
                </p>
                <p className="text-[13.5px] font-[550] text-muted">{nombresDe(partido)}</p>
                <p className="text-[13.5px] font-[550] text-muted">{autoriaDe(partido)}</p>
              </CasualMatchRow>
            )
          })}
        </div>
      )}
    </div>
  )
}
