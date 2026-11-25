'use client'

import { useState, useTransition } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { rowTitle } from '@/app/ui/row'
import { Sheet } from '@/app/ui/sheet'
import { transferAdmin } from './actions'
import { Aviso, FILA } from './piezas'

/**
 * La fila "Organiza": cada torneo tiene un solo admin, y sin esto no había
 * forma de dárselo a otro (ni de borrar la cuenta siendo admin, S3 de
 * `odd/tasks/borrar-cuenta.md`). "Pasar" abre una hoja con quien puede
 * recibirla —un asiento reclamado que no es el tuyo—, una fila por persona.
 * No tiene vuelta para quien la pasa, así que elegir pide confirmación y, si
 * sale bien, la acción saca de Ajustes, que ya no es suyo.
 */
export function PasarAdmin({
  seasonId,
  candidates,
}: {
  seasonId: string
  candidates: { entryId: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function pass(entryId: string, name: string) {
    if (!window.confirm(`¿Pasarle la administración a ${name}? Vas a dejar de poder editar este torneo.`)) return
    setError(null)
    startTransition(async () => {
      // Si sale bien, la acción redirige al torneo y esto no vuelve.
      const result = await transferAdmin(seasonId, entryId)
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <div className={FILA}>
      <span className="flex-1 text-[17px] font-semibold">Organizás vos</span>
      {/* Sin nadie con cuenta a quien pasarla no hay botón ni hoja. */}
      {candidates.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => {
              setError(null)
              setOpen(true)
            }}
            className="-my-1 min-h-[44px] rounded-btn px-2 text-[16px] font-semibold text-accent-link"
          >
            Pasar
          </button>

          <Sheet open={open} onClose={() => setOpen(false)} title="Pasar la administración">
            <p className="pt-2 text-[15px] text-muted">Solo a quien ya entró con su cuenta</p>
            <ul className="-mx-4 mt-3 border-y border-line">
              {candidates.map((candidate) => (
                <li key={candidate.entryId} className="border-t border-line first:border-t-0">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => pass(candidate.entryId, candidate.name)}
                    className="press-fila flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left"
                  >
                    <Avatar name={candidate.name} />
                    <span className={rowTitle}>{candidate.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            {error !== null && (
              <Aviso alerta className="mt-3">
                {error}
              </Aviso>
            )}
          </Sheet>
        </>
      )}
    </div>
  )
}
