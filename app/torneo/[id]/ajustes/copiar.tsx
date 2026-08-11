'use client'

import { useState } from 'react'

/**
 * El valor de la fila "Link de invitación". Es su propio componente por lo
 * único que hace: el portapapeles es del navegador, así que la fila no puede
 * ser un Server Component. La URL se arma acá y no en el servidor porque el
 * origen sale de `window.location`, igual que en el paso 5 del wizard.
 */
export function CopiarLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      onClick={() => {
        const origin = typeof window === 'undefined' ? '' : window.location.origin
        void navigator.clipboard.writeText(`${origin}/unirse/${token}`)
        setCopied(true)
      }}
      className="shrink-0 text-[13px] font-[750] text-muted"
    >
      {copied ? 'Copiado ✓' : 'Copiar ›'}
    </button>
  )
}
