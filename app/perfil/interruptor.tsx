'use client'

import { useId, useState } from 'react'
import { guardarQueMeEncuentren } from './actions'

/**
 * "Que me encuentren por mi usuario" (odd/tasks/amigos-faciles.md, S8, S9;
 * lámina 3 de `design/amigos-faciles/06-perfil.html`): 51 × 31 a la vista y
 * 44 de toque. Cambia apenas lo tocás, sin esperar a la base; si no se pudo
 * guardar, vuelve a como estaba y dice por qué.
 */
export function QueMeEncuentren({ inicial }: { inicial: boolean }) {
  const [prendido, setPrendido] = useState(inicial)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const id = useId()

  const cambiar = async () => {
    // Un segundo toque mientras guarda esperaría a un estado que todavía no se sabe.
    if (guardando) return
    const nuevo = !prendido
    setPrendido(nuevo)
    setError(null)
    setGuardando(true)
    const resultado = await guardarQueMeEncuentren(nuevo)
    setGuardando(false)
    if (!resultado.ok) {
      setPrendido(!nuevo)
      setError(resultado.error)
    }
  }

  return (
    <div>
      <div className="flex items-start gap-3.5">
        <span className="min-w-0 flex-1">
          <span id={`${id}-nombre`} className="block text-[17px] leading-tight font-bold">
            Que me encuentren por mi usuario
          </span>
          <span id={`${id}-ayuda`} className="mt-1 block text-[15px] text-muted">
            Si lo apagás, solo te encuentran con tu link o desde un torneo.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={prendido}
          aria-labelledby={`${id}-nombre`}
          aria-describedby={`${id}-ayuda`}
          aria-busy={guardando}
          onClick={() => void cambiar()}
          className={`relative mt-0.5 h-[31px] w-[51px] shrink-0 rounded-pill after:absolute after:-inset-x-1 after:-inset-y-[7px] after:content-[''] focus-visible:rounded-pill motion-safe:transition-colors ${
            prendido ? 'bg-block' : 'bg-muted'
          }`}
        >
          {/* Prendido, blanco sobre el azul; apagado, el fondo sobre el gris: se ve en claro y en oscuro. */}
          <span
            aria-hidden="true"
            className={`absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full motion-safe:transition-transform ${
              prendido ? 'translate-x-5 bg-on-block' : 'bg-bg'
            }`}
          />
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="mt-3 rounded-btn bg-live-bg px-3 py-2.5 text-[15px] font-semibold text-live">
          {error}
        </p>
      )}
    </div>
  )
}
