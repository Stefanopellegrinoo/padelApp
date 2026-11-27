'use client'

import { useState, useTransition } from 'react'
import { CampoUsuario, useEstadoUsuario, usuarioUsable } from '@/app/ui/campo-usuario'
import { button } from '@/app/ui/button'
import { Sheet } from '@/app/ui/sheet'
import { normalizeUsername } from '@/db/usuario'
import { elegirUsuario } from './actions'

/**
 * El campo y la confirmación de la pantalla única (lámina 07, pasos 3 y 4).
 * Como no se cambia nunca, "Usar @x" no guarda: abre "¿Seguro?", y recién
 * "Sí, usar este" lo manda. "Volver" cierra la hoja y deja el campo como
 * estaba. Si la base lo rechaza (otro lo tomó en el medio), la hoja se cierra
 * y el motivo queda arriba del botón.
 */
export function ElegirUsuario({ inicial, next }: { inicial: string; next: string }) {
  const [username, setUsername] = useState(inicial)
  const estado = useEstadoUsuario(username)
  const [confirmar, setConfirmar] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const elegido = normalizeUsername(username)
  const usable = usuarioUsable(elegido, estado)

  return (
    <div className="flex flex-col gap-3.5 px-4 pt-6">
      <CampoUsuario
        value={username}
        onChange={(value) => {
          setError(null)
          setUsername(value)
        }}
        estado={estado}
      />

      {error !== null && (
        <p role="alert" className="rounded-btn bg-live-bg px-3 py-2.5 text-[15px] font-semibold text-live">
          {error}
        </p>
      )}

      <div className="mt-1.5 flex flex-col gap-1">
        <button
          type="button"
          disabled={!usable || pending}
          onClick={() => setConfirmar(true)}
          className={`${button('primary', { size: 'lg', full: true })} disabled:bg-chip disabled:text-muted disabled:opacity-100`}
        >
          Usar @{elegido}
        </button>
        <p className="text-center text-[14px] text-muted">Es un paso obligatorio, una sola vez. Después entrás directo.</p>
      </div>

      <Sheet open={confirmar} onClose={() => setConfirmar(false)} title="¿Seguro?" closeLabel="Volver">
        <div className="flex flex-col gap-5 pt-1.5">
          <p className="text-[16px] text-muted">@{elegido} no se puede cambiar después.</p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                // En el camino feliz no vuelve: la acción sigue a `next`.
                const result = await elegirUsuario(elegido, next)
                if (result.error !== null) {
                  setConfirmar(false)
                  setError(result.error)
                }
              })
            }
            className={button('primary', { size: 'lg', full: true })}
          >
            Sí, usar este
          </button>
        </div>
      </Sheet>
    </div>
  )
}
