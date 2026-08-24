'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import type { SideSize } from '@/core'
import { SelectorDeLados } from '@/app/torneos/nuevo/wizard'
import { DISCIPLINE_KINDS, DISCIPLINE_LABELS, type DisciplineKind } from '@/app/torneos/nuevo/wizard-state'
import { addDisciplineToSeason, type WriteResult } from './actions'

export interface DisciplineVM {
  id: string
  kind: DisciplineKind
  slug: string
}

export interface SquadMemberVM {
  entryId: string
  name: string
}

/**
 * El formulario de "+ Agregar disciplina" (REQ-D1-2, REQ-D1-4), separado de
 * `Disciplinas` por lo mismo que `SelectorDeFormato` (`armado.tsx`, PR21 D2):
 * `Disciplinas` guarda `adding`/`kind`/`pairSize` en `useState` que arrancan
 * cerrados/en default, y sin clicks (este repo no tiene runner E2E) la suite
 * nunca lo vería abierto si viviera sólo adentro. Acá entra con el estado que
 * quiera el test.
 *
 * `validSelected` recalculado acá y no recibido armado: es un derivado de
 * `squad`/`selected` y no estado propio — recibirlo por separado abriría la
 * puerta a que quedara desincronizado del `selected` que sí es la fuente.
 */
export function NuevaDisciplina({
  kind,
  pairSize,
  squad,
  selected,
  pending,
  onChangeKind,
  onChangePairSize,
  onToggle,
  onSubmit,
  onCancel,
}: {
  kind: DisciplineKind
  pairSize: SideSize
  squad: SquadMemberVM[]
  selected: ReadonlySet<string>
  pending: boolean
  onChangeKind: (kind: DisciplineKind) => void
  onChangePairSize: (pairSize: SideSize) => void
  onToggle: (entryId: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const validSelected = [...selected].filter((id) => squad.some((member) => member.entryId === id))

  return (
    <div className="flex flex-col gap-3 rounded-field border-[1.5px] border-accent bg-surface p-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted">Tipo</legend>
        {DISCIPLINE_KINDS.map((candidate) => (
          <label
            key={candidate}
            className="flex min-h-[44px] items-center gap-2.5 rounded-field border border-line p-2.5 text-[13.5px] font-[700]"
          >
            <input
              type="radio"
              name="kind"
              disabled={pending}
              checked={kind === candidate}
              onChange={() => onChangeKind(candidate)}
              className="h-5 w-5 shrink-0 accent-accent"
            />
            {DISCIPLINE_LABELS[candidate]}
          </label>
        ))}
      </fieldset>

      <SelectorDeLados pairSize={pairSize} onChange={onChangePairSize} disabled={pending} />

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted">
          Quién juega ({validSelected.length})
        </legend>
        {squad.map((member) => (
          <label
            key={member.entryId}
            className="flex min-h-[44px] items-center gap-2.5 text-[13.5px] font-[600]"
          >
            <input
              type="checkbox"
              disabled={pending}
              checked={selected.has(member.entryId)}
              onChange={() => onToggle(member.entryId)}
              className="h-5 w-5 shrink-0 accent-accent"
            />
            {member.name}
          </label>
        ))}
      </fieldset>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending || validSelected.length === 0}
          onClick={onSubmit}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-field bg-accent p-[10px] text-[13.5px] font-extrabold text-accent-text disabled:opacity-45"
        >
          Agregar
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-field bg-chip p-[10px] text-[13.5px] font-extrabold text-muted"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

/**
 * Agregar una disciplina a un torneo ya en curso (REQ-D1-2). El wizard sólo
 * ofrece un checkbox por `kind` (decisión #3823) — crear DOS pádel desde el
 * arranque queda fuera de ese alcance a propósito. Acá es donde la segunda
 * se suma, y por eso esta lista NO repite la restricción "una por tipo" del
 * wizard: un segundo PADEL es justo el caso que habilita el ordinal de
 * `core/discipline-slug.ts` (`padel`, `padel-2`).
 *
 * El plantel a elegir es `squad` (temporada ENTERA, `seasonSquadMembersOf`
 * en `ajustes/page.tsx`), no la sección "Plantel" de esta misma pantalla:
 * "Plantel" usa `entriesOf` sin `disciplineId`, que resuelve la disciplina
 * por defecto y deja afuera a quien no la juega (C9, ronda 4) — exactamente
 * lo que este formulario no puede hacer, porque el candidato a la
 * disciplina NUEVA es cualquiera de la temporada (REQ-D1-3).
 *
 * Todos preseleccionados: "por default juega todo" es el mismo criterio que
 * `createSeason` y que `addDiscipline` sin `entryIds`. Destildar antes de
 * guardar es el solape parcial de REQ-D1-4.
 */
export function Disciplinas({
  seasonId,
  disciplines,
  squad,
}: {
  seasonId: string
  disciplines: DisciplineVM[]
  squad: SquadMemberVM[]
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<DisciplineKind>('PADEL')
  // Parejas de entrada (pairSize=2): sin tocar "Lados" esta alta nace igual
  // que siempre — no-regresión de la Rebanada F, mismo default que el wizard.
  const [pairSize, setPairSize] = useState<SideSize>(2)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(squad.map((member) => member.entryId)))
  // El Set inicial no se resincroniza si `squad` cambia bajo el
  // formulario abierto (ej. sacar un asiento en Plantel) — derivar contra
  // `squad` en cada render evita mandar/mostrar un asiento que ya no existe.
  const validSelected = [...selected].filter((id) => squad.some((member) => member.entryId === id))

  const toggle = (entryId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })
  }

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const result: WriteResult = await addDisciplineToSeason(seasonId, kind, validSelected, pairSize)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAdding(false)
    })
  }

  return (
    <section id="disciplinas" className="flex flex-col gap-2 scroll-mt-4">
      <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">Disciplinas</h2>

      <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
        {disciplines.map((discipline, index) => (
          <Link
            key={discipline.id}
            href={`/torneo/${seasonId}/${discipline.slug}`}
            className={`flex items-center justify-between gap-3 px-3 py-3 ${index > 0 ? 'border-t border-line' : ''}`}
          >
            <span className="text-[14px] font-bold">{DISCIPLINE_LABELS[discipline.kind]}</span>
            <span className="shrink-0 text-[13px] font-[750] text-muted">{discipline.slug} ›</span>
          </Link>
        ))}
      </div>

      {adding ? (
        <NuevaDisciplina
          kind={kind}
          pairSize={pairSize}
          squad={squad}
          selected={selected}
          pending={pending}
          onChangeKind={setKind}
          onChangePairSize={setPairSize}
          onToggle={toggle}
          onSubmit={submit}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-field border-[1.5px] border-line p-3 text-[13.5px] font-extrabold"
        >
          + Agregar disciplina
        </button>
      )}

      {error !== null && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}
    </section>
  )
}
