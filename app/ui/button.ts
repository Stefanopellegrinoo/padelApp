/**
 * Las recetas de botón del prototipo, como clases: sirven igual para un
 * `<button>`, un `<Link>` o el `SubmitButton` (`className={button('primary')}`).
 *
 * - `primary`: el principal de la pantalla ("Cargar partido", "Cerrar la
 *   fecha"). Tinta en claro, azul en oscuro (`cta`).
 * - `secondary`: la otra opción, sobre `chip`.
 * - `ghost`: texto azul sin caja ("Crear torneo", "Cancelar").
 * - `danger`: borrar o salir, rojo sobre su tinte (`live`).
 * - `onBlock`: la píldora blanca adentro de un bloque ("Ver la fecha").
 *
 * Todos miden 44 o más (`lg`: 56, el de la barra de abajo) y se aprietan
 * (`press`, para que también se achique un `<a>`). Deshabilitado es el canal
 * de siempre, `:disabled` en `globals.css`.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'onBlock'

const BASE = 'press inline-flex items-center justify-center gap-2 text-center font-bold'

const SIZE = {
  md: 'min-h-[44px] px-4 text-[16px]',
  lg: 'min-h-[56px] px-5 text-[17px]',
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'rounded-btn bg-cta text-on-cta',
  secondary: 'rounded-btn bg-chip text-text',
  ghost: 'rounded-btn bg-transparent text-accent-link active:bg-sport-tint',
  danger: 'rounded-btn bg-live-bg text-live',
  onBlock: 'rounded-pill bg-on-block text-block',
}

export function button(
  variant: ButtonVariant = 'primary',
  { size = 'md', full = false }: { size?: keyof typeof SIZE; full?: boolean } = {},
): string {
  return `${BASE} ${SIZE[size]} ${VARIANT[variant]}${full ? ' w-full' : ''}`
}
