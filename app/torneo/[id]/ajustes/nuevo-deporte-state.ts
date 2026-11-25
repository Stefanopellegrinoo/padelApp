import { fichaSeed, sportLabel, type DisciplineId, type Modality, type TournamentSport } from '@/core'
import type { DisciplineRules } from '@/app/deporte/personalizar-reglas-state'
import type { PrimeraFecha } from '@/app/deporte/tarjeta-state'
import type { NewDiscipline } from '@/db/discipline'

/** Lo que "+ Agregar un deporte" manda: la tarjeta del paso 3 más quién juega. */
export interface NewSportInput {
  kind: TournamentSport
  modality: Modality
  primeraFecha: PrimeraFecha
  rules: DisciplineRules
  entryIds: string[]
}

/**
 * Las opciones de "Primera fecha" al sumar un deporte (docs/torneos-deportes.md §5): "Por nivel" es el
 * orden que ya tiene el torneo, y "Igual que" copia el de cualquier disciplina que el torneo ya tiene
 * (no hay cadenas que evitar: su orden ya está guardado). Con dos del mismo deporte, el slug las distingue.
 * Las mismas palabras que el asistente de crear (`opcionesPrimeraFecha`, `app/torneos/nuevo/crear-state.ts`).
 */
export function opcionesDeAlta(
  disciplines: readonly { id: string; kind: string; slug: string }[],
): { value: PrimeraFecha; label: string; sub: string | null }[] {
  return [
    { value: 'NIVEL', label: 'Por nivel', sub: 'vos los ordenás' },
    { value: 'SORTEO', label: 'Al azar', sub: 'sortea la app' },
    ...disciplines.map((discipline) => {
      const repeated = disciplines.filter((other) => other.kind === discipline.kind).length > 1
      const name = repeated ? `${sportLabel(discipline.kind)} (${discipline.slug})` : sportLabel(discipline.kind)
      return { value: { igualQue: discipline.id }, label: `Igual que ${name}`, sub: 'el mismo orden' }
    }),
  ]
}

/**
 * La `NewDiscipline` que escribe `addDiscipline`: los lados, las parejas fijas y el empate salen de la
 * ficha por la modalidad (`fichaSeed`, que además rechaza una modalidad que el deporte no ofrece); la
 * config, los Masters y el formato por default son lo que quedó en la tarjeta. La primera fecha elegida
 * se escribe como orden: "Al azar" sortea, "Igual que" copia, "Por nivel" es el del torneo.
 */
export function newSportOf({ kind, modality, primeraFecha, rules, entryIds }: NewSportInput): NewDiscipline {
  const seed = fichaSeed(kind, entryIds.length, modality)
  const own = typeof primeraFecha === 'string'
  return {
    kind,
    // "Igual que": `addDiscipline` pone la de la disciplina que copia; acá queda la de la tarjeta.
    config: own ? { ...rules.config, firstFecha: primeraFecha } : rules.config,
    pairSize: seed.pairSize,
    fixedTeams: seed.fixedTeams,
    allowsDraw: seed.allowsDraw,
    hasMasters: seed.pairSize === 2 && rules.hasMasters,
    formatoDefault: rules.formatoDefault,
    ...(primeraFecha === 'SORTEO' ? { shuffle: true } : {}),
    ...(own ? {} : { sameOrderAs: primeraFecha.igualQue as DisciplineId }),
  }
}
