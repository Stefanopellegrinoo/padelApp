import type { GenteDeTorneo } from '@/db/friends'

/** Cuántas personas se ven en Amigos antes de "Ver los N" (la maqueta muestra 4). */
export const GENTE_EN_AMIGOS = 4

/** Cuántas van en Inicio cuando todavía no tenés amigos. */
export const GENTE_EN_INICIO = 2

/**
 * De dónde la conocés, en la fila de "Gente de tus torneos" (S3): con un solo
 * torneo, su nombre ("Los Pibes del Martes · 7 fechas"); con varios, cuántos
 * ("2 torneos · 9 fechas juntos"). Sin ninguna fecha juntos, sólo el torneo.
 */
export function metaDeGente({ torneos, fechasJuntos }: Pick<GenteDeTorneo, 'torneos' | 'fechasJuntos'>): string {
  const fechas = fechasJuntos === 1 ? '1 fecha' : `${fechasJuntos} fechas`
  if (torneos.length === 1) {
    const [torneo] = torneos
    return fechasJuntos === 0 ? `${torneo}` : `${torneo} · ${fechas}`
  }
  return fechasJuntos === 0 ? `${torneos.length} torneos` : `${torneos.length} torneos · ${fechas} juntos`
}
