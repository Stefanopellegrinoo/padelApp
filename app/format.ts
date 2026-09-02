import type { MatchdayFormat } from '@/core'

/**
 * El día de una fecha, como lo escribe el handoff.
 *
 * `played_on` es una columna `date` sin hora. El `Date` se arma con componentes
 * locales y no parseando el ISO directo, porque `new Date('2026-08-13')` es
 * medianoche UTC y en un servidor con huso negativo formatea el día anterior.
 *
 * Vive acá porque lo usan cuatro pantallas. Antes había tres copias.
 */
function partsOf(iso: string, weekday: 'short' | 'long'): (type: string) => string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
  const parts = new Intl.DateTimeFormat('es-AR', {
    weekday,
    day: 'numeric',
    month: 'short',
  }).formatToParts(date)
  return (type: string) => parts.find((part) => part.type === type)?.value ?? ''
}

/** `"jue 13 ago"` — la lista de Fechas, la tarjeta de próxima fecha, Mis torneos. */
export function matchdayDay(iso: string): string {
  const get = partsOf(iso, 'short')
  return `${get('weekday')} ${get('day')} ${get('month')}`
}

/** `"jueves 27 ago"` — el kicker de la pantalla de una fecha. */
export function matchdayFull(iso: string): string {
  const get = partsOf(iso, 'long')
  return `${get('weekday')} ${get('day')} ${get('month')}`
}

/** Las iniciales para el avatar: primera del nombre y primera del apellido si lo hay. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

/**
 * "Todos contra todos" o "N grupos + llave" — el mismo texto para el botón de
 * `SelectorDeFormato` (armado de una fecha, `fechas/[n]/armado.tsx`) y para
 * el radio que elige el `formato_default` de una disciplina (Ajustes,
 * `ajustes/formato-default.tsx`): las dos pantallas nombran el mismo
 * `MatchdayFormat.kind` y TIENEN que decir lo mismo (mismo criterio que
 * `steppersFor`, `ajustes/formato.tsx:19-21` — copiar el criterio en vez de
 * compartirlo es lo que produjo W63).
 *
 * Vive acá, en `app/format.ts` ("lo usan cuatro pantallas. Antes había tres
 * copias", el mismo motivo que ya trajo `initials`/`matchdayDay` a este
 * archivo) y no adentro de `armado.tsx`: ese archivo es `'use client'` y
 * arrastra sus propias server actions (`./actions`) y su reducer
 * (`./armado-state`) — importarlo desde Ajustes para una sola función pura
 * encadenaría el bundle de una pantalla al de la otra sin necesidad.
 *
 * Nombrada `matchdayFormatLabel` y no `formatoLabel`: `ajustes/page.tsx` ya
 * tiene una constante LOCAL llamada `formatoLabel` para un concepto
 * distinto (`formatsLabel` de `core/narrate.ts` sobre `MatchFormat` — "2
 * sets a 6 games"). Compartir el nombre entre dos cosas distintas es
 * exactamente la clase de colisión que `0074_discipline_formato_default.sql:12-16`
 * avisa de no repetir (ahí es sobre el NOMBRE DE COLUMNA, `formato_default`
 * vs `formato`; acá es el mismo principio aplicado al nombre de la función).
 */
export function matchdayFormatLabel(formato: MatchdayFormat): string {
  return formato.kind === 'ROUND_ROBIN' ? 'Todos contra todos' : `${formato.groups} grupos + llave`
}
