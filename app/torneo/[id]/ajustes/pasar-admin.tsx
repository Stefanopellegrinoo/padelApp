'use client'

import { useState, useTransition } from 'react'
import { transferAdmin } from './actions'

/**
 * La fila "Organiza": cada torneo tiene un solo admin, y sin esto no había
 * forma de dárselo a otro (ni de borrar la cuenta siendo admin, S3 de
 * `odd/tasks/borrar-cuenta.md`). Un `<select>` nativo: en el iPhone abre la
 * rueda del sistema. No tiene vuelta para quien la pasa, así que pide
 * confirmación y después sale de Ajustes, que ya no es suyo.
 */
export function PasarAdmin({
  seasonId,
  candidates,
}: {
  seasonId: string
  candidates: { entryId: string; name: string }[]
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function pass(entryId: string) {
    const name = candidates.find((c) => c.entryId === entryId)?.name
    if (name === undefined) return
    if (!window.confirm(`¿Pasarle la administración a ${name}? Vas a dejar de poder editar este torneo.`)) return
    setError(null)
    startTransition(async () => {
      // Si sale bien, la acción redirige al torneo y esto no vuelve.
      const result = await transferAdmin(seasonId, entryId)
      if (!result.ok) setError(result.error)
    })
  }

  if (candidates.length === 0) {
    return <span className="shrink-0 text-[13px] font-[750] text-muted">Vos</span>
  }

  return (
    <span className="-my-3 flex min-h-[44px] shrink-0 items-center gap-2 pl-3">
      {error !== null && <span className="text-[12px] font-bold text-live">{error}</span>}
      <select
        aria-label="Pasar la administración"
        value=""
        disabled={pending}
        onChange={(event) => pass(event.target.value)}
        className="min-h-[44px] appearance-none bg-transparent text-right text-[13px] font-[750] text-muted disabled:opacity-40"
      >
        <option value="">{pending ? 'Pasando…' : 'Vos ›'}</option>
        {candidates.map((c) => (
          <option key={c.entryId} value={c.entryId}>
            {c.name}
          </option>
        ))}
      </select>
    </span>
  )
}
