'use client'

import { useState, useTransition } from 'react'
import { MASTERS_SIZE, type DisciplineId } from '@/core'
import { Avatar } from '@/app/ui/avatar'
import { button } from '@/app/ui/button'
import { CampoFecha } from '@/app/ui/campo-fecha'
import { buildMasters, confirmMatchday, drawMastersPairs, type WriteResult } from './actions'
import { BorrarFecha } from './borrar'

const ERROR_NOTE = 'rounded-btn bg-live-bg px-3 py-2.5 text-[15px] font-semibold text-live'

/** Hoy en `YYYY-MM-DD`, con componentes locales: `toISOString()` es UTC y con huso negativo da ayer. */
function today(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * El CTA que reemplaza al chip "Bloqueado" del bloque de Fechas cuando todas
 * las fechas regulares cerraron y soy admin. El resto del bloque —kicker,
 * título, cuerpo, medidas— no se toca.
 *
 * Vive en este archivo, y no en `fechas/abrir.tsx`, porque es el componente del
 * Masters: lo importa `fechas/page.tsx` desde acá.
 */
export function ArmarMasters({
  seasonId,
  disciplineId,
}: {
  seasonId: string
  /** C36: el Masters es de UNA disciplina, y el CTA se dibuja en cada una. */
  disciplineId: DisciplineId
}) {
  const [playedOn, setPlayedOn] = useState(today)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="mt-4 flex flex-col gap-2">
      <CampoFecha value={playedOn} onChange={setPlayedOn} label="Día del Masters" kicker="Se juega el" />
      <button
        type="button"
        disabled={pending || playedOn === ''}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            const result = await buildMasters(seasonId, disciplineId, playedOn)
            if (!result.ok) setError(result.error)
          })
        }}
        className={button('primary', { size: 'lg', full: true })}
      >
        Armar el Masters
      </button>
      {error !== null && (
        <p role="alert" className={ERROR_NOTE}>
          {error}
        </p>
      )}
    </div>
  )
}

export interface QualifierVM {
  entryId: string
  name: string
  points: number
}

/**
 * El `DRAFT` del Masters, que no es el armado de una fecha regular: no hay
 * asistencias, no hay invitado y no hay nada que tildar. Los cuatro salen del
 * ranking del año y lo único que se hace acá es generar los tres partidos.
 */
export function MastersDraft({
  seasonId,
  matchdayId,
  disciplina,
  matchdayNumber,
  qualifiers,
  generated,
  loadedResults,
}: {
  seasonId: string
  matchdayId: string
  /** El slug de la URL desde la que se abrió esta fecha — lo necesita `BorrarFecha` para volver a la lista correcta. */
  disciplina: string
  matchdayNumber: number
  qualifiers: QualifierVM[]
  /** Si los tres partidos ya están sorteados. Recién ahí se puede confirmar. */
  generated: boolean
  /**
   * Cuántos de esos partidos ya tienen sets cargados. En DRAFT no siempre es
   * cero: `redraft_matchday` vuelve de OPEN a DRAFT sin borrar resultados.
   * Sólo lo usa el aviso de "Borrar fecha".
   */
  loadedResults: number
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const run = (work: () => Promise<WriteResult>) => {
    setError(null)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-titulo text-[24px]">{`Los ${MASTERS_SIZE} primeros del año`}</h2>

      <ol className="-mx-4">
        {qualifiers.map((row, index) => (
          <li
            key={row.entryId}
            className="flex min-h-[56px] items-center gap-3 border-t border-line px-4 py-2 first:border-t-0"
          >
            {/* S85 (verify-report-pr21-cierre #4016): mismo gemelo que
                armado.tsx/desempate.tsx. Acá es sólo consistencia -- `index + 1`
                nunca pasa de MASTERS_SIZE=4 (core/constants.ts), así que este
                span jamás corta un número de dos dígitos hoy -- pero es la
                misma forma copiada tres veces y conviene que las tres digan
                lo mismo. */}
            <span className="font-cond w-5 shrink-0 text-[24px]">{index + 1}</span>
            <Avatar name={row.name} />
            <span className="min-w-0 flex-1 text-[17px] font-semibold">{row.name}</span>
            <span className="font-cond shrink-0 text-[26px]">
              {row.points}
              <small className="ml-1 font-sans text-[14px] font-semibold text-muted [font-stretch:100%]">pts</small>
            </span>
          </li>
        ))}
      </ol>

      {error !== null && (
        <p role="alert" className={ERROR_NOTE}>
          {error}
        </p>
      )}

      {/* "Confirmar fecha" es el mismo copy y la misma acción que una fecha
          regular: `openMatchday` ya sabe que el Masters no tiene asistencias.
          Sin este botón la jornada se arma y nunca llega a `OPEN`. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => drawMastersPairs(seasonId, matchdayId, matchdayNumber))}
          className={generated ? button('secondary', { size: 'lg' }) : `${button('primary', { size: 'lg' })} flex-1`}
        >
          Generar los partidos
        </button>

        {generated && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => confirmMatchday(seasonId, matchdayId, matchdayNumber))}
            className={`${button('primary', { size: 'lg' })} flex-1`}
          >
            Confirmar fecha
          </button>
        )}
      </div>

      <BorrarFecha seasonId={seasonId} matchdayId={matchdayId} disciplina={disciplina} loadedResults={loadedResults} />
    </div>
  )
}
