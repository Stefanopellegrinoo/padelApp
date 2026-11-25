/**
 * La fila de lista del prototipo (amigos, fechas, jugadores): 56 de alto,
 * márgenes de 16, el divisor ARRIBA de cada fila salvo la primera. Se usa en
 * los `<li>` (o en el `<a>`/`<button>` de adentro) de un `<ul>`.
 *
 * `rowPress` es la que se toca: no se achica como un botón (una fila entera
 * achicándose marea), cambia el fondo al tinte del deporte (`press-fila`).
 * `rowTitle` y `rowMeta` son el nombre y la línea gris de abajo.
 */
export const row =
  'flex min-h-[56px] w-full items-center gap-3 border-t border-line px-4 py-3 text-left first:border-t-0'

export const rowPress = `${row} press-fila`

export const rowTitle = 'block text-[17px] font-bold'

export const rowMeta = 'block text-[14px] text-muted'
