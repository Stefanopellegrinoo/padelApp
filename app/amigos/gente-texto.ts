import type { GenteDeTorneo } from '@/db/friends'
import { torneosCompartidos } from './torneos-texto'

/** Cuántas personas se ven en Amigos antes de "Ver todas (N)" (S10). */
export const GENTE_EN_AMIGOS = 5

/** Cuántas van en Inicio cuando todavía no tenés amigos. */
export const GENTE_EN_INICIO = 2

/** De a cuántas muestra "Ver todas" (`/amigos/gente`), con "Mostrar más" (S10). */
export const GENTE_POR_TANDA = 20

/** De dónde la conocés, en la fila de "Gente de tus torneos": los torneos en el formato de S11, sin fechas. */
export function metaDeGente({ torneos }: Pick<GenteDeTorneo, 'torneos'>): string {
  // `torneos` nunca viene vacío (`genteDeTusTorneos`).
  return torneosCompartidos(torneos) ?? ''
}

/** "1 persona", "23 personas": el subtítulo de "Ver todas" y su final. */
export function cuantasPersonas(n: number): string {
  return n === 1 ? '1 persona' : `${n} personas`
}

/** Un chip de filtro de "Ver todas": un torneo y cuánta gente para sugerir tiene. */
export interface FiltroDeGente {
  seasonId: string
  nombre: string
  cuantas: number
}

/**
 * Un chip por torneo con gente para sugerir (decisión del orquestador): el
 * que tiene más gente primero; con la misma, por nombre y después por id.
 */
export function filtrosDeGente(gente: readonly GenteDeTorneo[]): FiltroDeGente[] {
  const porTorneo = new Map<string, FiltroDeGente>()
  for (const persona of gente) {
    persona.seasonIds.forEach((seasonId, i) => {
      const filtro = porTorneo.get(seasonId) ?? { seasonId, nombre: persona.torneos[i] ?? '', cuantas: 0 }
      filtro.cuantas += 1
      porTorneo.set(seasonId, filtro)
    })
  }
  return [...porTorneo.values()].sort(
    (a, b) =>
      b.cuantas - a.cuantas ||
      a.nombre.localeCompare(b.nombre, 'es') ||
      (a.seasonId < b.seasonId ? -1 : a.seasonId > b.seasonId ? 1 : 0),
  )
}

/** La gente de un torneo (`null`: todos), en el mismo orden en que llega. */
export function deUnTorneo(gente: readonly GenteDeTorneo[], seasonId: string | null): GenteDeTorneo[] {
  return seasonId === null ? [...gente] : gente.filter((persona) => persona.seasonIds.includes(seasonId))
}

/** Cuántas suma el próximo "Mostrar más": las 20 siguientes, o las que quedan. */
export function mostrarMas(total: number, visibles: number): number {
  return Math.max(0, Math.min(GENTE_POR_TANDA, total - visibles))
}
