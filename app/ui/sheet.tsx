'use client'

import { useEffect, useId, useRef, type PointerEvent, type ReactNode, type RefObject } from 'react'

/** Cuánto hay que bajarla para que se cierre: por distancia o por un tirón rápido. */
const CIERRA_PX = 110
const CIERRA_PX_POR_MS = 0.11

/**
 * La hoja de abajo del prototipo (cargar un resultado, elegir algo): sube
 * desde el borde, con la manija, el título y "Cancelar" arriba.
 *
 * Es un `<dialog>` nativo abierto con `showModal()`, como `ConfirmarNuevo` de
 * /rapido: el modal, el trap de foco, el fondo inerte y el Escape los pone la
 * plataforma. Controlada: `open` la abre y la cierra; `onClose` avisa cuando
 * la cerró la persona —Cancelar, Escape, tocar el fondo o arrastrarla hacia
 * abajo— para que la pantalla baje su estado. Si la cierra la pantalla
 * (después de guardar), no avisa.
 *
 * El foco entra al diálogo y no al primer botón: así la primera pareja no
 * amanece con el anillo puesto (el diálogo no lo dibuja, ver `globals.css`).
 * `initialFocus` lo manda a otro lado (FIFA: el primer campo). Al cerrar
 * vuelve a lo que la abrió.
 *
 * El movimiento (280 ms subiendo con la curva de cajón, 200 bajando, sólo
 * fundido con movimiento reducido) vive en la clase `.hoja` de `globals.css`.
 */
export function Sheet({
  open,
  onClose,
  title,
  closeLabel = 'Cancelar',
  initialFocus,
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  closeLabel?: string
  initialFocus?: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const opener = useRef<HTMLElement | null>(null)
  // Lo último que pidió la pantalla: un `close` que llega con `open` todavía
  // en true lo provocó la persona, y hay que avisar.
  const quiereAbierta = useRef(open)
  const drag = useRef<{ y0: number; t0: number; dy: number } | null>(null)

  useEffect(() => {
    quiereAbierta.current = open
    const dialog = ref.current
    if (dialog === null) return
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.showModal()
      ;(initialFocus?.current ?? dialog).focus({ preventScroll: true })
    } else if (!open && dialog.open) {
      cerrar()
    }
    // `initialFocus` es un ref: leerlo al abrir alcanza.
  }, [open])

  function cerrar() {
    const dialog = ref.current
    if (dialog === null) return
    drag.current = null
    dialog.classList.remove('arrastrando')
    dialog.style.transform = ''
    dialog.close()
  }

  function alCerrarse() {
    const vuelta = opener.current
    opener.current = null
    if (vuelta?.isConnected) vuelta.focus({ preventScroll: true })
    if (quiereAbierta.current) onClose()
  }

  function bajar(event: PointerEvent<HTMLElement>) {
    if ((event.target as Element).closest('button')) return
    drag.current = { y0: event.clientY, t0: performance.now(), dy: 0 }
    ref.current?.classList.add('arrastrando')
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function mover(event: PointerEvent<HTMLElement>) {
    const d = drag.current
    if (d === null || ref.current === null) return
    d.dy = event.clientY - d.y0
    // Hacia arriba se resiste (raíz): no hay más hoja que mostrar.
    const y = d.dy > 0 ? d.dy : -Math.sqrt(-d.dy) * 2
    ref.current.style.transform = `translateY(${y}px)`
  }

  function soltar() {
    const d = drag.current
    if (d === null || ref.current === null) return
    drag.current = null
    ref.current.classList.remove('arrastrando')
    const velocidad = Math.abs(d.dy) / Math.max(performance.now() - d.t0, 1)
    if (d.dy > CIERRA_PX || (d.dy > 10 && velocidad > CIERRA_PX_POR_MS)) cerrar()
    else ref.current.style.transform = ''
  }

  // Se arrastra de la manija o del título, como en el prototipo.
  const arrastre = {
    onPointerDown: bajar,
    onPointerMove: mover,
    onPointerUp: soltar,
    onPointerCancel: soltar,
  }

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="hoja"
      onClose={alCerrarse}
      onCancel={(event) => {
        // Escape: el mismo camino que Cancelar, para que baje animada.
        event.preventDefault()
        cerrar()
      }}
      onClick={(event) => {
        // El contenido llena el diálogo entero: un click que le pega al
        // `<dialog>` mismo sólo pudo caer en el fondo.
        if (event.target === event.currentTarget) cerrar()
      }}
    >
      <div className="px-4 pb-[calc(20px+env(safe-area-inset-bottom))]">
        <div {...arrastre} data-arrastre="" className="flex cursor-grab touch-none justify-center pt-2.5 pb-1">
          <span aria-hidden="true" className="h-[5px] w-10 rounded-full bg-line" />
        </div>
        <div {...arrastre} className="flex touch-none items-center justify-between gap-3">
          <h2 id={titleId} className="font-titulo text-[24px]">
            {title}
          </h2>
          <button
            type="button"
            onClick={cerrar}
            className="min-h-[44px] rounded-[12px] pr-1.5 pl-3 font-semibold text-accent-link"
          >
            {closeLabel}
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
