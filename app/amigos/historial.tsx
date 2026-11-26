import type { CasualMatch, SharedMatch, TournamentMatch } from '@/db/friends'
import { matchdayDay } from '@/app/format'
import { PARTIDA_ANOTADA } from '@/app/torneos/inicio/estado'
import { sportFamily, sportLabel } from '@/core'
import { CasualMatchRow } from './[playerId]/cargar'

export interface HistorialProps {
  nombre: string
  /**
   * El id del amigo de esta pantalla -- lo necesita `CasualMatchRow`
   * (`[playerId]/cargar.tsx`) para corregir y borrar: el formulario manda un
   * `friendPlayerId` oculto, y borrar redirige a `/amigos/{friendPlayerId}`,
   * no a la lista. No hace falta para las filas de torneo, pero
   * `HistorialProps` es una sola interfaz para las dos clases.
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
  /** `'amigos'` si al perfil se llegó desde la lista (`?desde=amigos`): borrar vuelve igual. */
  desde?: string
  /** Tu `players.id`: lo que cargaste vos (y nadie editó) no lleva la línea de autoría. */
  yo?: string
}

type Resultado = NonNullable<TournamentMatch['outcome']>

// De compañeros el resultado es el de LA PAREJA ("Ganaron"); enfrentados es
// el TUYO contra él ("Ganaste") -- diseño §4.4, y es lo que separa un
// partido de dobles de uno 1v1 sin necesitar un campo aparte.
const VERBOS_JUNTOS: Record<Resultado, string> = { won: 'Ganaron', lost: 'Perdieron', drew: 'Empataron' }
const VERBOS_CONTRA: Record<Resultado, string> = { won: 'Ganaste', lost: 'Perdiste', drew: 'Empataste' }

// Reusa `matchdayDay` (`app/format.ts`), la misma fecha que ya se lee en
// Fechas, la tarjeta de próxima fecha e Inicio. Una fecha de torneo sin
// jugar no tiene día: dice su número.
function fechaDe(partido: SharedMatch): string {
  if (partido.playedOn !== null) return matchdayDay(partido.playedOn)
  return partido.kind === 'tournament' ? `Fecha ${partido.matchdayNumber}` : ''
}

/**
 * La línea de debajo del marcador: el HECHO, en el color del resultado.
 * Siempre el verbo de la persona que corresponde ("Ganaron" juntos,
 * "Ganaste" enfrentados) -- salvo un caso, §4.3: `winner_side` no se deduce
 * del marcador, así que con el marcador empatado, un ganador y vos del lado
 * que perdió, se NOMBRA a quien ganó ("Ganó Juan"; en un 2v2 el otro lado son
 * dos y nombrar a uno solo sería afirmar de más: "Ganaron Juan, Beto"). Nunca
 * "por penales": la app no sabe que FIFA es fútbol.
 */
export function leyendaDe(partido: SharedMatch, nombreAmigo: string): string {
  if (partido.outcome === null) return 'Sin resultado'
  // En ajedrez el empate se llama tablas, de compañeros o enfrentados.
  if (partido.outcome === 'drew' && sportFamily(partido.sport) === 'result') return 'Tablas'
  const verbo = (partido.together ? VERBOS_JUNTOS : VERBOS_CONTRA)[partido.outcome]
  if (partido.kind === 'tournament') return verbo
  const marcadorEmpatado = partido.score !== null && partido.score.mine === partido.score.theirs
  if (marcadorEmpatado && partido.outcome === 'lost' && !partido.together) {
    return partido.rivals.length > 1 ? `Ganaron ${partido.rivals.join(' y ')}` : `Ganó ${nombreAmigo}`
  }
  return verbo
}

/** `nombres` sin UNA aparición de `nombre` -- la del amigo de la pantalla. */
function sinElAmigo(nombres: readonly string[], nombre: string): string[] {
  const index = nombres.indexOf(nombre)
  return index === -1 ? [...nombres] : [...nombres.slice(0, index), ...nombres.slice(index + 1)]
}

/**
 * Con quién jugaron, cuando hay algo que decir (un 2 vs 2). Juntos, el amigo
 * de la pantalla se saca (ya está en el encabezado): "contra Ana y Beto", o
 * "con Lucas, contra Ana y Beto" si eran más de tu lado. Enfrentados, el
 * plantel entero: "Vos y Cami contra Juan y Beto" se lee de un vistazo, y
 * partirlo en "tu pareja" y "su pareja" era una oración. Un 1 vs 1 en contra
 * son ustedes dos: no agrega nada y queda vacío.
 *
 * `CasualMatch` trae nombres, no ids, de los jugadores. Sacar UNA aparición
 * del nombre del lado donde jugó el amigo es correcto aunque haya otro
 * jugador homónimo en ese lado: lo que queda se lee igual.
 */
