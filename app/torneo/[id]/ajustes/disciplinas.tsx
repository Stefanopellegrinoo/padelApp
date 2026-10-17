'use client'

import Link from 'next/link'
import { useId, useState, useTransition } from 'react'
import { TOURNAMENT_SPORTS, minSquadFor, modalityShape, sportLabel, type Modality, type TournamentSport } from '@/core'
import { PersonalizarReglas } from '@/app/deporte/personalizar-reglas'
import { rulesErrors, type DisciplineRules } from '@/app/deporte/personalizar-reglas-state'
import { TarjetaDeporte } from '@/app/deporte/tarjeta'
import type { PrimeraFecha } from '@/app/deporte/tarjeta-state'
import {
  cambiarModalidad,
  cambiarPrimeraFecha,
  cambiarReglas,
  elegirDeporte,
  plantelCambio,
  reglasDeFicha,
  type DeporteElegido,
} from '@/app/torneos/nuevo/crear-state'
import { squadWarning } from '@/app/torneos/nuevo/wizard-state'
import { addSportToSeason } from './actions'
import { opcionesDeAlta } from './nuevo-deporte-state'

export interface DisciplineVM {
  id: string
  kind: string
  slug: string
}

export interface SquadMemberVM {
  entryId: string
  name: string
}

const ROTULO = 'text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted'

/** Una tarjeta nueva, con la ficha del deporte para `squadSize` jugadores y su primera modalidad. */
const tarjetaNueva = (kind: TournamentSport, squadSize: number): DeporteElegido => elegirDeporte([], kind, squadSize)[0]!

/**
 * La tarjeta de alta de "+ Agregar un deporte" (REQ-D1-2, docs/torneos-deportes.md §5): los deportes
 * como chips y, abajo, la MISMA `TarjetaDeporte` del paso 3 del wizard, "Quién juega" y los botones.
 * Controlada y separada de `Disciplinas`/`AgregarDeporte` (que guardan el estado en `useState`, que
 * arranca cerrado): sin clicks —este repo no tiene runner E2E— la suite nunca la vería abierta.
 *
 * `card` ya viene del tamaño de quien juega (`plantelCambio`): la tarjeta, la hoja y lo que se manda
 * hablan del mismo plantel. "Agregar" espera si no juega nadie, si falta gente para el piso del
 * deporte o si las reglas tienen un error; lo que el servidor rechaza aparece abajo.
 */
