'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Sheet } from '@/app/ui/sheet'

export interface StandingsRow {
  entryId: string
  displayName: string
  position: number
  points: number
  /** `null` = nada contra qué comparar (primera fecha), se dibuja vacío. `0` = no se movió, se dibuja "=". */
  movement: number | null
  /** Fechas jugadas. `null` en la tabla general: no hay una cuenta común entre deportes. */
  played: number | null
  /** La fila del que mira (o la pareja donde está): va en amarillo, lo único amarillo de la tabla. */
  isMe: boolean
  /** El otro jugador empatado en puntos, si lo hay. */
  tiedWithEntryId: string | null
}

export interface TiebreakEntry {
  entryId: string
  displayName: string
}

interface DesempateProps {
  /**
   * El prefijo del perfil de cada fila (`${base}/jugador/{entryId}`):
   * `/torneo/{seasonId}/{disciplina}`. La general (`page.tsx`) pasa la
   * primera disciplina. `null` deja las filas sin link.
   */
  base: string | null
  rows: StandingsRow[]
  mastersCutoff: number
  /** Vacío en la general, que no tiene desempate propio: sin orden no hay botón. */
  tiebreakOrder: TiebreakEntry[]
  tiebreakSnapshotEvery: number
  /** `null` cuando todavía no hubo ningún refresco: rige el orden inicial del wizard. */
  asOfMatchday: number | null
  nextRefreshMatchday: number
  /** El título de la sección, para el lector de pantalla (a la vista ya lo dice el encabezado). Default "Tabla general"; la de un deporte con 2+ en la temporada dice de cuál. */
  title?: string
  /** Cambio de puesto y fechas jugadas: la de un deporte sí; la general, que suma deportes sin fechas en común, no. */
  showMatchdayColumns?: boolean
  /** Las reglas que explican la tabla, en una línea, debajo (`footnoteOf`). */
  footnote?: string | null
}

/** Puesto, nombre, cambio, fechas y puntos, como el prototipo; la general sólo puesto, nombre y puntos. */
const COLS_DEPORTE = 'grid-cols-[40px_1fr_44px_48px_48px]'
const COLS_GENERAL = 'grid-cols-[40px_1fr_56px]'

/** Sube (azul) o baja (rojo) siempre con triángulo y número; "=" si no se movió; nada si no hay contra qué. */
function Cambio({ movement }: { movement: number | null }) {
  if (movement === null) return <span />
  if (movement === 0) {
    return (
      <span role="img" aria-label="igual" className="text-right text-[14px] font-bold text-muted">
        =
      </span>
    )
  }
  const sube = movement > 0
  return (
    <span
      role="img"
      aria-label={sube ? `sube ${movement}` : `baja ${-movement}`}
      className={`inline-flex items-center justify-end gap-0.5 text-[14px] font-bold tabular-nums ${sube ? 'text-up' : 'text-down'}`}
    >
      <svg aria-hidden="true" viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-current">
        <path d={sube ? 'M5 1.5L9.5 8.5H.5z' : 'M5 8.5L.5 1.5h9z'} />
      </svg>
      {Math.abs(movement)}
    </span>
  )
}

