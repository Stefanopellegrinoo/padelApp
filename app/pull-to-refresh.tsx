'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

const UMBRAL = 70
const MAXIMO = 100

/**
 * Tirar hacia abajo para actualizar, sólo en la app instalada: ahí no hay botón
 * de recargar ni el gesto del navegador (además `globals.css` apaga el rebote),
 * así que sin esto un resultado que cargó otro no se veía sin cerrar la app.
 * `router.refresh()` vuelve a pedir la pantalla al servidor y conserva el
 * estado del cliente (lo tipeado en un formulario sigue ahí).
 */
export function PullToRefresh() {
  const router = useRouter()
  const [distancia, setDistancia] = useState(0)
  const distanciaRef = useRef(0)
  const [actualizando, startTransition] = useTransition()

  useEffect(() => {
    const instalada =
      matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (!instalada) return

    let inicio: number | null = null
    const mover = (d: number) => {
      distanciaRef.current = d
      setDistancia(d)
    }

    function alTocar(e: TouchEvent) {
      inicio = null
      if (window.scrollY > 0 || e.touches.length !== 1) return
      // Una lista con scroll propio que no está arriba: el gesto es de ella.
      for (let el = e.target as Element | null; el !== null; el = el.parentElement) {
        if (el.scrollTop > 0) return
      }
      inicio = e.touches[0]?.clientY ?? null
    }
    function alMover(e: TouchEvent) {
      if (inicio === null) return
      const d = (e.touches[0]?.clientY ?? inicio) - inicio
      mover(d > 0 ? Math.min(d * 0.5, MAXIMO) : 0)
    }
    function alSoltar() {
      if (inicio !== null && distanciaRef.current >= UMBRAL) startTransition(() => router.refresh())
      inicio = null
      mover(0)
    }

    addEventListener('touchstart', alTocar, { passive: true })
    addEventListener('touchmove', alMover, { passive: true })
    addEventListener('touchend', alSoltar)
    addEventListener('touchcancel', alSoltar)
    return () => {
      removeEventListener('touchstart', alTocar)
      removeEventListener('touchmove', alMover)
      removeEventListener('touchend', alSoltar)
      removeEventListener('touchcancel', alSoltar)
    }
  }, [router])

  if (distancia === 0 && !actualizando) return null
  const y = actualizando ? UMBRAL * 0.6 : distancia * 0.6
  return (
    <div
      role="status"
      aria-label={actualizando ? 'Actualizando' : 'Soltá para actualizar'}
      className="pointer-events-none fixed left-1/2 top-0 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-md"
      style={{ transform: `translate(-50%, ${y - 36}px)`, opacity: actualizando ? 1 : Math.min(distancia / UMBRAL, 1) }}
    >
      {actualizando ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        <span style={{ transform: `rotate(${distancia >= UMBRAL ? 180 : 0}deg)`, transition: 'transform .15s' }}>↓</span>
      )}
    </div>
  )
}
