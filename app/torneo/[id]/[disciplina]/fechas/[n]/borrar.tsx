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
 * que ese comentario dice que todavía no hace falta.
 *
 * **El estado propio no alcanza para que no compitan**, al contrario: es lo
 * que las deja abiertas a la vez. Quien decide que nunca se apilen es el
 * `!asking` con el que `CierreFecha` monta este componente; acá no hay forma
 * de saberlo y por eso no se intenta.
 *
 * `loadedResults` es obligatorio, sin default: una fecha en DRAFT SÍ puede
 * tener resultados cargados. `redraft_matchday` (0011) mueve OPEN → DRAFT con
 * un solo `update` de `status` y no borra nada —`db/redraft.db.test.ts:210` lo
 * pinnea—, así que el admin que carga tres resultados y vuelve al armado ve
 * esta pantalla con esos tres todavía adentro. Un default `0` acá le sacaba la
 * fricción de abajo justo en el único camino donde la pérdida es real.
 */
export function BorrarFecha({
  seasonId,
  matchdayId,
  disciplina,
  loadedResults,
}: {
  seasonId: string
  matchdayId: string
  /** El slug de la URL desde la que se abrió esta fecha: a esa lista vuelve el borrado, no a la disciplina por defecto. */
  disciplina: string
  loadedResults: number
}) {
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

  // Nombrar lo que se pierde es la versión barata de la fricción de
  // `ajustes/eliminar.tsx:64-66`: "estás por borrar una fecha" y "estás por
  // borrar tres resultados ya cargados" no son el mismo aviso. El singular va
  // aparte porque "los 1 resultados" es el plural roto que este proyecto ya
  // tiene anotado como deuda en otros dos copys.
  const perdida =
    loadedResults === 0
      ? 'resultados'
      : loadedResults === 1
        ? 'el resultado ya cargado'
        : `los ${loadedResults} resultados ya cargados`

  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <p className="text-[12.5px] font-bold">
        Se borra la fecha entera: presentismo, invitados, parejas, partidos y {perdida}. No se puede
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
              const result = await cancelTheMatchday(seasonId, matchdayId, disciplina)
              if (!result.ok) setError(result.error)
            })
          }}
          className={`flex-1 rounded-field p-3 text-center text-[14px] font-extrabold ${
            pending ? 'bg-chip text-muted' : 'bg-live text-bg'
          }`}
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
