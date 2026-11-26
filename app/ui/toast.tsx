'use client'

import { useEffect, useRef } from 'react'

/**
 * El aviso de abajo del prototipo ("Guardado: Martín y Tomi 6-4"): una
 * superficie invertida —tinta en claro, clara en oscuro— que se va sola a
 * los 2,5 s, o a los 4,5 si trae una acción para dar tiempo a tocarla.
 *
 * La región `status` se dibuja SIEMPRE, vacía mientras no hay mensaje: un
 * lector de pantalla anuncia lo que cambia adentro de una región viva que ya
 * estaba, no una que aparece con el texto puesto.
 *
 * Controlado: `message` lo muestra, `onDismiss` avisa que se fue (por tiempo
 * o por la acción) para que la pantalla lo ponga en `null`. Un mensaje nuevo
 * reinicia el reloj. `className` lo ubica: va arriba de la barra de abajo de
 * la pantalla, para no tapar lo que acaba de cambiar.
 */
export function Toast({
  message,
  action,
  onDismiss,
  className = 'bottom-[calc(16px+env(safe-area-inset-bottom))]',
}: {
  message: string | null
  action?: { label: string; onClick: () => void }
  onDismiss: () => void
  className?: string
}) {
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  const conAccion = action !== undefined

  useEffect(() => {
    if (message === null) return
    const timer = setTimeout(() => dismiss.current(), conAccion ? 4500 : 2500)
    return () => clearTimeout(timer)
  }, [message, conAccion])

  const visible = message !== null
  return (
    <div
      role="status"
      aria-live="polite"
      data-visible={visible}
      className={`fixed right-4 left-4 z-50 mx-auto flex max-w-lg items-center justify-between gap-3 rounded-btn bg-toast py-2 pr-2 pl-4 font-semibold text-on-toast transition-[opacity,translate] duration-200 ease-salida ${
        visible ? 'min-h-[56px] opacity-100' : 'pointer-events-none translate-y-3 opacity-0 motion-reduce:translate-y-0'
      } ${className}`}
    >
      <span>{message ?? ''}</span>
      {visible && action !== undefined && (
        <button
          type="button"
          onClick={() => {
            action.onClick()
            dismiss.current()
          }}
          className="min-h-[44px] rounded-[10px] px-2.5 font-[750] text-toast-action"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