export function quienesDe(partido: CasualMatch, nombreAmigo: string): string {
  const y = (nombres: readonly string[]) => nombres.join(' y ')
  if (partido.together) {
    const otros = sinElAmigo(partido.partners, nombreAmigo)
    return `${otros.length > 0 ? `con ${y(otros)}, ` : ''}contra ${y(partido.rivals)}`
  }
  if (partido.partners.length === 0 && partido.rivals.length <= 1) return ''
  return `${y(['Vos', ...partido.partners])} contra ${y(partido.rivals)}`
}

// El equipo con el que jugaste VOS (§4.4: "jugaste con Boca"); el del amigo
// se guarda (`CasualMatch.teams.theirs`) pero no hace falta en tu historial.
function equipoDe(partido: CasualMatch): string | null {
  return partido.teams.mine !== null ? `con ${partido.teams.mine}` : null
}

// §3.2: dos datos y una línea, no un log de auditoría. La comparación es por
// ID, NUNCA por nombre -- `display_name` no es único (review final de 2b,
// Important 2): dos Fede distintos no pueden leerse como "nadie editó".
function autoriaDe(partido: CasualMatch, yo?: string): string | null {
  if (partido.createdById === partido.updatedById) {
    return partido.createdById === yo ? null : `Cargó ${partido.createdBy}`
  }
  return `Cargó ${partido.createdBy}, editó ${partido.updatedBy}`
}

export interface Registro {
  won: number
  lost: number
  drew: number
}

export interface Resumen {
  /** Todos los partidos de la lista, también los de torneo todavía sin resultado. */
  total: number
  /** De compañeros: el resultado de la pareja. */
  juntos: Registro
  /** Enfrentados: el TUYO contra él. */
  enContra: Registro
}

/**
 * El resumen del cara a cara, contado de la MISMA lista que se dibuja abajo
 * -- plan 2a, §4.4: "si querés conservar un resumen arriba de la lista, que
 * salga de la lista y no la reemplace". Cero consultas nuevas.
 */
