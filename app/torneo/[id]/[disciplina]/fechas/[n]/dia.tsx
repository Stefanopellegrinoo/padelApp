'use client'

import { useState, useTransition } from 'react'
import { changeMatchdayDate } from './actions'

/**
 * El día de la fecha, editable por quien organiza.
 *
 * Hasta ahora se elegía UNA vez, al abrir la fecha, y quedaba así para siempre:
 * `played_on` sólo se escribía en el insert. Un toque de más en "Abrir fecha" y
 * el día quedaba mal el resto del año.
 *
 * Se puede corregir en cualquier estado, cerrada incluida. No es descuido: el
 * día no ordena las fechas —eso lo hace `number`— ni entra en ningún cálculo,
 * así que enterarse tarde de que se jugó otro día no tiene por qué obligar a
 * reabrir nada. Y el grant de la base es por columna (`update (played_on)`),
 * así que desde acá no se puede tocar el estado ni el número aunque se quiera.
 *
 * Guarda al cambiar el valor, sin botón: es un `<input type="date">`, y el
 * picker nativo ya tiene su propio "listo".
 */
export function DiaDeLaFecha({
  seasonId,
  matchdayId,
  matchdayNumber,
  playedOn,
}: {
  seasonId: string
  matchdayId: string
  matchdayNumber: number
  playedOn: string | null
}) {
  const [value, setValue] = useState(playedOn ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const save = (next: string) => {
    setValue(next)
    if (next === '' || next === playedOn) return
    setError(null)
    startTransition(async () => {
      const result = await changeMatchdayDate(seasonId, matchdayId, matchdayNumber, next)
      if (!result.ok) {
        setError(result.error)
        setValue(playedOn ?? '')
      }
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor="dia" className="text-[11.5px] font-extrabold text-muted">
          Se juega el
        </label>
        <input
          id="dia"
          type="date"
          value={value}
          disabled={pending}
          onChange={(event) => save(event.target.value)}
          className="rounded-field border border-line bg-surface px-3 py-2 text-[16px] font-bold outline-none transition-opacity disabled:opacity-45"
        />
      </div>
      {error !== null && <p className="text-[12px] font-bold text-live">{error}</p>}
    </div>
  )
}
