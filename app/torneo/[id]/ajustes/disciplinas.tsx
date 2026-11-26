'use client'

import Link from 'next/link'
import { useId, useState, useTransition } from 'react'
import { button } from '@/app/ui/button'
import { rowMeta, rowTitle } from '@/app/ui/row'
import { Section } from '@/app/ui/section'
import { Sheet } from '@/app/ui/sheet'
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
import { Aviso, Chevron, FILA, GRUPO } from './piezas'

export interface DisciplineVM {
  id: string
  kind: string
  slug: string
  /** Lo que se lee debajo del nombre en la lista ("1 set a 6 games"). */
  meta?: string
}

export interface SquadMemberVM {
  entryId: string
  name: string
}

const ROTULO = 'mb-2 block text-[14px] font-semibold text-muted'

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
 * deporte o si las reglas tienen un error; lo que el servidor rechaza aparece abajo. Cancelar es el
 * de la hoja que la contiene.
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
    <div className="flex flex-col gap-5 pt-4">
      <div>
        <span id={deportesId} className={ROTULO}>
          ¿Qué deporte?
        </span>
        <div role="group" aria-labelledby={deportesId} className="grid grid-cols-3 gap-2">
          {TOURNAMENT_SPORTS.map((kind) => (
            <button
              key={kind}
              type="button"
              data-deporte={kind}
              aria-pressed={kind === card.kind}
              disabled={pending}
              onClick={() => onKind(kind)}
              className={`min-h-[48px] rounded-btn px-2 text-center text-[16px] font-bold ${
                kind === card.kind ? 'bg-sport text-on-sport' : 'bg-opcion text-text shadow-[inset_0_0_0_1px_var(--color-opcion-borde)]'
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

      <fieldset>
        <legend className={ROTULO}>Quién juega ({playing.length})</legend>
        <div className="-mx-4 border-y border-line">
          {squad.map((member) => (
            <label
              key={member.entryId}
              className="flex min-h-[52px] cursor-pointer items-center gap-3 border-t border-line px-4 text-[17px] first:border-t-0"
            >
              <input
                type="checkbox"
                disabled={pending}
                checked={selected.has(member.entryId)}
                onChange={() => onToggle(member.entryId)}
                className="h-[22px] w-[22px] shrink-0 accent-sport"
              />
              {member.name}
            </label>
          ))}
        </div>
      </fieldset>

      <button type="button" disabled={blocked} onClick={onSubmit} className={button('primary', { size: 'lg', full: true })}>
        Agregar
      </button>
    </div>
  )
}

/**
 * El estado de la tarjeta de alta, adentro de su hoja: se vuelve a montar cada vez que se abre (la
 * `key` de `Disciplinas`), así que cada alta arranca de la ficha y con todo el plantel.
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
      />
      {error !== null && (
        <Aviso alerta className="mt-3">
          {error}
        </Aviso>
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
  // `abiertas` cuenta las veces que se abrió la hoja: es la `key` de la tarjeta de alta, así cada
  // alta arranca de cero y la hoja no se vacía mientras baja.
  const [adding, setAdding] = useState(false)
  const [abiertas, setAbiertas] = useState(0)
  const many = disciplines.length > 1

  return (
    <Section title="Deportes">
      {/* Con uno solo la lista no se dibuja: sus reglas ya están arriba, en esta misma pantalla, y
          una fila que lleva a la Tabla no es un ajuste. Queda sólo sumar otro. */}
      {many && (
        <ul className={`${GRUPO} mb-3`}>
          {disciplines.map((discipline) => (
            <li key={discipline.id} data-deporte={discipline.kind} className="border-t border-line first:border-t-0">
              <Link
                // Cada fila entra a SUS ajustes (Task 4, docs/plan-arquitectura-de-paginas.md): con
                // 2+, las reglas del deporte se mudan a `[disciplina]/ajustes` y esta lista es la
                // única forma de llegar ahí.
                href={`/torneo/${seasonId}/${discipline.slug}/ajustes`}
                className={`${FILA} press-fila`}
              >
                <span aria-hidden="true" className="h-8 w-2 shrink-0 rounded-full bg-sport" />
                <span className="min-w-0 flex-1">
                  <span className={rowTitle}>
                    {sportLabel(discipline.kind)}
                    {/* Dos del mismo deporte se distinguen por el slug, como en "Igual que". */}
                    {disciplines.filter((other) => other.kind === discipline.kind).length > 1 &&
                      ` (${discipline.slug})`}
                  </span>
                  {discipline.meta !== undefined && <span className={rowMeta}>{discipline.meta}</span>}
                </span>
                <Chevron />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => {
          setAbiertas((count) => count + 1)
          setAdding(true)
        }}
        className={button('secondary', { full: true })}
      >
        + Agregar un deporte
      </button>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Agregar un deporte">
        <AgregarDeporte
          key={abiertas}
          seasonId={seasonId}
          disciplines={disciplines}
          squad={squad}
          onClose={() => setAdding(false)}
        />
      </Sheet>
    </Section>
  )
}
