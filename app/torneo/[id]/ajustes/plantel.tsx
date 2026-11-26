'use client'

import { useRef, useState, useTransition, type ReactNode } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { button } from '@/app/ui/button'
import { rowMeta, rowTitle } from '@/app/ui/row'
import { Section } from '@/app/ui/section'
import { Sheet } from '@/app/ui/sheet'
import { addSeat, dropSeat, editSeatName, takeSeat, unlinkSeatOwner, type WriteResult } from './actions'
import { VOS_FILA } from '@/app/torneo/[id]/[disciplina]/jugador/piezas'
import { Aviso, CAMPO, Chevron, FILA_CAJA, GRUPO, ROTULO } from './piezas'

export interface SeatVM {
  entryId: string
  name: string
  /** El nombre de quien reclamó el asiento, o `null` si todavía no lo reclamó nadie. */
  ownerName: string | null
}

/**
 * El plantel desde Ajustes: la lista, y una hoja por asiento para renombrarlo,
 * quedarse con él, soltar el reclamo de quien lo tomó o sacarlo; otra hoja
 * para sumar uno nuevo.
 *
 * Antes cada asiento llevaba sus tres o cuatro botones a la vista, "Sacar"
 * incluido, y el renombre guardaba al salir del campo: una lista de 8 era un
 * muro de botones grises con el destructivo mezclado. Ahora la lista es de
 * nombres y lo que se hace con uno está en su hoja, con "Sacar" en rojo y
 * aparte. Si una acción rebota, la hoja sigue abierta con el motivo.
 *
 * No toca `squadSize` ni `points` (decisión registrada 3): eso vive en las
 * reglas del deporte, y mientras las dos cosas no coincidan la pantalla lo
 * dice con `validateConfig` en vez de arreglarlo por su cuenta.
 *
 * `canTakeSeat` es "quien organiza todavía no tiene asiento". Se pasa desde la
 * página, que es la que puede preguntarlo (`myEntryId`), y esconde "Este soy
 * yo" en vez de dejarlo fallar: `claim_seat` rebota el segundo reclamo, pero
 * ofrecer un botón que siempre rebota es el defecto que ya apareció en
 * "Reabrir fecha".
 *
 * El alta (spec "Ubicar al que llega en el orden de desempate") es un
 * `<form>` con nombre, posición y "Agregar" explícito: con el select al lado,
 * guardar al salir del nombre dispararía el alta a mitad de camino.
 *
 * `children` va arriba de la lista: el link de invitación y los avisos de
 * plantel, que son de esta sección.
 */
