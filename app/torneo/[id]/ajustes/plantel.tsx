'use client'

import { useState, useTransition } from 'react'
import { initials } from '@/app/format'
import { addSeat, dropSeat, editSeatName, takeSeat, unlinkSeatOwner, type WriteResult } from './actions'

export interface SeatVM {
  entryId: string
  name: string
  /** El nombre de quien reclamó el asiento, o `null` si todavía no lo reclamó nadie. */
  ownerName: string | null
}

// `min-h-[44px]`: medían 29 de alto, y entre ellos está "Sacar", que es
// destructivo. 44 es el mínimo de la guía de Apple para tocar con el dedo.
const ACTION =
  'flex min-h-[44px] items-center rounded-field bg-chip px-3.5 text-[12.5px] font-extrabold text-muted transition-opacity disabled:opacity-45'

/**
 * El plantel desde Ajustes: renombrar un asiento, soltar el reclamo de quien lo
 * tomó, sacarlo, agregar uno nuevo, y quedarse con uno.
 *
 * No toca `squadSize` ni `points` (decisión registrada 3): eso vive en Formato,
 * y mientras las dos cosas no coincidan la pantalla lo dice con `validateConfig`
 * en vez de arreglarlo por su cuenta.
 *
 * `canTakeSeat` es "quien organiza todavía no tiene asiento". Se pasa desde la
 * página, que es la que puede preguntarlo (`myEntryId`), y apaga el botón entero
 * en vez de dejarlo fallar: `claim_seat` rebota el segundo reclamo, pero ofrecer
 * un botón que siempre rebota es el defecto que ya apareció en "Reabrir fecha".
 *
 * El alta (spec "Ubicar al que llega en el orden de desempate") ya no es un
 * único input con submit al `onBlur`: agregarle el select de posición al lado
 * hubiera hecho que blurear el nombre PARA llegar al select dispare el alta
 * con lo que hubiera tipeado hasta ahí. Por eso es un `<form>` con botón
 * "Agregar" explícito — mismo motivo por el que `BorrarFecha` tiene su propio
 * "Borrar" en vez de un blur.
 */
export function Plantel({
  seasonId,
  seats,
  canTakeSeat,
}: {
  seasonId: string
  seats: SeatVM[]
  canTakeSeat: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newBefore, setNewBefore] = useState('')

  const run = (work: () => Promise<WriteResult>) => {
    setError(null)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setEditing(null)
      setAdding(false)
    })
  }

  return (
    <section id="plantel" className="flex flex-col gap-2 scroll-mt-4">
      <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">Plantel</h2>

      <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
        {seats.map((seat, index) => (
          <div key={seat.entryId} className={`flex flex-col gap-2 p-3 ${index > 0 ? 'border-t border-line' : ''}`}>
            <div className="flex items-center gap-3">
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-chip text-[11px] font-extrabold text-muted">
                {initials(seat.name)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] font-bold">{seat.name}</span>
                <span className="text-[11.5px] font-[600] text-muted">
                  {seat.ownerName ?? 'Sin dueño'}
                </span>
              </span>
            </div>

            {editing === seat.entryId ? (
              <input
                autoFocus
                defaultValue={seat.name}
                disabled={pending}
                onBlur={(event) => {
                  const next = event.target.value
                  if (next.trim() === seat.name.trim()) {
                    setEditing(null)
                    return
                  }
                  run(() => editSeatName(seasonId, seat.entryId, next))
                }}
                className="rounded-field border-[1.5px] border-accent bg-surface p-[10px] text-[16px] font-[750] outline-none"
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={ACTION} onClick={() => setEditing(seat.entryId)}>
                  Editar nombre
                </button>
                {canTakeSeat && seat.ownerName === null && (
                  <button
                    type="button"
                    className={ACTION}
                    disabled={pending}
                    onClick={() => run(() => takeSeat(seasonId, seat.entryId))}
                  >
                    Este soy yo
                  </button>
                )}
                {seat.ownerName !== null && (
                  <button
                    type="button"
                    className={ACTION}
                    disabled={pending}
                    onClick={() => run(() => unlinkSeatOwner(seasonId, seat.entryId))}
                  >
                    Desvincular
                  </button>
                )}
                <button
                  type="button"
                  className={ACTION}
                  disabled={pending}
                  onClick={() => run(() => dropSeat(seasonId, seat.entryId))}
                >
                  Sacar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {adding ? (
        // Nombre y select en un `<form>` con botón explícito: el input solo
        // (con submit al blur) no alcanza en cuanto hay un segundo control —
        // blurear el nombre para llegar al select de posición disparaba el
        // alta con lo que hubiera en el campo en ese instante.
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (newName.trim().length === 0) return
            run(() => addSeat(seasonId, newName, newBefore === '' ? null : newBefore))
          }}
          className="flex flex-col gap-2 rounded-field border-[1.5px] border-accent bg-surface p-3"
        >
          <input
            autoFocus
            placeholder="Nombre"
            disabled={pending}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            className="rounded-field border border-line bg-surface p-[10px] text-[16px] font-[750] outline-none placeholder:font-medium placeholder:text-muted"
          />
          {/* `seats` ya llega ordenado por seedPosition (ajustes/page.tsx), así
              que el select sale en el mismo orden que el plantel — igual que
              "Juega con" en GuestCard. */}
          <label className="flex items-center gap-2 text-[12.5px] font-bold">
            Posición
            <select
              value={newBefore}
              disabled={pending}
              onChange={(event) => setNewBefore(event.target.value)}
              className="flex-1 rounded-field border border-line bg-surface p-[10px] text-[13.5px] font-bold outline-none"
            >
              <option value="">Al final</option>
              {seats.map((seat) => (
                <option key={seat.entryId} value={seat.entryId}>
                  Antes de {seat.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending || newName.trim().length === 0}
              className="flex-1 rounded-field bg-accent p-[10px] text-center text-[13.5px] font-extrabold text-accent-text disabled:opacity-45"
            >
              Agregar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setAdding(false)
                setNewName('')
                setNewBefore('')
              }}
              className="flex-1 rounded-field bg-chip p-[10px] text-center text-[13.5px] font-extrabold text-muted"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true)
            setNewName('')
            setNewBefore('')
          }}
          className="rounded-field border-[1.5px] border-line p-3 text-[13.5px] font-extrabold"
        >
          + Agregar jugador
        </button>
      )}

      {error !== null && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}
    </section>
  )
}
