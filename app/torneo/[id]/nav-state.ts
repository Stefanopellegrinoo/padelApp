/**
 * Qué pestaña del nav se enciende y a dónde apunta cada una, aparte de
 * `nav.tsx` para poder testearlo sin DOM — `nav.tsx` es `'use client'` y usa
 * `usePathname`, que no se puede invocar fuera de un render. Mismo patrón que
 * `tabla-state.ts`.
 */

/**
 * Segmentos de primer nivel de esta sección que NO son un slug de
 * disciplina. `kind` sólo puede ser `'padel'`/`'fifa'` (con sufijo `-N`,
 * `core/discipline-slug.ts`), así que nunca colisiona con ninguno de estos —
 * alcanza con excluirlos para reconocer si el primer segmento de la URL es
 * una disciplina, sin traer la lista real hasta acá.
 */
const NON_DISCIPLINE_SEGMENTS = new Set(['fechas', 'stats', 'reglas', 'ajustes', 'jugador'])

export interface NavTab {
  label: string
  href: string
  isActive: boolean
}

/**
 * La disciplina bajo la URL actual, si la hay. Sin anclar el final: cubre
 * `${base}/{slug}`, `${base}/{slug}/fechas`, `${base}/{slug}/fechas/{n}`,
 * `${base}/{slug}/stats` y `${base}/{slug}/jugador/{e}` — sólo el primer
 * segmento importa.
 *
 * `null` en el contenedor (`base` a secas), Ajustes, Reglas y los tres
 * redirects de compatibilidad sin disciplina (`${base}/stats`,
 * `${base}/fechas`, `${base}/jugador/{e}`) — estos tres últimos en la
 * práctica nunca llegan a evaluarse acá: `redirect()` los resuelve del lado
 * del servidor antes de que este layout se monte en el cliente con esa URL.
 */
export function currentDisciplineSlug(base: string, pathname: string): string | null {
  const segment = /^\/([^/]+)/.exec(pathname.slice(base.length))?.[1]
  return segment !== undefined && !NON_DISCIPLINE_SEGMENTS.has(segment) ? segment : null
}

/**
 * Las 4 pestañas del nav para un `pathname` dado. Tabla, Fechas y Stats
 * llevan la disciplina actual —o la `[0]` de la temporada si la URL de hoy no
 * trae ninguna— en el destino (diseño §4 de `docs/arquitectura-de-paginas.md`).
 * Reglas se queda apuntando al contenedor a propósito: es la única pantalla
 * del torneo pública (`middleware.ts:80`, diseño §3.1) y es el link que se
 * comparte; partirla en uno por disciplina rompería eso.
 */
export function navTabs(seasonId: string, defaultDisciplineSlug: string, pathname: string): NavTab[] {
  const base = `/torneo/${seasonId}`
  const rest = pathname.slice(base.length)
  const slug = currentDisciplineSlug(base, pathname) ?? defaultDisciplineSlug

  // Activa con exactamente un segmento después de `base` que no sea uno de
  // los no-disciplina — o sea `${base}/{slug}`, la Tabla de esa disciplina.
  // El contenedor (`base` a secas) NO la enciende: su `href` ya no es `base`
  // sino una disciplina puntual, así que un tab encendido tiene que
  // significar "tocarlo de nuevo no te mueve de acá", no "hay algo parecido".
  const tablaSegment = /^\/([^/]+)$/.exec(rest)?.[1]
  const isTabla = tablaSegment !== undefined && !NON_DISCIPLINE_SEGMENTS.has(tablaSegment)

  return [
    { label: 'Tabla', href: `${base}/${slug}`, isActive: isTabla },
    {
      label: 'Fechas',
      href: `${base}/${slug}/fechas`,
      // La ruta de una fecha lleva la disciplina en el medio
      // (`${base}/{disciplina}/fechas/{n}`) — `includes` sobre lo que sigue
      // de `base` la agarra sin abrir la pestaña de otra sección (ninguna
      // `kind` se llama "fechas").
      isActive: pathname.startsWith(base) && rest.includes('/fechas'),
    },
    {
      label: 'Stats',
      href: `${base}/${slug}/stats`,
      isActive: pathname.startsWith(base) && rest.includes('/stats'),
    },
    {
      label: 'Reglas',
      href: `${base}/reglas`,
      isActive: pathname.startsWith(`${base}/reglas`),
    },
  ]
}
