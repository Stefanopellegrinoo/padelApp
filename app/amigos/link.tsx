'use client'

import { useEffect, useState } from 'react'
import { button } from '@/app/ui/button'
import { Sheet } from '@/app/ui/sheet'
import { cambiarMiLink } from './actions'
import { IconoLink } from './link-iconos'

/**
 * "Compartir mi link", en la línea del título de Amigos, y la hoja "Tu link de
 * amistad" que abre (odd/tasks/amigos-faciles.md, S5): el link entero con
 * "Copiar", "Compartir" y "Cambiar el link". Reemplaza al cuadro del ID.
 *
 * El link se arma acá, con el origen de la página: el servidor sólo conoce el
 * token, y así el mismo código sirve en producción, en un preview y en local.
 *
 * "Compartir" abre el menú del teléfono (`navigator.share`) para mandarlo por
 * WhatsApp de una; si no hay menú, lo copia. Cerrar el menú sin elegir no es
 * un error y no copia nada. "Cambiar el link" trae uno nuevo de la base
 * (`cambiarMiLink`): el de ahora deja de andar y las amistades ya hechas
 * siguen. Lo que pasó se anuncia en la región viva de la hoja.
 *
 * `variant="ghost"`: el mismo botón como texto azul, para el buscador sin
 * resultados (S8). Abre la misma hoja, con el mismo link.
 *
 * Sólo el token y la acción, nunca un import de `db/server` ni de
 * `@/db/friends`: un componente `'use client'` que se arrastre `next/headers`
 * rompe el build de producción sin que `tsc` ni los tests lo vean.
 */
export function CompartirMiLink({ token: inicial, variant = 'hero' }: { token: string; variant?: 'hero' | 'ghost' }) {
  const [abierta, setAbierta] = useState(false)
  const [token, setToken] = useState(inicial)
  const [origen, setOrigen] = useState('')
  const [estado, setEstado] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cambiando, setCambiando] = useState(false)

  useEffect(() => setOrigen(window.location.origin), [])

  const link = `${origen}/amigo/${token}`
  const linkEntero = () => `${window.location.origin}/amigo/${token}`

  // Sin portapapeles (http fuera de localhost) o con el permiso negado, decir
  // "Copiado" sería mentir: el link queda a la vista para copiarlo a mano.
  const copiar = async () => {
    try {
      if (navigator.clipboard === undefined) throw new Error('sin portapapeles')
      await navigator.clipboard.writeText(linkEntero())
    } catch {
      setEstado('')
      setError('No se pudo copiar. Mantené apretado el link para copiarlo.')
      return
    }
    setError(null)
    setEstado('Copiado')
  }

  const compartir = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ url: linkEntero() })
        return
      } catch (motivo) {
        // Cerró el menú sin elegir: no pasó nada.
        if (motivo instanceof DOMException && motivo.name === 'AbortError') return
      }
    }
    await copiar()
  }

  const cambiar = async () => {
    setCambiando(true)
    setEstado('')
    setError(null)
    const resultado = await cambiarMiLink()
    setCambiando(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    setToken(resultado.token)
    setEstado('Listo, el link de antes ya no anda.')
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setEstado('')
          setError(null)
          setAbierta(true)
        }}
        className={`${button(variant === 'ghost' ? 'ghost' : 'onBlock')} shrink-0 whitespace-nowrap`}
      >
        <IconoLink name="compartir" />
        Compartir mi link
      </button>
      <Sheet open={abierta} onClose={() => setAbierta(false)} title="Tu link de amistad" closeLabel="Cerrar">
        <p className="mt-1.5 text-[16px] text-muted">
          Quien lo abra queda como tu amigo. Mandáselo a quien quieras sumar.
        </p>
        <div className="mt-4 flex items-center gap-2.5 rounded-tile bg-surface py-2 pr-2 pl-3.5">
          <IconoLink name="link" className="h-[22px] w-[22px] text-muted" />
          <code className="min-w-0 flex-1 truncate font-mono text-[16px] text-text select-all">{link}</code>
          <button type="button" onClick={() => void copiar()} className={button('secondary')}>
            <IconoLink name="copiar" />
            Copiar
          </button>
        </div>
        <p aria-live="polite" className="mt-2 min-h-5 text-[15px] font-semibold text-up empty:hidden">
          {estado}
        </p>
        <button
          type="button"
          onClick={() => void compartir()}
          className={`${button('primary', { size: 'lg', full: true })} mt-3`}
        >
          <IconoLink name="compartir" />
          Compartir
        </button>
        <div aria-hidden="true" className="mt-4 mb-2 h-px bg-line" />
        <button
          type="button"
          onClick={() => void cambiar()}
          disabled={cambiando}
          className={`${button('ghost')} -ml-4`}
        >
          <IconoLink name="rotar" />
          Cambiar el link
        </button>
        <p className="text-[14px] text-muted">El de ahora deja de andar. Tus amigos siguen.</p>
        {error !== null && (
          <p role="alert" className="mt-3 rounded-btn bg-live-bg px-3 py-2.5 text-[15px] font-semibold text-live">
            {error}
          </p>
        )}
      </Sheet>
    </>
  )
}