export function Plantel({
  seasonId,
  seats,
  canTakeSeat,
  me = null,
  children,
}: {
  seasonId: string
  seats: SeatVM[]
  canTakeSeat: boolean
  /** Tu asiento, si tenés: su fila va marcada como tuya (el amarillo es sólo para eso). */
  me?: string | null
  children?: ReactNode
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // La hoja del asiento: `seatOpen` la abre y la cierra; `seatId` queda puesto
  // mientras baja, para que no se vacíe en la animación.
  const [seatId, setSeatId] = useState<string | null>(null)
  const [seatOpen, setSeatOpen] = useState(false)
  const [nombre, setNombre] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newBefore, setNewBefore] = useState('')
  const nombreRef = useRef<HTMLInputElement>(null)
  const nuevoRef = useRef<HTMLInputElement>(null)

  const seat = seats.find((candidate) => candidate.entryId === seatId) ?? null

  const run = (work: () => Promise<WriteResult>) => {
    setError(null)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSeatOpen(false)
      setAdding(false)
    })
  }

  const openSeat = (target: SeatVM) => {
    setError(null)
    setSeatId(target.entryId)
    setNombre(target.name)
    setSeatOpen(true)
  }
  const openAdd = () => {
    setError(null)
    setNewName('')
    setNewBefore('')
    setAdding(true)
  }

  return (
    <Section
      title="Plantel"
      action={<span className="text-[16px] text-muted">{seats.length === 1 ? '1 jugador' : `${seats.length} jugadores`}</span>}
    >
      {children}

      <ul className={GRUPO}>
        {seats.map((candidate) => (
          <li key={candidate.entryId} className="border-t border-line first:border-t-0">
            <button
              type="button"
              onClick={() => openSeat(candidate)}
              className={`${FILA_CAJA} press-fila${candidate.entryId === me ? ` ${VOS_FILA}` : ''}`}
            >
              <Avatar name={candidate.name} />
              <span className="min-w-0 flex-1">
                <span className={`${rowTitle} truncate`}>
                  {candidate.name}
                  {candidate.entryId === me && <span className="ml-1.5 text-[14px] font-semibold">vos</span>}
                </span>
                <span className={rowMeta}>{candidate.ownerName ?? 'Sin dueño'}</span>
              </span>
              <Chevron />
            </button>
          </li>
        ))}
      </ul>

      <button type="button" onClick={openAdd} className={`${button('secondary', { full: true })} mt-3`}>
        + Agregar jugador
      </button>

      <Sheet open={seatOpen} onClose={() => setSeatOpen(false)} title={seat?.name ?? ''} initialFocus={nombreRef}>
        {seat !== null && (
          <div className="flex flex-col gap-5 pt-4">
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (pending) return
                if (nombre.trim() === seat.name.trim()) {
                  setSeatOpen(false)
                  return
                }
                run(() => editSeatName(seasonId, seat.entryId, nombre))
              }}
              className="flex flex-col gap-3"
            >
              <label>
                <span className={ROTULO}>Nombre</span>
                <input
                  ref={nombreRef}
                  name="nombre"
                  value={nombre}
                  disabled={pending}
                  autoComplete="off"
                  onChange={(event) => setNombre(event.target.value)}
                  className={CAMPO}
                />
              </label>
              <button
                type="submit"
                disabled={pending || nombre.trim().length === 0}
                className={button('primary', { full: true })}
              >
                Guardar
              </button>
            </form>

            <div className="flex flex-col gap-2">
              <p className="text-[15px] text-muted">
                {seat.ownerName === null ? 'Sin dueño: lo reclama quien entra con el link' : `Cuenta: ${seat.ownerName}`}
              </p>
              {canTakeSeat && seat.ownerName === null && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => takeSeat(seasonId, seat.entryId))}
                  className={button('secondary', { full: true })}
                >
                  Este soy yo
                </button>
              )}
              {seat.ownerName !== null && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => unlinkSeatOwner(seasonId, seat.entryId))}
                  className={button('secondary', { full: true })}
                >
                  Desvincular
                </button>
              )}
            </div>

            {error !== null && <Aviso alerta>{error}</Aviso>}

            <div className="border-t border-line pt-4">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => dropSeat(seasonId, seat.entryId))}
                className={button('danger', { full: true })}
              >
                Sacar
              </button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Agregar jugador" initialFocus={nuevoRef}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            // El `pending` no lo cubren los `disabled`: un Enter en el campo
            // manda el form igual, y acá es el último lugar donde se frena un
            // alta duplicada.
            if (pending || newName.trim().length === 0) return
            run(() => addSeat(seasonId, newName, newBefore === '' ? null : newBefore))
          }}
          className="flex flex-col gap-4 pt-4"
        >
          <label>
            <span className={ROTULO}>Nombre</span>
            <input
              ref={nuevoRef}
              name="nuevo"
              value={newName}
              disabled={pending}
              autoComplete="off"
              onChange={(event) => setNewName(event.target.value)}
              className={CAMPO}
            />
          </label>
          {/* `seats` ya llega ordenado por seedPosition (ajustes/page.tsx), así
              que el select sale en el mismo orden que el plantel — igual que
              "Juega con" en GuestCard. */}
          <label>
            <span className={ROTULO}>Posición en el desempate</span>
            <select
              value={newBefore}
              disabled={pending}
              onChange={(event) => setNewBefore(event.target.value)}
              className={CAMPO}
            >
              <option value="">Al final</option>
              {seats.map((candidate) => (
                <option key={candidate.entryId} value={candidate.entryId}>
                  Antes de {candidate.name}
                </option>
              ))}
            </select>
          </label>
          {error !== null && <Aviso alerta>{error}</Aviso>}
          <button
            type="submit"
            disabled={pending || newName.trim().length === 0}
            className={button('primary', { size: 'lg', full: true })}
          >
            Agregar
          </button>
        </form>
      </Sheet>
    </Section>
  )
}
