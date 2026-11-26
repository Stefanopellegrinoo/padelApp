import type { ReactNode } from 'react'

/**
 * Lo que comparten las piezas de Ajustes (el contenedor y el de cada deporte):
 * el grupo de filas, la fila que se toca para abrir una hoja, el aviso rojo y
 * los campos de las hojas. Como el resto del prototipo: bloques planos sin
 * sombra, filas de 56, márgenes de 16 y texto de 16 en los campos (abajo de
 * 16 el iPhone hace zoom al enfocar).
 */

/** El grupo de filas: un bloque `surface` con las filas adentro, divididas por `line`. */
export const GRUPO = 'overflow-hidden rounded-tile bg-surface'

/** La caja de una fila: 56 de alto. `FILA` le suma el divisor arriba, salvo en la primera. */
export const FILA_CAJA = 'flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left'
export const FILA = `${FILA_CAJA} border-t border-line first:border-t-0`

/** El campo de una hoja (nombre, texto, posición). */
export const CAMPO =
  'block min-h-[48px] w-full rounded-btn border border-line bg-bg px-3.5 py-2.5 text-[16px] font-semibold text-text outline-none focus:border-sport'

/** El rótulo de un campo de una hoja. */
export const ROTULO = 'mb-1.5 block text-[14px] font-semibold text-muted'

/** La flecha de "esto abre algo" al final de una fila. */
export function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5 shrink-0 fill-none stroke-muted stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

/**
 * La fila que abre una hoja: qué es a la izquierda y el valor de hoy a la
 * derecha, con la flecha. El valor se recorta antes que el rótulo.
 */
export function FilaHoja({
  label,
  value,
  onClick,
  disabled,
}: {
  label: ReactNode
  value?: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${FILA} press-fila active:scale-100`}>
      <span className="shrink-0 text-[17px] font-semibold">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-[16px] text-muted">{value}</span>
      <Chevron />
    </button>
  )
}

/**
 * Un error o un aviso que pide arreglar algo: rojo sobre su tinte, legible.
 * `alerta` para el error que aparece después de tocar algo (se anuncia); el
 * aviso que ya viene con la pantalla no lo necesita.
 */
export function Aviso({
  children,
  alerta = false,
  className = '',
}: {
  children: ReactNode
  alerta?: boolean
  className?: string
}) {
  return (
    <p role={alerta ? 'alert' : undefined} className={`rounded-btn bg-live-bg px-3.5 py-3 text-[15px] font-semibold text-live ${className}`}>
      {children}
    </p>
  )
}