/** La tabla (de un deporte o la general) + la hoja del orden de desempate. Un solo componente porque los dos disparadores —el botón de abajo y cada ⓘ— comparten el mismo estado de qué hay abierto. */
export function Desempate({
  base,
  rows,
  mastersCutoff,
  tiebreakOrder,
  tiebreakSnapshotEvery,
  asOfMatchday,
  nextRefreshMatchday,
  title = 'Tabla general',
  showMatchdayColumns = true,
  footnote = null,
}: DesempateProps) {
  const [openFor, setOpenFor] = useState<string | 'all' | null>(null)
  const cols = showMatchdayColumns ? COLS_DEPORTE : COLS_GENERAL

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
  const explanation = `${asOfMatchday === null ? 'Orden inicial' : `Tabla al cierre de la fecha ${asOfMatchday}`}. Se actualiza cada ${tiebreakSnapshotEvery} fechas: la próxima, al cerrar la fecha ${nextRefreshMatchday}.`

  return (
    <section>
      <h2 className="sr-only">{title}</h2>
      <div aria-hidden="true" className={`grid ${cols} h-9 items-center gap-1 px-4 pt-2 text-[13px] font-semibold text-muted`}>
        <span />
        <span>Jugador</span>
        {showMatchdayColumns && (
          <>
            <span />
            <span className="text-right">Fechas</span>
          </>
        )}
        <span className="text-right">Pts</span>
      </div>

      <ol>
        {rows.map((row, index) => (
          <Fila
            key={row.entryId}
            row={row}
            cols={cols}
            href={base === null ? null : `${base}/jugador/${row.entryId}`}
            showMatchdayColumns={showMatchdayColumns}
            // El divisor de arriba no va pegado a tu fila: la marca ya la separa.
            afterMe={rows[index - 1]?.isMe === true}
            onTie={() => setOpenFor(row.entryId)}
            cut={index === mastersCutoff - 1 && index < rows.length - 1}
          />
        ))}
      </ol>

      {(footnote !== null || tiebreakOrder.length > 0) && (
        <div className="px-4 pt-3 pb-4">
          {footnote !== null && <p className="text-[14px] text-muted">{footnote}</p>}
          {tiebreakOrder.length > 0 && (
            <button
              type="button"
              onClick={() => setOpenFor('all')}
              className="-ml-1 mt-1 min-h-[44px] rounded-btn px-1 text-[15px] font-semibold text-accent-link active:bg-sport-tint"
            >
              Orden de desempate
            </button>
          )}
        </div>
      )}

      <Sheet open={openFor !== null} onClose={() => setOpenFor(null)} title="Orden de desempate" closeLabel="Cerrar">
        {first !== null && second !== null && (
          <p className="mt-3 rounded-tile bg-sport-tint p-3 text-[15px] font-semibold">
            {first.displayName} va antes que {second.displayName}. Están {first.points} a {second.points} y corta{' '}
            {cutText}.
          </p>
        )}

        <ol className="mt-4 grid grid-cols-2 gap-2">
          {tiebreakOrder.map((entry, index) => (
            <li
              key={entry.entryId}
              className={`flex min-h-[44px] items-center gap-2 rounded-btn px-3 text-[15px] ${
                highlightedIds.has(entry.entryId) ? 'bg-sport-tint font-bold' : 'bg-chip font-semibold dark:bg-opcion'
              }`}
            >
              <span className="font-cond w-6 shrink-0 text-[20px]">{index + 1}</span>
              <span className="min-w-0 truncate">{entry.displayName}</span>
            </li>
          ))}
        </ol>

        <p className="mt-4 text-[14px] text-muted">{explanation}</p>
      </Sheet>
    </section>
  )
}

function Fila({
  row,
  cols,
  href,
  showMatchdayColumns,
  afterMe,
  onTie,
  cut,
}: {
  row: StandingsRow
  cols: string
  href: string | null
  showMatchdayColumns: boolean
  afterMe: boolean
  onTie: () => void
  cut: boolean
}) {
  // Tu fila: amarilla en claro; en oscuro elevada con el borde amarillo y el puesto en amarillo.
  const mine = row.isMe ? ' border-transparent bg-vos-fila text-on-vos shadow-[inset_4px_0_0_var(--color-vos-borde)] dark:text-text' : ''
  return (
    <>
      <li
        className={`relative grid ${cols} min-h-[48px] items-center gap-1 border-t px-4 ${
          afterMe ? 'border-transparent' : 'border-line'
        }${href === null ? '' : ' press-fila'}${mine}`}
      >
        <span className={`font-cond text-[26px]${row.isMe ? ' dark:text-vos' : ''}`}>{row.position}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          {href === null ? (
            <span className="min-w-0 py-1 text-[16px] leading-tight font-semibold [overflow-wrap:anywhere]">{row.displayName}</span>
          ) : (
            // El link es el nombre y su `::after` cubre la fila entera: toda la
            // fila se toca, el lector de pantalla lee un link con el nombre, y
            // el ⓘ (encima, `z-10`) sigue siendo su propio botón. El nombre no
            // se corta con "…": si no entra, baja a una segunda línea.
            <Link href={href} className="min-w-0 py-1 text-[16px] leading-tight font-semibold [overflow-wrap:anywhere] after:absolute after:inset-0">
              {row.displayName}
            </Link>
          )}
          {row.isMe && <span className="shrink-0 text-[13px] font-semibold">vos</span>}
          {row.tiedWithEntryId !== null && (
            <button
              type="button"
              onClick={onTie}
              aria-label={`Desempate de ${row.displayName}`}
              className="relative z-10 -my-1 flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-[16px] font-bold text-accent-link"
            >
              ⓘ
            </button>
          )}
        </span>
        {showMatchdayColumns && (
          <>
            <Cambio movement={row.movement} />
            <span className="text-right tabular-nums text-muted">
              {row.played}
              <span className="sr-only"> fechas</span>
            </span>
          </>
        )}
        <span className="text-right">
          <span className="font-cond text-[26px]">{row.points}</span>
          <span className="sr-only"> puntos</span>
        </span>
      </li>
      {cut && (
        <li role="separator" aria-label="Clasifican al Masters" className="flex items-center gap-2 px-4 py-1.5 text-[13px] font-bold text-sport">
          <span aria-hidden="true" className="h-0.5 w-5 bg-sport" />
          Clasifican al Masters
          <span aria-hidden="true" className="h-0.5 flex-1 bg-sport" />
        </li>
      )}
    </>
  )
}
