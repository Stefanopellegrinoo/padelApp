export type SeasonStatus = 'SETUP' | 'ACTIVE' | 'FINISHED'

/**
 * El estado de la temporada, DERIVADO del de sus disciplinas (REQ-D3-3).
 * `seasons.status` sigue existiendo hasta el contract (PR 27, dual-write),
 * pero ya no es la fuente de verdad para un torneo con más de una disciplina.
 *
 * Sin disciplinas: SETUP (una temporada recién creada, todavía sin su
 * backfill — no debería pasar en la práctica, pero no hay nada mejor que
 * decir). Todas FINISHED: FINISHED. Todas SETUP: SETUP. Cualquier otra
 * combinación (alguna jugándose, o una terminada y otra sin empezar):
 * ACTIVE — el torneo tiene algo en curso.
 */
export function seasonStatusOf(disciplines: readonly { status: SeasonStatus }[]): SeasonStatus {
  if (disciplines.length === 0) return 'SETUP'
  if (disciplines.every((d) => d.status === 'FINISHED')) return 'FINISHED'
  if (disciplines.every((d) => d.status === 'SETUP')) return 'SETUP'
  return 'ACTIVE'
}
