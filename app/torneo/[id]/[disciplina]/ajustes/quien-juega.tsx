'use client'

import { useState, useTransition } from 'react'
import type { DisciplineId } from '@/core'
import { addDisciplineMember, dropDisciplineMember, type WriteResult } from '@/app/torneo/[id]/ajustes/actions'

export interface QuienJuegaMemberVM {
  entryId: string
  name: string
  /** Si esta fila juega la disciplina de la URL — tiene fila en `discipline_entries` para ella. */
  playsDiscipline: boolean
}

// Mismo botón que `Plantel` (`../../ajustes/plantel.tsx`): `min-h-[44px]` es
// el mínimo de Apple para tocar con el dedo.
const ACTION =
  'flex min-h-[44px] items-center rounded-field bg-chip px-3.5 text-[12.5px] font-extrabold text-muted transition-opacity disabled:opacity-45'

/**
 * "Quién juega" (§2.6 del diseño): el plantel del CONTENEDOR, marcando quién
 * juega ESTA disciplina y quién no, con una acción por fila —Agregar o
 * Sacar— en vez de un guardado masivo.
 *
 * Sin modal de confirmación (decisión del dueño 4): sacar de acá es MENOS
 * destructivo que sacar del plantel entero en `Plantel` (que tampoco lo
 * pide) — la persona sigue en el torneo, sólo deja de jugar esta disciplina.
 *
 * "Sacar" no se deshabilita de antemano para quien ya jugó, tiene una pareja
 * fija armada o está marcado presente en una fecha sin armar: rebota con el
 * mensaje de `dropDisciplineMember` (`removeFromDiscipline`,
 * `db/discipline-entries.ts`) que nombra la salida real en cada caso, mismo
 * criterio que "Sacar" en `Plantel` contra el 23503 de `pairs`/`awards` —
 * ofrecer un botón que precalcula "esto va a fallar" es el mismo defecto ya
 * medido en "Reabrir fecha".
 *
 * `data-quien-juega={disciplineId}` y `data-quien-juega-label={disciplineLabel}`
 * en la `<section>`: mismo pin que `data-formato`/`data-formato-default`
 * (`ajustes/formato.tsx:95`, `ajustes/formato-default.tsx:86`) — sin el
 * primero, `page.tsx` pasando el id de OTRA disciplina (ej.
 * `header.disciplines[last].id` en vez de `discipline.id`) se seguiría
 * viendo y renderizando igual, pero cada acción escribiría sobre la
 * disciplina equivocada. `disciplineLabel` necesita el SUYO aparte (ronda de
 * fix 2, BLOQUEA 3): es el cuarto argumento de `dropDisciplineMember` y
 * prefija TODOS sus mensajes de error, así que `page.tsx` pasando
 * `DISCIPLINE_LABELS[header.disciplines[0]!.kind]` en vez de
 * `DISCIPLINE_LABELS[discipline.kind]` atribuye cada rebote a la disciplina
 * equivocada sin que nada del resto del render lo note.
 */
export function QuienJuega({
  seasonId,
  disciplineId,
  disciplineLabel,
  members,
}: {
  seasonId: string
  disciplineId: DisciplineId
  disciplineLabel: string
  members: QuienJuegaMemberVM[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (work: () => Promise<WriteResult>) => {
    setError(null)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <section
      data-quien-juega={disciplineId}
      data-quien-juega-label={disciplineLabel}
      className="flex flex-col gap-2"
    >
      <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">Quién juega</h2>

      <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
        {members.map((member, index) => (
          <div
            key={member.entryId}
            className={`flex items-center justify-between gap-3 px-3 py-3 ${index > 0 ? 'border-t border-line' : ''}`}
          >
            <span className="truncate text-[14px] font-bold">{member.name}</span>
            {member.playsDiscipline ? (
              <button
                type="button"
                className={ACTION}
                disabled={pending}
                onClick={() => run(() => dropDisciplineMember(seasonId, disciplineId, member.entryId, disciplineLabel))}
              >
                Sacar
              </button>
            ) : (
              <button
                type="button"
                className={ACTION}
                disabled={pending}
                onClick={() => run(() => addDisciplineMember(seasonId, disciplineId, member.entryId))}
              >
                Agregar
              </button>
            )}
          </div>
        ))}
      </div>

      {error !== null && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}
    </section>
  )
}
