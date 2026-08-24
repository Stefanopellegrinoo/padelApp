'use client'

import { useEffect, useState, useTransition } from 'react'
import type { DisciplineId } from '@/core'
import { openNextMatchday } from '../../actions'

/**
 * Hoy, en el `YYYY-MM-DD` que pide `<input type="date">`, armado con los
 * componentes locales: `toISOString()` es UTC y con huso negativo devuelve ayer.
 *
 * Se exporta para poder probarla: lo que hay que garantizar es que use los
 * componentes LOCALES y no `toISOString()`, que con huso negativo devuelve
 * ayer.
 *
 * El techo que este comentario declaraba —"el default lo calcula quien
 * renderiza primero"— YA NO ES TEÓRICO y por eso se cerró: `vercel.json`
 * existe y `docs/despliegue.md` documenta el deploy, y las funciones de Vercel
 * corren en UTC (la región `gru1` es latencia, no huso). Con Argentina en
 * UTC-3, entre las 21:00 y la medianoche el servidor calculaba MAÑANA. El
 * arreglo es el que el propio comentario nombraba: recalcularlo en un efecto
 * después de montar, que corre siempre en el navegador.
 */
export function today(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

interface AbrirFechaProps {
  seasonId: string
  disciplineId: DisciplineId
  /** El número que va a tener la fecha: el mismo `max(number) + 1` que hace `createMatchday`. */
  number: number
}

export function AbrirFecha({ seasonId, disciplineId, number }: AbrirFechaProps) {
  const [playedOn, setPlayedOn] = useState(today)
  const [error, setError] = useState<string | null>(null)
  // El `useState` de arriba corre TAMBIÉN en el servidor (este componente es
  // cliente, pero Next igual lo renderiza del lado del server para el HTML
  // inicial), y ahí el huso es el de Vercel: UTC. Este efecto corre sólo en el
  // navegador y pisa el valor con el día LOCAL de quien está mirando.
  //
  // Sin dependencias: corre una vez al montar. Si el servidor ya había
  // acertado, `setPlayedOn` recibe el mismo string y no re-renderiza nada. Y
  // no pisa lo que el usuario elija, porque para cuando puede elegir el efecto
  // ya corrió.
  useEffect(() => {
    setPlayedOn(today())
  }, [])
  const [pending, startTransition] = useTransition()

  const blocked = pending || playedOn === ''

  const open = () => {
    setError(null)
    startTransition(async () => {
      const result = await openNextMatchday(seasonId, disciplineId, playedOn)
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {/* Sin label: el control nativo ya se explica (decisión registrada 7). */}
        <input
          type="date"
          value={playedOn}
          onChange={(event) => setPlayedOn(event.target.value)}
          className="rounded-field border border-line bg-surface p-[13px] text-[16px] font-bold outline-none"
        />
        <button
          type="button"
          onClick={open}
          disabled={blocked}
          className={`flex-1 rounded-field p-4 text-[15px] font-extrabold ${
            blocked ? 'bg-chip text-muted' : 'bg-accent text-accent-text'
          }`}
        >
          Abrir fecha {number}
        </button>
      </div>

      {error !== null && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}
    </div>
  )
}
