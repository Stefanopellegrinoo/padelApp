import type { CasualMatch, SharedMatch, TournamentMatch } from '@/db/friends'
import { matchdayDay } from '@/app/format'
import { DISCIPLINE_LABELS } from '@/app/torneos/nuevo/wizard-state'
import { Fragment, type ReactNode } from 'react'
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


// De compañeros el resultado es el de LA PAREJA ("Ganaron"); enfrentados es
// el TUYO contra él ("Ganaste") -- diseño §4.4, y es lo que separa un
// partido de dobles de uno 1v1 sin necesitar un campo aparte.
const VERBOS_JUNTOS: Record<Resultado, string> = { won: 'Ganaron', lost: 'Perdieron', drew: 'Empataron' }
const VERBOS_CONTRA: Record<Resultado, string> = { won: 'Ganaste', lost: 'Perdiste', drew: 'Empataste' }

// Reusa `matchdayDay` (`app/format.ts`), la misma fecha que ya se lee en
// Fechas, la tarjeta de próxima fecha y Mis torneos.
function fechaDe(partido: TournamentMatch): string {
  return partido.playedOn !== null ? matchdayDay(partido.playedOn) : `Fecha ${partido.matchdayNumber}`
}

/** El titular corto de la tarjeta: de qué lado jugaron. */
function ladoDe(partido: SharedMatch): string {
  return partido.together ? 'Juntos' : 'En contra'
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
  const verbo = (partido.together ? VERBOS_JUNTOS : VERBOS_CONTRA)[partido.outcome]
  if (partido.kind === 'tournament') return verbo
  const marcadorEmpatado = partido.score !== null && partido.score.mine === partido.score.theirs
  if (marcadorEmpatado && partido.outcome === 'lost' && !partido.together) {
    return partido.rivals.length > 1 ? `Ganaron ${partido.rivals.join(', ')}` : `Ganó ${nombreAmigo}`
  }
  return verbo
}

// "con Juan vs Ana, Beto"; en 1v1 no hay compañero y se omite el "con".
function nombresDe(partido: CasualMatch): string {
  const con = partido.partners.length > 0 ? `con ${partido.partners.join(', ')} ` : ''
  return `${con}vs ${partido.rivals.join(', ')}`
}

// El equipo con el que jugaste VOS (§4.4: "jugaste con Boca"); el del amigo
// se guarda (`CasualMatch.teams.theirs`) pero no hace falta en tu historial.
function equipoDe(partido: CasualMatch): string | null {
  return partido.teams.mine !== null ? `con ${partido.teams.mine}` : null
}