export function resumenDe(partidos: readonly SharedMatch[]): Resumen {
  const juntos: Registro = { won: 0, lost: 0, drew: 0 }
  const enContra: Registro = { won: 0, lost: 0, drew: 0 }
  for (const partido of partidos) {
    if (partido.outcome === null) continue
    const registro = partido.together ? juntos : enContra
    registro[partido.outcome] += 1
  }
  return { total: partidos.length, juntos, enContra }
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

/** `"Octubre 2026"` -- el separador de la lista. Una fecha de torneo sin jugar no tiene mes. */
export function mesDe(playedOn: string | null): string {
  if (playedOn === null) return 'Sin fecha'
  const [year, month] = playedOn.split('-')
  return `${MESES[Number(month) - 1] ?? ''} ${year ?? ''}`
}

/**
 * Agrupa por mes los partidos CONSECUTIVOS, sin reordenar: el orden ya lo
 * decidió `historyWith` y acá no se vuelve a decidir.
 */
function porMes(partidos: readonly SharedMatch[]): { mes: string; partidos: SharedMatch[] }[] {
  return partidos.reduce<{ mes: string; partidos: SharedMatch[] }[]>((grupos, partido) => {
    const mes = mesDe(partido.playedOn)
    const ultimo = grupos[grupos.length - 1]
    if (ultimo !== undefined && ultimo.mes === mes) {
      return [...grupos.slice(0, -1), { mes, partidos: [...ultimo.partidos, partido] }]
    }
    return [...grupos, { mes, partidos: [partido] }]
  }, [])
}

/** El color del resultado, como en el prototipo: ganar en azul, perder en tinta. */
const TONO: Record<Resultado, string> = { won: 'text-up', lost: 'text-text', drew: 'text-text' }
const META = 'col-start-1 text-[14px] text-muted'

/** El marcador como se canta: los sets uno al lado del otro ("6-4 6-3"), o el número. */
export function marcadorDe(partido: SharedMatch): string | null {
  // Una partida de ajedrez se anota 1-0, 0-1 o ½-½: sale del resultado, no de un marcador (con
  // amigos no hay; en un torneo es el set 1-0 con que se guarda).
  if (sportFamily(partido.sport) === 'result' && partido.outcome !== null) return PARTIDA_ANOTADA[partido.outcome]
  const sets = partido.kind === 'casual' ? partido.sets : null
  if (sets !== null && sets.length > 0) return sets.map((set) => `${set.mine}-${set.theirs}`).join(' ')
  return partido.score === null ? null : `${partido.score.mine}-${partido.score.theirs}`
}

/**
 * Una fila (la `.game` del prototipo): arriba el resultado ("Ganaste", en
 * azul si ganaste) y a la derecha el marcador en la cara condensada; abajo,
 * en gris, el deporte en su color, el día y el torneo; en un casual, con
 * quiénes (2 vs 2), tu equipo y quién lo cargó. Datos, no oraciones.
 */
function Fila({ partido, nombre, yo }: { partido: SharedMatch; nombre: string; yo?: string }) {
  const tono = partido.outcome === null ? 'text-muted' : TONO[partido.outcome]
  const marcador = marcadorDe(partido)
  const fecha = fechaDe(partido)
  const extra =
    partido.kind === 'casual'
      ? [quienesDe(partido, nombre), equipoDe(partido), autoriaDe(partido, yo)].filter((x): x is string => x !== null && x !== '')
      : []
  return (
    <div className="grid min-h-[64px] grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 px-4 py-3">
      <p className={`col-start-1 text-[17px] font-bold ${tono}`}>{leyendaDe(partido, nombre)}</p>
      <p
        className={`font-cond col-start-2 row-span-2 row-start-1 text-right text-[30px] [word-spacing:4px] ${
          marcador === null ? 'text-muted' : 'text-text'
        }`}
      >
        {marcador ?? '–'}
      </p>
      <p className={META}>
        <span className="font-semibold text-sport">{sportLabel(partido.sport)}</span>
        {fecha !== '' && `, ${fecha}`}
        {partido.kind === 'tournament' && `, ${partido.seasonName}`}
      </p>
      {extra.map((linea, index) => (
        <p key={index} className={`${META} col-span-2`}>
          {linea}
        </p>
      ))}
    </div>
  )
}

/** "Ganaste 6-4 6-3": el nombre del botón que corrige una fila casual. */
function resumenFila(partido: SharedMatch, nombre: string): string {
  const marcador = marcadorDe(partido)
  return `${leyendaDe(partido, nombre)}${marcador === null ? '' : ` ${marcador}`}, ${sportLabel(partido.sport)}, ${fechaDe(partido)}`
}

/**
 * El historial (torneo + casual) con un amigo, sin leer nada -- recibe
 * `SharedMatch[]` ya mezclado y ordenado por props (`historyWith`). Mismo
 * reparto que `rules-body.tsx`: la página lee, esto dibuja. La página lo usa
 * dos veces: los partidos enfrentados y los de compañeros.
 *
 * Agrupada por mes (diseño §4.4: *"un historial para acordarte bien de cada
 * partido que jugaste"*); cada partido, una fila. Una fila casual se toca
 * para corregirla (`CasualMatchRow`). `historial.unit.test.ts` fija el texto
 * de cada `<p>` línea por línea.
 */
export function Historial({ nombre, friendPlayerId, partidos, desde, yo }: HistorialProps) {
  if (partidos.length === 0) {
    return <p className="px-4 py-3 text-[15px] text-muted">Sin partidos todavía</p>
  }

  return (
    <div className="flex flex-col">
      {porMes(partidos).map((grupo, index) => (
        <section key={`${grupo.mes}-${index}`}>
          <h3 className="px-4 pt-3 pb-1 text-[15px] font-semibold text-muted">{grupo.mes}</h3>
          <ul>
            {grupo.partidos.map((partido) =>
              partido.kind === 'tournament' ? (
                <li key={partido.matchId} data-deporte={partido.sport} className="border-t border-line first:border-t-0">
                  <Fila partido={partido} nombre={nombre} />
                </li>
              ) : (
                <CasualMatchRow
                  key={partido.matchId}
                  friendPlayerId={friendPlayerId}
                  partido={partido}
                  resumen={resumenFila(partido, nombre)}
                  desde={desde}
                  dataDeporte={partido.sport}
                >
                  <Fila partido={partido} nombre={nombre} yo={yo} />
                </CasualMatchRow>
              ),
            )}
          </ul>
        </section>
      ))}
    </div>
  )
}
