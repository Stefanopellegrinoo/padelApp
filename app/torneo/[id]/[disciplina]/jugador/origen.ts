/**
 * De dónde se llegó al perfil de un jugador, para que su `Volver` diga a
 * dónde vuelve ("‹ Estadísticas", "‹ Tabla") como en el prototipo: al padre
 * por defecto, o a la pantalla desde la que llegaste. Viaja en la URL
 * (`?desde=stats`) y no en el historial: el destino se nombra antes de
 * tocarlo, y un link abierto directo cae en la Tabla.
 *
 * `mias` es la pestaña "Mías" de Stats (`?tab=mias`). Cualquier otro valor
 * (o ninguno) es la Tabla del deporte, de donde sale la mayoría de los
 * perfiles (`desempate.tsx`).
 */
export type Desde = 'stats' | 'mias'

export function desdeOf(value: string | undefined): Desde | null {
  return value === 'stats' || value === 'mias' ? value : null
}

/** `base` es `/torneo/{seasonId}/{disciplina}`. */
export function volverDelJugador(base: string, desde: Desde | null): { href: string; label: string } {
  if (desde === 'stats') return { href: `${base}/stats`, label: 'Estadísticas' }
  if (desde === 'mias') return { href: `${base}/stats?tab=mias`, label: 'Estadísticas' }
  return { href: base, label: 'Tabla' }
}

/** El link al perfil de `entryId`, llevando el origen para su `Volver`. */
export function perfilHref(base: string, entryId: string, desde: Desde | null): string {
  return `${base}/jugador/${entryId}${desde === null ? '' : `?desde=${desde}`}`
}
