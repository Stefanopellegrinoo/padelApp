'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export interface StandingsRow {
  entryId: string
  displayName: string
  initials: string
  position: number
  points: number
  /** `null` = nada contra qué comparar (primera fecha), se dibuja vacío. `0` = no se movió, se dibuja "—". */
  movement: number | null
  /** El otro jugador empatado en puntos, si lo hay. */
  tiedWithEntryId: string | null
}

export interface TiebreakEntry {
  entryId: string
  displayName: string
}

interface DesempateProps {
  seasonId: string
  rows: StandingsRow[]
  mastersCutoff: number
  tiebreakOrder: TiebreakEntry[]
  tiebreakSnapshotEvery: number
  /** `null` cuando todavía no hubo ningún refresco: rige el orden inicial del wizard. */
  asOfMatchday: number | null
  nextRefreshMatchday: number
}

function movementLabel(movement: number | null): string | null {
  if (movement === null) return null
  if (movement === 0) return '—'
  return movement > 0 ? `▲${movement}` : `▼${Math.abs(movement)}`
}

function movementColor(movement: number | null): string {
  if (movement === null || movement === 0) return 'text-muted'
  return movement > 0 ? 'text-up' : 'text-down'
}

/** Sección "Tabla general" + el sheet de desempate. Un solo componente porque ambos disparadores —el botón fijo y cada chip ⓘ— comparten el mismo estado de qué hay abierto. */
export function Desempate({
  seasonId,
  rows,
  mastersCutoff,
  tiebreakOrder,
  tiebreakSnapshotEvery,
  asOfMatchday,
  nextRefreshMatchday,
}: DesempateProps) {
  const router = useRouter()
  const [openFor, setOpenFor] = useState<string | 'all' | null>(null)

  const clickedRow =
    openFor !== null && openFor !== 'all' ? (rows.find((row) => row.entryId === openFor) ?? null) : null
  const tieMateId = clickedRow !== null ? clickedRow.tiedWithEntryId : null
  const tieMate = tieMateId !== null ? (rows.find((row) => row.entryId === tieMateId) ?? null) : null

  let first: StandingsRow | null = null
  let second: StandingsRow | null = null
  if (clickedRow !== null && tieMate !== null) {
    if (clickedRow.position < tieMate.position) {
      first = clickedRow
      second = tieMate
    } else {
      first = tieMate
      second = clickedRow
    }
  }

  const highlightedIds = new Set<string>()
  if (first !== null && second !== null) {
    highlightedIds.add(first.entryId)
    highlightedIds.add(second.entryId)
  }

  const cutText = asOfMatchday === null ? 'el orden inicial' : `el orden del cierre de la fecha ${asOfMatchday}`
  const explanation =
    asOfMatchday === null
      ? `Es el orden inicial. Se actualiza cada ${tiebreakSnapshotEvery} fechas: el próximo refresco es al cerrar la fecha ${nextRefreshMatchday}.`
      : `Es la tabla al cierre de la fecha ${asOfMatchday}. Se actualiza cada ${tiebreakSnapshotEvery} fechas: el próximo refresco es al cerrar la fecha ${nextRefreshMatchday}.`

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-extrabold tracking-[-.02em]">Tabla general</p>
        <button
          type="button"
          onClick={() => setOpenFor('all')}
          className="flex min-h-[44px] items-center rounded-full border border-line bg-surface px-3.5 text-[11.5px] font-extrabold text-muted"
        >
          Orden de desempate ⇅
        </button>
      </div>

      <div className="flex flex-col">
        {rows.map((row, index) => (
          <div key={row.entryId}>
            <div
              onClick={() => router.push(`/torneo/${seasonId}/jugador/${row.entryId}`)}
              className={`flex cursor-pointer items-center gap-3 rounded-field p-3 ${
                row.position === 1 ? 'bg-chip' : ''
              }`}
            >
              <span className="w-4 shrink-0 text-[14px] font-extrabold text-muted">{row.position}</span>
              <span
                className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${
                  row.position === 1 ? 'bg-accent text-accent-text' : 'bg-chip text-muted'
                }`}
              >
                {row.initials}
              </span>
              <span className="flex flex-1 items-center gap-1.5 text-[15px] font-bold">
                {row.displayName}
                {row.tiedWithEntryId !== null && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      setOpenFor(row.entryId)
                    }}
                    className="flex h-11 min-w-11 items-center justify-center text-[10px] font-extrabold"
                  >
                    ⓘ
                  </button>
                )}
              </span>
              <span className={`w-7 shrink-0 text-right text-[14px] font-extrabold ${movementColor(row.movement)}`}>
                {movementLabel(row.movement)}
              </span>
              <span className="w-[34px] shrink-0 text-right text-[17px] font-extrabold">{row.points}</span>
            </div>
            {index === mastersCutoff - 1 && index < rows.length - 1 && (
              <div className="flex items-center gap-2 py-2">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[9.5px] font-extrabold uppercase tracking-[.13em] text-muted">
                  Clasifican al Masters
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
          </div>
        ))}
      </div>

      {openFor !== null && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-scrim"
          onClick={() => setOpenFor(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="rounded-t-[22px] bg-bg p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-[38px] rounded-full bg-line" />
            <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
              Orden de desempate
            </p>
            <h2 className="text-[20px] font-extrabold">Quién va antes</h2>

            {first !== null && second !== null && (
              <p className="mt-3 rounded-field bg-ok-bg p-3 text-[13px] font-semibold">
                {first.displayName} va antes que {second.displayName}. Están {first.points} a {second.points}{' '}
                y corta {cutText}.
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              {tiebreakOrder.map((entry, index) => (
                <div
                  key={entry.entryId}
                  className={`rounded-field px-3 py-2 text-[13.5px] font-semibold ${
                    highlightedIds.has(entry.entryId) ? 'bg-ok-bg' : 'bg-surface'
                  }`}
                >
                  {index + 1}. {entry.displayName}
                </div>
              ))}
            </div>

            <p className="mt-4 text-[12.5px] font-[550] text-muted">{explanation}</p>

            <button
              type="button"
              onClick={() => setOpenFor(null)}
              className="mt-4 w-full rounded-field bg-chip p-3 text-center font-extrabold"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  )
}
