'use client'

import { useState, useTransition } from 'react'
import { cancelTheMatchday } from './actions'

/**
 * Borra la fecha entera: DRAFT u OPEN, con todo lo que tiene cargado adentro
 * (asistencias, invitados, parejas, partidos, resultados). CLOSED nunca llega
 * hasta acá — `cancel_matchday` la rechaza del lado de la base, y nada la
 * muestra ahí.
 *
 * Vive en su propio archivo con su propio `asking`, y no adentro de
 * `CierreFecha`: esa pantalla ya tiene una confirmación en la misma rama
 * `OPEN` ("Volver al armado" — ver el comentario en `carga.tsx:159-163`), y
 * sumar ésta al mismo booleano hubiera forzado justo la máquina de estados
 * que ese comentario dice que todavía no hace falta. Con un estado propio,
 * nunca hace falta.
 */
export function BorrarFecha({ seasonId, matchdayId }: { seasonId: string; matchdayId: string }) {
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="rounded-field border-[1.5px] border-line p-4 text-center text-[15px] font-extrabold text-live"
      >
        Borrar fecha
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <p className="text-[12.5px] font-bold">
        Se borra la fecha entera: presentismo, invitados, parejas, partidos y resultados. No se puede
        deshacer.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null)
            startTransition(async () => {
              // En el camino feliz esto no vuelve: la acción redirige a la
              // lista de fechas. Si volvió, es que algo falló.
              const result = await cancelTheMatchday(seasonId, matchdayId)
              if (!result.ok) setError(result.error)
            })
          }}
          className="flex-1 rounded-field bg-live p-3 text-center text-[14px] font-extrabold text-bg"
        >
          Borrar
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null)
            setAsking(false)
          }}
          className="flex-1 rounded-field bg-chip p-3 text-center text-[14px] font-extrabold text-muted"
        >
          Cancelar
        </button>
      </div>
      {error !== null && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}
    </div>
  )
}
