'use client'

import { useState, useTransition } from 'react'
import { removeTournament } from './actions'

/**
 * Eliminar torneo. Ocupa el lugar donde estaba "Cerrar sesión", que no era de
 * esta pantalla: cerrar sesión es de la cuenta y ahora vive en Mis torneos.
 *
 * **Pide escribir el nombre, y es el único lugar de la app donde hay fricción a
 * propósito.** No porque sea lo único irreversible —"Borrar fecha"
 * (`fechas/[n]/borrar.tsx`) también se lleva una fecha con los resultados
 * cargados y tampoco se deshace— sino por el tamaño de lo que se lleva: una
 * fecha es una noche, y esto es el año entero del grupo, con las fechas, los
 * partidos, los sets, los premios y el plantel. No hay papelera y nadie tiene
 * backup. Un botón rojo con "¿estás seguro?" está a un toque mal dado de
 * borrarlo, y este botón vive justo debajo de la lista del plantel, donde el
 * admin toca "Sacar" seguido.
 *
 * El conteo de fechas jugadas no es decoración: es la diferencia entre "estás
 * por borrar un torneo" y "estás por borrar siete fechas jugadas".
 */
export function EliminarTorneo({
  seasonId,
  name,
  playedCount,
}: {
  seasonId: string
  name: string
  playedCount: number
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const matches = typed.trim() === name.trim()

  const close = () => {
    setOpen(false)
    setTyped('')
    setError(null)
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">Torneo</h2>
      <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full px-3 py-3 text-left text-[14px] font-[750] text-live"
        >
          Eliminar torneo
        </button>
      </div>
      <p className="text-[11.5px] font-[600] text-muted">
        Se borra para todos y no se puede deshacer.
      </p>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim px-6 pb-[26px]">
          <div className="w-full max-w-lg rounded-card border border-line bg-surface p-5">
            <h2 className="text-[19px] font-extrabold tracking-[-.02em]">¿Eliminar {name}?</h2>
            <p className="mt-2 text-pretty text-[13.5px] font-[550] leading-[1.5] text-muted">
              {playedCount === 0
                ? 'Todavía no se jugó ninguna fecha. Se borran el plantel y la configuración, para todos, y no se puede deshacer.'
                : `Se borran ${playedCount === 1 ? 'la fecha jugada' : `las ${playedCount} fechas jugadas`}, con sus partidos, sus resultados y sus puntos. Se borra para todos y no se puede deshacer.`}
            </p>

            <label
              htmlFor="confirmar-nombre"
              className="mt-4 block text-[11.5px] font-extrabold text-muted"
            >
              Escribí {name} para confirmar
            </label>
            <input
              id="confirmar-nombre"
              autoFocus
              value={typed}
              disabled={pending}
              onChange={(event) => setTyped(event.target.value)}
              className="mt-1.5 w-full rounded-field border-[1.5px] border-line bg-surface p-[13px] text-[16px] font-[750] outline-none"
            />

            {error !== null && (
              <p className="mt-3 rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
                {error}
              </p>
            )}

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={!matches || pending}
                onClick={() => {
                  setError(null)
                  startTransition(async () => {
                    // En el camino feliz esto no vuelve: la acción redirige a
                    // Mis torneos. Si volvió, es que algo falló.
                    const result = await removeTournament(seasonId)
                    if (!result.ok) setError(result.error)
                  })
                }}
                className={`rounded-field p-3.5 text-center text-[14.5px] font-extrabold ${
                  matches && !pending ? 'bg-live text-bg' : 'bg-chip text-muted'
                }`}
              >
                Eliminar para siempre
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={close}
                className="rounded-field bg-accent p-3.5 text-center text-[14.5px] font-extrabold text-accent-text"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
