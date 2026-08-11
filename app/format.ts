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
