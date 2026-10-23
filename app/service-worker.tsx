'use client'

import { useEffect } from 'react'

/** Registra `public/sw.js`: la pantalla "Sin conexión" y nada más (ver el worker). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])
  return null
}