export function NuevoDeporte({
  card,
  disciplines,
  squad,
  selected,
  pending,
  onKind,
  onModality,
  onPrimeraFecha,
  onPersonalizar,
  onToggle,
  onSubmit,
  onCancel,
}: {
  card: DeporteElegido
  disciplines: readonly DisciplineVM[]
  squad: readonly SquadMemberVM[]
  selected: ReadonlySet<string>
  pending: boolean
  onKind: (kind: TournamentSport) => void
  onModality: (next: Modality) => void
  onPrimeraFecha: (next: PrimeraFecha) => void
  onPersonalizar: () => void
  onToggle: (entryId: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const deportesId = useId()
  const { pairSize, fixedTeams } = modalityShape(card.modality)
  const playing = squad.filter((member) => selected.has(member.entryId))
  const warning = squadWarning(
    playing.map((member) => member.name),
    minSquadFor(pairSize),
    pairSize === 2,
  )
  const blocked = pending || playing.length === 0 || warning !== null || rulesErrors(card.rules, pairSize).length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span id={deportesId} className={ROTULO}>
          ¿Qué deporte?
        </span>
        <div role="group" aria-labelledby={deportesId} className="grid grid-cols-3 gap-2">
          {TOURNAMENT_SPORTS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={kind === card.kind}
              disabled={pending}
              onClick={() => onKind(kind)}
              className={`min-h-[44px] rounded-field p-3 text-center text-[14px] font-extrabold ${
                kind === card.kind ? 'bg-accent text-accent-text' : 'bg-chip text-text'
              }`}
            >
              {sportLabel(kind)}
            </button>
          ))}
        </div>
      </div>

      <TarjetaDeporte
        kind={card.kind}
        squadSize={playing.length}
        modality={card.modality}
        onModality={onModality}
        primeraFecha={card.primeraFecha}
        primeraFechaOptions={opcionesDeAlta(disciplines)}
        onPrimeraFecha={onPrimeraFecha}
        rules={card.rules}
        pairSize={pairSize}
        fixedTeams={fixedTeams}
        warning={warning}
        onPersonalizar={onPersonalizar}
      />

      <fieldset className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-4">
        <legend className="float-left mb-1.5 w-full text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
          Quién juega ({playing.length})
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
          disabled={blocked}
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
 * El estado de la tarjeta de alta: vive mientras esté abierta (se monta al tocar "+ Agregar un deporte"
 * y se desmonta al agregar o cancelar), así que cada alta arranca de la ficha y con todo el plantel.
 *
 * El plantel a elegir es `squad` (temporada ENTERA, `seasonSquadMembersOf` en `ajustes/page.tsx`), no
 * la sección "Plantel" de esta misma pantalla: "Plantel" usa `entriesOf` sin `disciplineId`, que
 * resuelve la disciplina por defecto y deja afuera a quien no la juega (C9, ronda 4) — exactamente lo
 * que este formulario no puede hacer, porque el candidato a la disciplina NUEVA es cualquiera de la
 * temporada (REQ-D1-3). Todos preseleccionados: "por default juega todo" es el mismo criterio que
 * `createSeason` y que `addDiscipline` sin `entryIds`; destildar es el solape parcial de REQ-D1-4.
 */
function AgregarDeporte({
  seasonId,
  disciplines,
  squad,
  onClose,
}: {
  seasonId: string
  disciplines: readonly DisciplineVM[]
  squad: readonly SquadMemberVM[]
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DeporteElegido>(() => tarjetaNueva(TOURNAMENT_SPORTS[0], squad.length))
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(squad.map((member) => member.entryId)))
  // La hoja abierta y lo que se va tocando: "Listo" lo pasa a la tarjeta; la cruz o Escape lo tiran.
  const [hoja, setHoja] = useState<DisciplineRules | null>(null)
  // Derivado contra `squad` en cada render, no guardado: el Set inicial no se resincroniza si `squad`
  // cambia bajo el formulario abierto (ej. sacar un asiento en Plantel), y no hay que mandar un asiento
  // que ya no existe. La tarjeta se pone al tamaño de quien juega (puntos de la curva) por lo mismo.
  const entryIds = squad.filter((member) => selected.has(member.entryId)).map((member) => member.entryId)
  const card = plantelCambio([draft], entryIds.length)[0]!

  const toggle = (entryId: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      return next
    })

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const result = await addSportToSeason(seasonId, {
        kind: card.kind,
        modality: card.modality,
        primeraFecha: card.primeraFecha,
        rules: card.rules,
        entryIds,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onClose()
    })
  }

  return (
    <>
      <NuevoDeporte
        card={card}
        disciplines={disciplines}
        squad={squad}
        selected={selected}
        pending={pending}
        onKind={(kind) => setDraft(tarjetaNueva(kind, entryIds.length))}
        onModality={(next) => setDraft(cambiarModalidad(card, next, entryIds.length))}
        onPrimeraFecha={(next) => setDraft(cambiarPrimeraFecha([card], card.kind, next)[0]!)}
        onPersonalizar={() => setHoja(card.rules)}
        onToggle={toggle}
        onSubmit={submit}
        onCancel={onClose}
      />
      {error !== null && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}
      {hoja !== null && (
        <PersonalizarReglas
          kind={card.kind}
          modality={card.modality}
          pairSize={modalityShape(card.modality).pairSize}
          rules={hoja}
          ficha={reglasDeFicha(card, entryIds.length)}
          note={null}
          pending={false}
          error={null}
          onChange={setHoja}
          onDone={() => {
            setDraft(cambiarReglas([card], card.kind, hoja)[0]!)
            setHoja(null)
          }}
          onClose={() => setHoja(null)}
        />
      )}
    </>
  )
}

/**
 * La lista de deportes del torneo y "+ Agregar un deporte" (REQ-D1-2). El wizard sólo ofrece un chip por
 * deporte (decisión #3823) — crear DOS pádel desde el arranque queda fuera de ese alcance a propósito.
 * Acá es donde el segundo se suma, y por eso `AgregarDeporte` NO repite la restricción "uno por deporte"
 * del wizard: un segundo PADEL es justo el caso que habilita el ordinal de `core/discipline-slug.ts`
 * (`padel`, `padel-2`).
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
  const [adding, setAdding] = useState(false)

  return (
    <section id="disciplinas" className="flex flex-col gap-2 scroll-mt-4">
      <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">Disciplinas</h2>

      <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
        {disciplines.map((discipline, index) => (
          <Link
            key={discipline.id}
            // Con 2+, cada fila entra a SUS ajustes (Task 4,
            // docs/plan-arquitectura-de-paginas.md): Formato/FormatoDefault/
            // Reglas se mudan a `[disciplina]/ajustes`, y esta lista pasa a
            // ser la única forma de llegar ahí. Con una sola, el link se
            // queda apuntando a la tabla, sin cambio: sus ajustes ya están
            // en esta misma pantalla, más arriba.
            href={
              disciplines.length > 1
                ? `/torneo/${seasonId}/${discipline.slug}/ajustes`
                : `/torneo/${seasonId}/${discipline.slug}`
            }
            className={`flex items-center justify-between gap-3 px-3 py-3 ${index > 0 ? 'border-t border-line' : ''}`}
          >
            <span className="text-[14px] font-bold">{sportLabel(discipline.kind)}</span>
            <span className="shrink-0 text-[13px] font-[750] text-muted">{discipline.slug} ›</span>
          </Link>
        ))}
      </div>

      {adding ? (
        <AgregarDeporte seasonId={seasonId} disciplines={disciplines} squad={squad} onClose={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-field border-[1.5px] border-line p-3 text-[13.5px] font-extrabold"
        >
          + Agregar un deporte
        </button>
      )}
    </section>
  )
}
