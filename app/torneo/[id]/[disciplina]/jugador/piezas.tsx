import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Award, EntryId } from '@/core'

/**
 * Lo que comparten Stats y el perfil del jugador: el casillero de un dato, la
 * sección con filas, la marca de "vos" y el gráfico de puntos por fecha. Vive
 * al lado del perfil porque el gráfico nació ahí; Stats lo usa en "Mías".
 */

/**
 * Tu fila: amarilla en claro; en oscuro, elevada con el borde amarillo. La
 * misma receta que la Tabla (`desempate.tsx`): el amarillo es SOLO tuyo.
 */
export const VOS_FILA =
  'border-transparent bg-vos-fila text-on-vos shadow-[inset_4px_0_0_var(--color-vos-borde)] dark:text-text'

/** "vos" al lado de tu nombre en una fila. */
export function Vos() {
  return <span className="shrink-0 text-[13px] font-semibold">vos</span>
}

/**
 * Un dato: el número grande en el color del deporte sobre su tinte, y qué es
 * debajo. Con `href`, se toca (la fecha más pareja lleva a esa fecha).
 */
export function Dato({ label, value, href }: { label: string; value: ReactNode; href?: string }) {
  const body = (
    <>
      <span className="font-cond block text-[44px] text-sport">{value}</span>
      <span className="mt-1.5 block text-[13px] leading-tight font-semibold">{label}</span>
    </>
  )
  const box = 'flex min-h-[96px] flex-col justify-end rounded-tile bg-sport-tint px-3 pt-3 pb-3.5'
  return href === undefined ? (
    <div className={box}>{body}</div>
  ) : (
    <Link href={href} className={`press ${box}`}>
      {body}
    </Link>
  )
}

/** Una sección de la pantalla: el título con márgenes y el contenido a lo ancho (las filas ponen los suyos). */
export function Seccion({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pt-6">
      <h2 className="font-titulo px-4 pb-2 text-[24px]">{title}</h2>
      {children}
    </section>
  )
}

export interface MatchdayMark {
  number: number
  status: 'counted' | 'discarded' | 'absent'
  points: number | null
}

/**
 * Marca cada fecha cerrada como contada, descartada o ausencia — sin
 * recalcular la regla de las mejores N. `RankingRow.counted`/`discarded` ya la
 * resolvieron; esto sólo empareja el puntaje de cada fecha contra esos dos
 * arrays (por valor, tipo multiset: un empate exacto en el corte cae en
 * cualquiera de las fechas empatadas, da lo mismo cuál, porque valen lo mismo).
 */
export function markMatchdays(
  matchdayNumbers: number[],
  awardsByMatchday: Map<number, Award[]>,
  entryId: EntryId,
  counted: readonly number[],
  discarded: readonly number[],
): MatchdayMark[] {
  const countedPool = [...counted]
  const discardedPool = [...discarded]

  return matchdayNumbers.map((number): MatchdayMark => {
    const award = (awardsByMatchday.get(number) ?? []).find((candidate) => candidate.entryId === entryId)
    if (award === undefined) return { number, status: 'absent', points: null }

    const countedIndex = countedPool.indexOf(award.points)
    if (countedIndex !== -1) {
      countedPool.splice(countedIndex, 1)
      return { number, status: 'counted', points: award.points }
    }
    const discardedIndex = discardedPool.indexOf(award.points)
    if (discardedIndex !== -1) discardedPool.splice(discardedIndex, 1)
    return { number, status: 'discarded', points: award.points }
  })
}

/** Alto de la barra más alta, en px: el número va arriba de cada barra. */
const BAR_MAX = 132

/**
 * Los puntos de cada fecha en barras, como el Stats del prototipo: la que
 * cuenta, llena del color del deporte; la que se descarta, rayada con su
 * borde; la que no jugó, un guion. Un solo `role="img"` con todo dicho en
 * texto: leer columna por columna sería ruido.
 */
export function PuntosPorFecha({ title, marks }: { title: string; marks: readonly MatchdayMark[] }) {
  if (marks.length === 0) return null
  const max = Math.max(1, ...marks.map((mark) => mark.points ?? 0))
  const anyDiscarded = marks.some((mark) => mark.status === 'discarded')
  const label = `Puntos por fecha: ${marks
    .map(
      (mark) =>
        `fecha ${mark.number}, ${
          mark.points === null ? 'no jugó' : `${mark.points}${mark.status === 'discarded' ? ', se descarta' : ''}`
        }`,
    )
    .join('; ')}`
  const columns = { gridTemplateColumns: `repeat(${marks.length}, minmax(0, 1fr))` }

  return (
    <Seccion title={title}>
      <div className="px-4">
        {/* Sin alto fijo: lo pone la barra más alta, así una fila de ceros no
            deja un hueco de gráfico vacío. */}
        <div role="img" aria-label={label} className="grid items-end gap-1.5" style={columns}>
          {marks.map((mark) => (
            <div key={mark.number} className="flex flex-col items-center justify-end gap-1.5">
              <span className={`font-cond text-[20px] ${mark.status === 'counted' ? '' : 'text-muted'}`}>
                {mark.points ?? '–'}
              </span>
              <i
                className={`block w-full max-w-[56px] rounded-t-[8px] rounded-b-[3px] ${
                  mark.status === 'counted'
                    ? 'bg-sport'
                    : mark.status === 'discarded'
                      ? 'bg-[repeating-linear-gradient(135deg,var(--color-sport-tint)_0_5px,var(--color-bg)_5px_9px)] shadow-[inset_0_0_0_1.5px_var(--color-sport)]'
                      : 'bg-line'
                }`}
                style={{ height: mark.points === null ? 4 : Math.max(6, Math.round((mark.points / max) * BAR_MAX)) }}
              />
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="mt-2 grid gap-1.5 text-center text-[13px] font-semibold text-muted" style={columns}>
          {marks.map((mark) => (
            <span key={mark.number}>{mark.number}</span>
          ))}
        </div>
        {anyDiscarded && (
          <div aria-hidden="true" className="mt-3 flex gap-4 text-[14px] text-muted">
            <span className="flex items-center gap-1.5">
              <i className="h-3.5 w-3.5 rounded-[3px] bg-sport" />
              Cuenta
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-3.5 w-3.5 rounded-[3px] bg-[repeating-linear-gradient(135deg,var(--color-sport-tint)_0_3px,var(--color-bg)_3px_5px)] shadow-[inset_0_0_0_1.5px_var(--color-sport)]" />
              Se descarta
            </span>
          </div>
        )}
      </div>
    </Seccion>
  )
}
