'use client'

import { useEffect, useState } from 'react'
import { Toast } from './toast'

/**
 * Un aviso que llega por la URL, de una acción que terminó en otra pantalla
 * ("Listo, ya son amigos" al sumarse con un link de amistad, `?amistad=nueva`):
 * se muestra una vez al entrar, con el `Toast` de siempre, y `param` sale de
 * la URL con `replaceState`, así volver atrás o recargar no lo repite. Mismo
 * criterio que el `?cargar=1` de `CargarConAmigo`.
 *
 * El mensaje se pone en un efecto y no en el estado inicial: la región viva
 * del `Toast` tiene que estar dibujada vacía antes, para que el lector de
 * pantalla lo anuncie.
 */
export function AvisoAlEntrar({ message, param, className }: { message: string; param: string; className?: string }) {
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    setAviso(message)
    const url = new URL(window.location.href)
    url.searchParams.delete(param)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    // Sólo al llegar.
  }, [])

  return <Toast message={aviso} onDismiss={() => setAviso(null)} className={className} />
}
