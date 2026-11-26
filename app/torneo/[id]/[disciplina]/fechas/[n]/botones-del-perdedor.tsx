'use client'

import type { MatchFormat } from '@/core'
import { deuceOptions, deuceWinnerGames } from '@/app/amigos/[playerId]/cargar-state'
import { loserGamesOptions } from './carga-state'

const PREGUNTA = 'mt-3.5 mb-2.5 text-[17px] font-bold'
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * El segundo toque: con cuántos se quedó el que perdió. Si el set se gana por
 * dos (ping pong, sin tie-break) siguen los de ventaja, "12-10" … "16-14"
 * (`deuceOptions`, los mismos de amigos); con el set real son "7-5" y "7-6",
 * y abajo se dice que el segundo es el del tie-break. Con tie-break a secas
 * `deuceOptions` da `[]` y el pádel de antes queda como siempre. Sin ganador elegido se ven pero no se tocan: la
 * hoja no salta de alto entre un toque y otro.
 *
 * En su módulo y no en `carga.tsx`: lo usan la fecha, los partidos con amigos
 * y el torneo rápido, y este último no tiene por qué traer las acciones de la fecha.
 */
export function BotonesDelPerdedor({
  format,
  unit,
  loserName,
  pending,
  elegido = null,
  onLoser,
  onDeuce,
}: {
  format: MatchFormat
  unit: string
  /** El que perdió, o `null` mientras no se eligió quién ganó. */
  loserName: string | null
  pending: boolean
  /** El botón marcado: el precargado al corregir, o el que se intentó guardar. */
  elegido?: { loser: number; deuce: boolean } | null
  onLoser: (n: number) => void
  onDeuce: (loser: number) => void
}) {
  const apagado = pending || loserName === null
  const numero = (activo: boolean) =>
    `flex min-h-[60px] items-center justify-center rounded-btn border-[1.5px] font-cond ${
      activo ? 'border-block bg-block text-on-block' : 'border-line text-text active:bg-sport-tint'
    }`
  return (
    <>
      <p className={PREGUNTA}>
        {loserName === null ? `${cap(unit)} del que perdió` : `${cap(unit)} de ${loserName}`}
      </p>
      <div className="grid grid-cols-6 gap-2">
        {loserGamesOptions(format).map((games) => {
          const activo = elegido !== null && !elegido.deuce && elegido.loser === games
          return (
            <button
              key={games}
              type="button"
              disabled={apagado}
              aria-pressed={activo}
              className={`${numero(activo)} text-[30px]`}
              onClick={() => onLoser(games)}
            >
              {games}
            </button>
          )
        })}
      </div>
      {deuceOptions(format).length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {deuceOptions(format).map((loser) => {
            const activo = elegido !== null && elegido.deuce && elegido.loser === loser
            const won = deuceWinnerGames(format, loser)
            return (
              <button
                key={`deuce-${loser}`}
                type="button"
                disabled={apagado}
                aria-pressed={activo}
                aria-label={`${won} a ${loser}${won - loser === 1 ? ', con tie-break' : ''}`}
                className={`${numero(activo)} text-[26px]`}
                onClick={() => onDeuce(loser)}
              >
                {`${won}-${loser}`}
              </button>
            )
          })}
        </div>
      )}
      {format.ventaja === true && !format.openScore && (
        <p className="mt-2 text-[14px] text-muted">{`El ${format.gamesPerSet + 1}-${format.gamesPerSet} es con tie-break.`}</p>
      )}
    </>
  )
}
