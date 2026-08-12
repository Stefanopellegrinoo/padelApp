'use client'

import { useState, useTransition } from 'react'
import { openNextMatchday } from '../actions'

/**
 * Hoy, en el `YYYY-MM-DD` que pide `<input type="date">`, armado con los
 * componentes locales: `toISOString()` es UTC y con huso negativo devuelve ayer.
 *
 * ponytail: el default lo calcula quien renderiza primero, así que con el
 * servidor en otro huso que el navegador el picker puede arrancar un día
 * corrido. Corriendo local son la misma máquina. Si algún día se despliega en
 * UTC, el arreglo es calcularlo en un efecto después de montar.
 */
function today(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

interface AbrirFechaProps {
  seasonId: string
  /** El número que va a tener la fecha: el mismo `max(number) + 1` que hace `createMatchday`. */
  number: number
}

export function AbrirFecha({ seasonId, number }: AbrirFechaProps) {
  const [playedOn, setPlayedOn] = useState(today)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const blocked = pending || playedOn === ''

  const open = () => {
    setError(null)
    startTransition(async () => {
      const result = await openNextMatchday(seasonId, playedOn)
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
