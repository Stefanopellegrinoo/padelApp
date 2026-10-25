/**
 * Qué pestaña del nav se enciende y a dónde apunta cada una, aparte de
 * `nav.tsx` para poder testearlo sin DOM — `nav.tsx` es `'use client'` y usa
 * `usePathname`, que no se puede invocar fuera de un render. Mismo patrón que
 * `tabla-state.ts`.
 */

import { disciplineSlugs, sportLabel, type SluggableDiscipline } from '@/core'
import { EdgeError } from '@/db/errors'

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
  /**
   * Ajustes es un desvío desde la Tabla (el ⚙): salir de ahí por el nav
   * reemplaza la entrada en vez de apilarla, así "atrás" vuelve a la Tabla y
   * no a Ajustes.
   */
  replace: boolean
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
  // los no-disciplina — o sea `${base}/{slug}`, la Tabla de esa disciplina —,
  // o en la tabla general (`base` a secas, sólo existe con 2+ deportes). Ahí
  // el `href` pasa a ser `base`: un tab encendido significa "tocarlo de nuevo
  // no te mueve de acá".
  const isGeneral = rest === ''
  const tablaSegment = /^\/([^/]+)$/.exec(rest)?.[1]
  const isTabla = isGeneral || (tablaSegment !== undefined && !NON_DISCIPLINE_SEGMENTS.has(tablaSegment))
  const replace = rest.endsWith('/ajustes')

  const tabs = [
    { label: 'Tabla', href: isGeneral ? base : `${base}/${slug}`, isActive: isTabla },
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
  return tabs.map((tab) => ({ ...tab, replace }))
}

export interface SportChip {
  label: string
  href: string
  isActive: boolean
}

/**
 * Lo que puede seguir al slug para que la URL sea la RAÍZ de una sección:
 * Tabla (nada), Fechas o Stats. Sin barra final, como el resto de este
 * archivo: `usePathname` no la trae.
 */
const SECTION_ROOTS = new Set(['', '/fechas', '/stats'])

/**
 * Los chips para cambiar de deporte sin pasar por la Tabla general: uno por
 * deporte de la temporada, en el orden que llega, cada uno apuntando a la
 * MISMA sección del otro deporte (`/padel/fechas` → `/fifa/fechas`).
 *
 * Sólo en las tres raíces de sección. Más abajo (`/fechas/{n}`, `/jugador/…`,
 * `/ajustes`) cambiar de deporte no tiene un destino equivalente —la fecha 3
 * de pádel no existe en FIFA— y en Reglas y Ajustes del torneo no hay deporte
 * que cambiar. Con un solo deporte, tampoco. Y un slug que no es de la
 * temporada (la página ya hace `notFound()`) no enciende nada.
 *
 * En las tablas va primero "General", la tabla general (`base`): es la única
 * forma de volver a ella con un toque, y en ella es el chip encendido.
 */
export function sportChips(
  seasonId: string,
  sports: readonly { slug: string; label: string }[],
  pathname: string,
): SportChip[] {
  const base = `/torneo/${seasonId}`
  if (sports.length < 2) return []

  const general = { label: 'General', href: base, isActive: pathname === base }
  if (general.isActive) {
    return [general, ...sports.map((sport) => ({ label: sport.label, href: `${base}/${sport.slug}`, isActive: false }))]
  }
  if (!pathname.startsWith(`${base}/`)) return []

  const current = currentDisciplineSlug(base, pathname)
  if (current === null || !sports.some((sport) => sport.slug === current)) return []

  const section = pathname.slice(`${base}/${current}`.length)
  if (!SECTION_ROOTS.has(section)) return []

  const chips = sports.map((sport) => ({
    label: sport.label,
    href: `${base}/${sport.slug}${section}`,
    isActive: sport.slug === current,
  }))
  return section === '' ? [general, ...chips] : chips
}

/**
 * Slug y nombre de cada deporte de la temporada, en el orden que llega —el de
 * `position`—, para los chips y el botón de abrir fecha. Dos disciplinas del
 * mismo `kind` darían dos "Pádel" iguales: el nombre se numera con la misma
 * regla que el slug (`core/discipline-slug.ts`), la primera pelada y la
 * n-ésima con " n", para que lo que dice el chip sea lo que dice la URL.
 */
export function sportsOf(disciplines: readonly SluggableDiscipline[]): { slug: string; label: string }[] {
  const slugOf = disciplineSlugs(disciplines)
  // Por `kind` y no por nombre: es lo que numera el slug.
  const seenByKind = new Map<string, number>()
  return disciplines.map((discipline) => {
    const ordinal = (seenByKind.get(discipline.kind) ?? 0) + 1
    seenByKind.set(discipline.kind, ordinal)
    const slug = slugOf.get(discipline.id)
    if (slug === undefined) throw new EdgeError('La disciplina de la temporada no existe.')
    const label = sportLabel(discipline.kind)
    return { slug, label: ordinal === 1 ? label : `${label} ${ordinal}` }
  })
}
