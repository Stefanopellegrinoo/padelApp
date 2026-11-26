'use client'

import { useState, useTransition } from 'react'
import { CampoFecha } from '@/app/ui/campo-fecha'
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
 * Guarda al cambiar el valor, sin botón: la fila (`CampoFecha`) abre el
 * selector nativo del teléfono, que ya tiene su propio "listo".
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
    <div className="flex flex-col gap-1.5">
      <CampoFecha
        id="dia"
        value={value}
        onChange={save}
        label="Se juega el"
        kicker="Se juega el"
        disabled={pending}
        pending={pending}
      />
      {error !== null && (
        <p role="alert" className="text-[15px] font-semibold text-live">
          {error}
        </p>
      )}
    </div>
  )
}