// §3.2: dos datos y una línea, no un log de auditoría. La comparación es por
// ID, NUNCA por nombre -- `display_name` no es único (review final de 2b,
// Important 2): dos Fede distintos no pueden leerse como "nadie editó".
function autoriaDe(partido: CasualMatch): string {
  if (partido.createdById === partido.updatedById) return `Cargó ${partido.createdBy}`
  return `Cargó ${partido.createdBy} · editó ${partido.updatedBy}`
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


const CARD = 'relative flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-[14px]'
const META = 'flex min-w-0 items-center gap-1.5 text-[12px] font-bold text-muted'
const CHIP = 'shrink-0 rounded-full bg-chip px-2 py-0.5 text-[10.5px] font-extrabold text-text'
const TITULAR = 'text-[15px] leading-[1.3] font-extrabold tracking-[-.02em]'
const QUIENES = 'font-semibold text-muted'
const DETALLE = 'text-[12.5px] font-semibold text-muted'
const AUTORIA = 'text-[11.5px] font-semibold text-muted'

/** El color del resultado: los de la Tabla y Stats. Empate y sin resultado no toman partido. */
const TONO: Record<Resultado, string> = { won: 'text-up', lost: 'text-down', drew: 'text-text' }

/**
 * El marcador, que es lo que uno viene a mirar: grande y a la derecha, como
 * los números de `PartidoRow` en `/rapido`. Pádel son pastillas por set
 * (verde llena si el set fue de tu lado, como las marcas de la ficha del
 * jugador); FIFA y torneo, un número. Debajo, el hecho en palabras -- el color
 * solo no alcanza para quien no lo ve.
 *
 * Los `{' '}` entre pastillas no se dibujan (son hijos de un flex) pero dejan
 * el texto legible para un lector de pantalla: "6-3 4-6 6-5", no "6-34-66-5".
 */
function Marcador({ partido, leyenda }: { partido: SharedMatch; leyenda: string }) {
  const tono = partido.outcome === null ? 'text-muted' : TONO[partido.outcome]
  const sets = partido.kind === 'casual' ? partido.sets : null
  return (
    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
      {sets !== null ? (
        <p className="flex flex-wrap justify-end gap-1">
          {sets.map((set, index) => (
            <Fragment key={index}>
              {index > 0 ? ' ' : ''}
              <span
                className={`inline-flex h-[30px] min-w-[38px] items-center justify-center rounded-[8px] px-1.5 text-[15px] font-extrabold tabular-nums ${
                  set.mine > set.theirs ? 'bg-accent text-accent-text' : 'bg-chip text-muted'
                }`}
              >
                {set.mine}-{set.theirs}
              </span>
            </Fragment>
          ))}
        </p>
      ) : (
        <p className={`text-[26px] leading-none font-extrabold tracking-[-.02em] tabular-nums ${tono}`}>
          {partido.score !== null ? `${partido.score.mine}-${partido.score.theirs}` : '–'}
        </p>
      )}
      <p className={`text-[11.5px] font-extrabold ${partido.outcome === 'drew' ? 'text-muted' : tono}`}>{leyenda}</p>
    </div>
  )
}

/**
 * La tarjeta de un partido, igual para torneo y casual: a la izquierda qué
 * fue (fecha, deporte, de qué lado, con quién), a la derecha cómo salió.
 * `conMenu` le deja lugar al "⋯" de `CasualMatchRow`, que va arriba a la derecha.
 */
function Tarjeta({
  partido,
  nombre,
  meta,
  conMenu,
  children,
}: {
  partido: SharedMatch
  nombre: string
  meta: ReactNode
  conMenu: boolean
  children?: ReactNode
}) {
  return (
    <>
      <p className={`${META} ${conMenu ? 'pr-9' : ''}`}>{meta}</p>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
        <Marcador partido={partido} leyenda={leyendaDe(partido, nombre)} />
      </div>
    </>
  )
}

/**
 * El historial (torneo + casual) con un amigo, sin leer nada -- recibe
 * `SharedMatch[]` ya mezclado y ordenado por props (`historyWith`, Task 2).
 * Mismo reparto que `rules-body.tsx`: la página lee, esto dibuja.
 *
 * Una lista agrupada por mes (diseño §4.4: *"un historial para acordarte
 * bien de cada partido que jugaste"*); cada tarjeta, una fila de marcador.
 * `historial.unit.test.ts` fija el texto de cada `<p>` línea por línea.
 */
export function Historial({ nombre, friendPlayerId, partidos }: HistorialProps) {
  if (partidos.length === 0) {
    // Estado vacío: dice qué falta, no dibuja una tabla sin filas.
    return (
      <div className="flex flex-col gap-1 rounded-card border border-dashed border-line p-5 text-center">
        <p className="text-pretty text-[15px] font-extrabold tracking-[-.02em]">
          Todavía no jugaron ningún partido juntos.
        </p>
        <p className="text-pretty text-[13px] font-[550] text-muted">Cargá el primero y queda acá.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {porMes(partidos).map((grupo, index) => (
        <section key={`${grupo.mes}-${index}`} className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h3 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">{grupo.mes}</h3>
            <span className="h-px flex-1 bg-line" />
          </div>
          {grupo.partidos.map((partido) => {
            // La etiqueta del deporte la traduce la PANTALLA con
            // `DISCIPLINE_LABELS`; `db/` sólo tipa `'PADEL' | 'FIFA'`.
            const deporte = <span className={CHIP}>{DISCIPLINE_LABELS[partido.sport]}</span>
            if (partido.kind === 'tournament') {
              return (
                <div key={partido.matchId} className={CARD}>
                  <Tarjeta
                    partido={partido}
                    nombre={nombre}
                    conMenu={false}
                    meta={
                      <>
                        {fechaDe(partido)} {deporte}
                        <span className="truncate"> torneo {partido.seasonName}</span>
                      </>
                    }
                  >
                    <p className={TITULAR}>{ladoDe(partido)}</p>
                  </Tarjeta>
                </div>
              )
            }

            const equipo = partido.sport === 'FIFA' ? equipoDe(partido) : null
            return (
              <CasualMatchRow key={partido.matchId} friendPlayerId={friendPlayerId} partido={partido}>
                <Tarjeta
                  partido={partido}
                  nombre={nombre}
                  conMenu
                  meta={
                    <>
                      {matchdayDay(partido.playedOn)} {deporte}
                    </>
                  }
                >
                  <p className={TITULAR}>
                    {ladoDe(partido)} <span className={QUIENES}>{nombresDe(partido)}</span>
                  </p>
                  {equipo !== null && <p className={DETALLE}>{equipo}</p>}
                  <p className={AUTORIA}>{autoriaDe(partido)}</p>
                </Tarjeta>
              </CasualMatchRow>
            )
          })}
        </section>
      ))}
    </div>
  )
}
