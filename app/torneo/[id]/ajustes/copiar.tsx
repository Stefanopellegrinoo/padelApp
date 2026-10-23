'use client'

import { useState, useTransition } from 'react'
import { regenerateInviteLink } from './actions'

/**
 * La fila "Link de invitación": copiar y regenerar. Es un componente cliente por
 * lo único que hace (portapapeles y un botón), y porque la URL se arma con
 * `window.location.origin`. El "Regenerar" (S8) llama a la server action y
 * reemplaza el token: el link viejo deja de reclamar asiento.
 */
export function CopiarLink({ seasonId, token }: { seasonId: string; token: string }) {
  const [current, setCurrent] = useState(token)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  function copy() {
    const origin = typeof window === 'undefined' ? '' : window.location.origin
    void navigator.clipboard.writeText(`${origin}/unirse/${current}`)
    setCopied(true)
  }

  function regenerate() {
    // Está pegado a "Copiar" y no tiene vuelta: el link que ya circula en el
    // grupo deja de servir. Un toque de más no puede bastar.
    if (!window.confirm('¿Regenerar el link? El que ya compartiste deja de funcionar.')) return
    startTransition(async () => {
      const result = await regenerateInviteLink(seasonId)
      if (result.ok) {
        setCurrent(result.token)
        setCopied(false)
      }
    })
  }

  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        onClick={copy}
        className="-my-3 flex min-h-[44px] shrink-0 items-center pl-3 text-[13px] font-[750] text-muted"
      >
        {copied ? 'Copiado ✓' : 'Copiar ›'}
      </button>
      <button
        type="button"
        onClick={regenerate}
        disabled={pending}
        className="-my-3 flex min-h-[44px] shrink-0 items-center pl-3 text-[13px] font-[750] text-muted"
      >
        {pending ? 'Regenerando…' : 'Regenerar'}
      </button>
    </div>
  )
}
