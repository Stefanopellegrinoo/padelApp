'use client'

import { useRef, useState, useTransition } from 'react'
import { button } from '@/app/ui/button'
import { Sheet } from '@/app/ui/sheet'
import { removeTournament } from './actions'
import { Aviso, CAMPO, ROTULO } from './piezas'

/**
 * Eliminar torneo: lo último de Ajustes, separado del resto por una línea y
 * aire, en rojo. Ocupa el lugar donde estaba "Cerrar sesión", que no era de
 * esta pantalla: cerrar sesión es de la cuenta y ahora vive en Mis torneos.
 *
 * **Pide escribir el nombre, y es el único lugar de la app donde hay fricción a
 * propósito.** No porque sea lo único irreversible —"Borrar fecha"
 * (`fechas/[n]/borrar.tsx`) también se lleva una fecha con los resultados
 * cargados y tampoco se deshace— sino por el tamaño de lo que se lleva: una
 * fecha es una noche, y esto es el año entero del grupo, con las fechas, los
 * partidos, los sets, los premios y el plantel. No hay papelera y nadie tiene
 * backup. Un botón rojo con "¿estás seguro?" está a un toque mal dado de
 * borrarlo.
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
  const campo = useRef<HTMLInputElement>(null)

  const matches = typed.trim() === name.trim()

  return (
    <section aria-label="Eliminar torneo" className="mx-4 mt-10 border-t border-line pt-6">
      <button
        type="button"
        onClick={() => {
          setTyped('')
          setError(null)
          setOpen(true)
        }}
        className={button('danger', { full: true })}
      >
        Eliminar torneo
      </button>
      <p className="mt-2 text-center text-[14px] text-muted">Se borra para todos y no se puede deshacer</p>

      <Sheet open={open} onClose={() => setOpen(false)} title={`¿Eliminar ${name}?`} initialFocus={campo}>
        <div className="flex flex-col gap-4 pt-3">
          <p className="text-pretty text-[16px] leading-[1.45] text-muted">
            {playedCount === 0
              ? 'Todavía no se jugó ninguna fecha. Se borran el plantel y la configuración, para todos, y no se puede deshacer.'
              : `Se borran ${playedCount === 1 ? 'la fecha jugada' : `las ${playedCount} fechas jugadas`}, con sus partidos, sus resultados y sus puntos. Se borra para todos y no se puede deshacer.`}
          </p>

          <label>
            <span className={ROTULO}>Escribí {name} para confirmar</span>
            <input
              ref={campo}
              value={typed}
              disabled={pending}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
              className={CAMPO}
            />
          </label>

          {error !== null && <Aviso alerta>{error}</Aviso>}

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
            className={`press inline-flex min-h-[56px] w-full items-center justify-center rounded-btn px-5 text-[17px] font-bold ${
              matches ? 'bg-live text-bg' : 'bg-chip text-muted'
            }`}
          >
            Eliminar para siempre
          </button>
        </div>
      </Sheet>
    </section>
  )
}
