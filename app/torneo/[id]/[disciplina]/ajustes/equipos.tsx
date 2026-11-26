'use client'

import { useState, useTransition } from 'react'
import type { DisciplineId } from '@/core'
import { addTeam, removeTeam, type WriteResult } from '@/app/torneo/[id]/ajustes/actions'
import { Aviso, CAMPO, FILA, GRUPO } from '@/app/torneo/[id]/ajustes/piezas'
import { button } from '@/app/ui/button'
import { rowTitle } from '@/app/ui/row'
import { Section } from '@/app/ui/section'

export interface EquipoVM {
  id: string
  aName: string
  bName: string
}

export interface EquipoMemberVM {
  entryId: string
  name: string
}

// Mismo botón que `QuienJuega`: 44 de alto, el mínimo para el dedo.
const ACTION = 'press min-h-[44px] shrink-0 rounded-btn bg-chip px-3.5 text-[16px] font-semibold text-text'

/**
 * Equipos fijos (docs/tipos-de-torneo.md §1): arma o deshace un equipo — sin
 * nombre (decisión del dueño, §1.2: "por ahora Pedro y Juan").
 *
 * Aparece con `disciplina.fixedTeams`, no con `multiDiscipline` como
 * "Quién juega" (`quien-juega.tsx`): un torneo de UNA sola disciplina de
 * equipos fijos es el caso más común, así que la condición de esta sección
 * vive en `page.tsx`, aparte de la de `QuienJuega`.
 *
 * Equipos PARCIALES están permitidos (decisión del dueño): `freeMembers` sólo
 * excluye a quien YA tiene equipo, nunca exige que sobren cero — quien queda
 * suelto cae al sorteo normal (`pairingContextFor`, `db/matchday.ts`). Por
 * eso no hay ninguna regla de "todos emparejados o nadie" acá.
 *
 * El submit queda deshabilitado con los dos `<select>` iguales o vacíos —
 * cinturón de UI, no la guarda real: `createTeam` igual rechaza "la misma
 * persona dos veces" con su propio mensaje si esto se saltea.
 *
 * `data-equipos={disciplineId}` en la `<section>`: mismo pin que
 * `data-quien-juega` (`quien-juega.tsx`) — sin él, `page.tsx` pasando el id
 * de OTRA disciplina se seguiría viendo y renderizando igual, pero cada alta
 * o baja escribiría sobre la disciplina equivocada.
 *
 * `data-equipos-season={seasonId}` (ronda de fix, M-1): mismo argumento,
 * para el OTRO id que viaja a esta sección — sin pinear, `page.tsx` pasando
 * `discipline.id` en el lugar de `seasonId` (los dos son props uuid
 * adyacentes, mismo riesgo de copy-paste que ya cubre el pin de arriba)
 * también se seguiría viendo igual, pero `createTeam` mandaría un
 * `season_id` que no matchea la FK compuesta `(discipline_id, season_id)`
 * de `discipline_teams` (`0068_fixed_teams.sql:61`) y armar equipos
 * quedaría roto con un mensaje que no nombra la causa real.
 */
export function Equipos({
  seasonId,
  disciplineId,
  teams,
  freeMembers,
}: {
  seasonId: string
  disciplineId: DisciplineId
  teams: EquipoVM[]
  freeMembers: EquipoMemberVM[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [entryA, setEntryA] = useState('')
  const [entryB, setEntryB] = useState('')

  const run = (work: () => Promise<WriteResult>) => {
    setError(null)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setEntryA('')
      setEntryB('')
    })
  }

  const canArmar = !pending && entryA !== '' && entryB !== '' && entryA !== entryB

  return (
    <section data-equipos={disciplineId} data-equipos-season={seasonId}>
      <Section title="Equipos">
        {teams.length > 0 && (
          <ul className={`${GRUPO} mb-3`}>
            {teams.map((team) => (
              <li key={team.id} className={FILA}>
                <span className={`${rowTitle} min-w-0 flex-1 truncate`}>
                  {team.aName} y {team.bName}
                </span>
                <button
                  type="button"
                  className={ACTION}
                  disabled={pending}
                  onClick={() => run(() => removeTeam(seasonId, team.id))}
                >
                  Deshacer
                </button>
              </li>
            ))}
          </ul>
        )}

        {freeMembers.length >= 2 && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!canArmar) return
              run(() => addTeam(seasonId, disciplineId, entryA, entryB))
            }}
            className="flex flex-col gap-3 rounded-tile bg-surface p-4"
          >
            <p className="text-[17px] font-bold">Nuevo equipo</p>
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="Primer integrante"
                value={entryA}
                disabled={pending}
                onChange={(event) => setEntryA(event.target.value)}
                className={CAMPO}
              >
                <option value="">Elegí a alguien</option>
                {freeMembers.map((member) => (
                  <option key={member.entryId} value={member.entryId}>
                    {member.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Segundo integrante"
                value={entryB}
                disabled={pending}
                onChange={(event) => setEntryB(event.target.value)}
                className={CAMPO}
              >
                <option value="">Elegí a alguien</option>
                {freeMembers.map((member) => (
                  <option key={member.entryId} value={member.entryId}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={!canArmar} className={button('primary', { full: true })}>
              Armar equipo
            </button>
          </form>
        )}

        {error !== null && (
          <Aviso alerta className="mt-3">
            {error}
          </Aviso>
        )}
      </Section>
    </section>
  )
}
