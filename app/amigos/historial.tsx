import type { CasualMatch, SharedMatch, TournamentMatch } from '@/db/friends'
import { matchdayDay } from '@/app/format'
import { DISCIPLINE_LABELS } from '@/app/torneos/nuevo/wizard-state'
import type { ReactNode } from 'react'
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
    // En un 2v2 el otro lado son dos: nombrar a uno solo sería afirmar de más.
    const rivales = partido.rivals.length > 1 ? `Ganaron ${partido.rivals.join(', ')}` : `Ganó ${nombreAmigo}`
    const ganador = partido.outcome === 'won' || partido.together ? verbo : rivales
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

/** Ganados, perdidos y empatados de un lado del cara a cara. */
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

// Las clases de cada línea de la tarjeta. Tamaños del registro de la casa:
// kicker 12px, resultado como el nombre de una tarjeta de Mis torneos, el
// resto en el gris de los subtítulos.
const KICKER = 'min-w-0 text-[12px] font-bold text-muted'
const RESULTADO = 'text-[15.5px] leading-[1.3] font-extrabold tracking-[-.02em]'
const DETALLE = 'text-[13px] font-semibold text-muted'
const AUTORIA = 'text-[11.5px] font-semibold text-muted'

const INSIGNIA: Record<Resultado, { texto: string; clase: string }> = {
  won: { texto: 'Ganado', clase: 'bg-ok-bg text-up' },
  lost: { texto: 'Perdido', clase: 'bg-warn-bg text-down' },
  drew: { texto: 'Empate', clase: 'bg-chip text-muted' },
}

/**
 * La pastilla de resultado, en los colores con que la app ya dice "bien" y
 * "mal" (Tabla, Stats). Es un `<span>`: el texto del partido sigue entero en
 * los `<p>` y esto sólo lo deja leer de un vistazo.
 */
function Insignia({ outcome }: { outcome: Resultado | null }) {
  if (outcome === null) return null
  const { texto, clase } = INSIGNIA[outcome]
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-extrabold ${clase}`}>{texto}</span>
  )
}

/** La primera línea de cada tarjeta: fecha y deporte a la izquierda, la pastilla a la derecha. */
function Encabezado({ outcome, children }: { outcome: Resultado | null; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <p className={KICKER}>{children}</p>
      <Insignia outcome={outcome} />
    </div>
  )
}

/**
 * El historial (torneo + casual) con un amigo, sin leer nada -- recibe
 * `SharedMatch[]` ya mezclado y ordenado por props (`historyWith`, Task 2).
 * Mismo reparto que `rules-body.tsx`: la página lee, esto dibuja.
 *
 * Una lista agrupada por mes (diseño §4.4: *"un historial para acordarte
 * bien de cada partido que jugaste"*). Cada tarjeta trae su propio detalle.
 *
 * Los textos de cada `<p>` los fija `historial.unit.test.ts` línea por línea:
 * todo lo decorativo (separador de mes, pastilla) va en `<span>`/`<h3>`.
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
            if (partido.kind === 'tournament') {
              return (
                <div
                  key={partido.matchId}
                  className="flex flex-col gap-1 rounded-[14px] border border-line bg-surface p-[14px]"
                >
                  {/* La etiqueta del deporte la traduce la PANTALLA con
                      `DISCIPLINE_LABELS`, como el resto de la app; `db/` sólo
                      tipa el literal `'PADEL' | 'FIFA'`. */}
                  <Encabezado outcome={partido.outcome}>
                    {fechaDe(partido)} · {DISCIPLINE_LABELS[partido.sport]} · torneo {partido.seasonName}
                  </Encabezado>
                  <p className={RESULTADO}>{resultadoDe(partido)}</p>
                </div>
              )
            }

            const equipo = equipoDe(partido)
            return (
              <CasualMatchRow key={partido.matchId} friendPlayerId={friendPlayerId} partido={partido}>
                <Encabezado outcome={partido.outcome}>
                  {matchdayDay(partido.playedOn)} · {DISCIPLINE_LABELS[partido.sport]}
                </Encabezado>
                <p className={RESULTADO}>
                  {resultadoCasualDe(partido, nombre)}
                  {equipo !== null ? `, ${equipo}` : ''}
                </p>
                <p className={DETALLE}>{nombresDe(partido)}</p>
                <p className={AUTORIA}>{autoriaDe(partido)}</p>
              </CasualMatchRow>
            )
          })}
        </section>
      ))}
    </div>
  )
}
