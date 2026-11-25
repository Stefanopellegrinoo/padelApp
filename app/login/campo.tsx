'use client'

import type { ComponentProps } from 'react'

/**
 * Los campos de entrar y de crear cuenta (`/login`, `/registro`): la etiqueta
 * arriba, el campo de 52 con texto de 16 (menos hace que iOS haga zoom al
 * enfocarlo) y el mensaje en rojo abajo. El borde es `muted` al 70 % y no
 * `line`: un campo vacío sobre el fondo tiene que verse como campo (3:1, WCAG
 * 1.4.11), y `line` sobre blanco no llega a 1.5.
 */
export const etiqueta = 'text-[15px] font-semibold'
export const mensajeError = 'text-[14px] font-semibold text-live'

export function campoClase(error: boolean): string {
  return `min-h-[52px] w-full rounded-btn border-[1.5px] bg-surface-2 px-4 text-[16px] font-semibold text-text ${
    error ? 'border-live' : 'border-muted/70'
  }`
}

/**
 * La contraseña con "Ver"/"Ocultar" ADENTRO del campo, a la derecha: así el
 * anillo de foco rodea el campo entero y el botón mide 44.
 */
export function CampoClave({
  show,
  onToggle,
  error = false,
  ...input
}: { show: boolean; onToggle: () => void; error?: boolean } & ComponentProps<'input'>) {
  return (
    <div className="relative">
      <input {...input} type={show ? 'text' : 'password'} className={`${campoClase(error)} pr-[84px]`} />
      <button
        type="button"
        onClick={onToggle}
        className="absolute top-1 right-1 min-h-[44px] rounded-[10px] px-3 text-[15px] font-bold text-accent-link"
      >
        {show ? 'Ocultar' : 'Ver'}
      </button>
    </div>
  )
}

/** El separador entre Google y el mail. */
export function Separador() {
  return (
    <div className="flex items-center gap-3 text-[14px] font-semibold text-muted">
      <span className="h-px flex-1 bg-line" />o<span className="h-px flex-1 bg-line" />
    </div>
  )
}

/** La "G" de Google, en el color del texto: es el nombre del botón el que dice qué hace. */
export function IconoGoogle() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-current">
      <path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3zM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22zM6.4 14a6 6 0 0 1 0-3.9V7.4H3.1a10 10 0 0 0 0 9.1L6.4 14zM12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4l3.3 2.6C7.2 7.8 9.4 6 12 6z" />
    </svg>
  )
}
