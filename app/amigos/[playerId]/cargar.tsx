'use client'

import { useActionState, useId, useState, type ReactNode } from 'react'
import type { CasualMatch } from '@/db/friends'
import { editCasualMatch, removeCasualMatch, type CasualFormState } from '../actions'

const INITIAL_STATE: CasualFormState = { error: null }

const INPUT =
  'rounded-field border-[1.5px] border-line bg-surface p-[13px] text-[16px] font-bold text-text outline-none'
const LABEL = 'text-[11.5px] font-extrabold text-muted'

/**
 * Los mismos siete campos, ya como texto plano, con los que se prellena el
 * formulario al editar -- `CasualMatch` (`db/friends.ts`) no alcanza tal
 * cual porque sus campos vienen tipados (`score: {mine,theirs}|null`), no
 * como el string vacío que un `<input>` sin valor necesita.
 */
export interface CasualFormInitial {
  matchId: string
  sport: string
  playedOn: string
  outcome: 'won' | 'lost' | 'drew'
  scoreMine: string
  scoreTheirs: string
  teamMine: string
  teamTheirs: string
}

/**
 * El formulario de cargar/editar un partido casual (diseño §4), compartido
 * por las dos operaciones -- lo único que cambia entre cargar y editar es
 * `action` (qué server action llamar) e `initial` (si hay algo que
 * prellenar). Un solo componente evita mantener dos copias de siete campos
 * en sincronía.
 *
 * `useActionState`, no el patrón `<form action={fn}>` sin estado de
 * `app/amigos/actions.ts`: ese patrón le sirve a pedir/aceptar amistad (un
 * campo, nada que rechazar en el borde) pero acá hay siete campos y una
 * validación real (`parseCasualInput`, `db/friends.ts`) que puede fallar.
 *
 * Los siete campos son CONTROLADOS -- cada uno con su propio `useState`,
 * seedeado desde `initial` --, y NO por lo que arma el hook de arriba.
 * Review final de 2b, Important 1: el JSDoc de esta misma función afirmaba
 * antes que `useActionState` alcanzaba para no perder lo tipeado, citando
 * `registro-form.tsx` como si ya resolviera "exactamente este problema con
 * el mismo hook" -- falso: ese archivo también usa `useActionState`, pero lo
 * que de verdad conserva sus tres campos es que son controlados
 * (`value=`/`onChange=`), no el hook.
 *
 * El mecanismo, verificado en el código de React 19
 * (`react-dom/cjs/react-dom-client.development.js`, `startHostTransition` →
 * `requestFormReset$1` → `fiber.stateNode.reset()`): toda action de un
 * `<form>` -- también una que TERMINA en error -- dispara un
 * `HTMLFormElement.reset()` nativo sobre el DOM como parte de la misma
 * transición. Un input sin controlar (`defaultValue`) vuelve a su valor
 * original con ese reset -- cada uno de "Elegí una fecha real.", "Cargá los
 * dos números del marcador" o "tienen que ser amigos aceptados" volvía con
 * el formulario en blanco, y en el de editar, con la fila revertida a lo que
 * ya estaba guardado, pisando lo que la persona acababa de cambiar. Un input
 * controlado no lo pierde: su valor sale de un estado de React que ese reset
 * del DOM no toca, y el próximo render (el mismo que muestra el error) lo
 * vuelve a escribir en la pantalla.
 *
 * El "quién ganó" es SIEMPRE un radio obligatorio con las tres opciones
 * (ruling del orquestador, task-4-brief.md): ni pregunta condicional que
 * aparece sólo con marcador empatado, ni cálculo del lado de cliente para
 * detectarlo -- el HTML nativo (`required` en el grupo) ya impide enviar sin
 * elegir una.
 */
export function CasualForm({
  friendPlayerId,
  friendName,
  sports = [],
  action,
  initial,
  onCancel,
  submitLabel,
}: {
  friendPlayerId: string
  friendName: string
  /**
   * Los deportes que el caller ya usó (`sportsUsedBy`, `db/friends.ts`), para
   * el `datalist` de §4.1 -- la normalización la hace esta pantalla, no un
   * catálogo nuevo.
   *
   * ponytail: sin sugerencias al editar (`CasualMatchRow` más abajo no pasa
   * esta prop) -- el valor que se está editando ya es un string bien escrito,
   * cargado alguna vez pasando por esta misma sugerencia; el riesgo de typo
   * que el datalist evita es al escribir de cero, no al corregir un partido
   * que ya existe. Si algún día hace falta sugerir también al editar, alcanza
   * con pasarle `sports` a `CasualMatchRow`.
   */
  sports?: readonly string[]
  action: (state: CasualFormState, formData: FormData) => Promise<CasualFormState>
  initial?: CasualFormInitial
  onCancel?: () => void
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE)
  // Un id propio por instancia: dos `CasualForm` pueden convivir en la misma
  // pantalla (el de "cargar nuevo" arriba, uno "editando" en una fila) y un
  // `id`/`list` fijo repetido sería HTML inválido -- el navegador no sabría a
  // cuál datalist apunta cada input.
  const sportsListId = useId()

  // Los siete campos, controlados -- ver el JSDoc de arriba (Important 1,
  // review final) para el porqué. Seedeados una sola vez desde `initial`: esta
  // instancia de `CasualForm` no sobrevive un cambio de fila (`CasualMatchRow`
  // desmonta y remonta un componente nuevo cada vez que `editing` cambia), así
  // que no hace falta un `useEffect` que vuelva a sincronizar si `initial`
  // cambiara debajo -- nunca cambia bajo la misma instancia.
  const [sport, setSport] = useState(initial?.sport ?? '')
  const [playedOn, setPlayedOn] = useState(initial?.playedOn ?? '')
  const [outcome, setOutcome] = useState<'' | CasualFormInitial['outcome']>(initial?.outcome ?? '')
  const [scoreMine, setScoreMine] = useState(initial?.scoreMine ?? '')
  const [scoreTheirs, setScoreTheirs] = useState(initial?.scoreTheirs ?? '')
  const [teamMine, setTeamMine] = useState(initial?.teamMine ?? '')
  const [teamTheirs, setTeamTheirs] = useState(initial?.teamTheirs ?? '')

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-field border-[1.5px] border-line p-[14px]">
      <input type="hidden" name="friendPlayerId" value={friendPlayerId} />
      {initial !== undefined && <input type="hidden" name="matchId" value={initial.matchId} />}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${sportsListId}-sport`} className={LABEL}>
          Deporte
        </label>
        <input
          id={`${sportsListId}-sport`}
          name="sport"
          list={sportsListId}
          value={sport}
          onChange={(e) => setSport(e.target.value)}
          required
          className={INPUT}
        />
        <datalist id={sportsListId}>
          {sports.map((sport) => (
            <option key={sport} value={sport} />
          ))}
        </datalist>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${sportsListId}-fecha`} className={LABEL}>
          Fecha
        </label>
        <input
          id={`${sportsListId}-fecha`}
          name="playedOn"
          type="date"
          value={playedOn}
          onChange={(e) => setPlayedOn(e.target.value)}
          required
          className={INPUT}
        />
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted">
          ¿Quién ganó?
        </legend>
        <label className="flex min-h-[38px] items-center gap-2 text-[13.5px] font-bold">
          <input
            type="radio"
            name="outcome"
            value="won"
            required
            checked={outcome === 'won'}
            onChange={() => setOutcome('won')}
            className="h-4 w-4 shrink-0 accent-accent"
          />
          Ganaste vos
        </label>
        <label className="flex min-h-[38px] items-center gap-2 text-[13.5px] font-bold">
          <input
            type="radio"
            name="outcome"
            value="lost"
            checked={outcome === 'lost'}
            onChange={() => setOutcome('lost')}
            className="h-4 w-4 shrink-0 accent-accent"
          />
          Ganó {friendName}
        </label>
        <label className="flex min-h-[38px] items-center gap-2 text-[13.5px] font-bold">
          <input
            type="radio"
            name="outcome"
            value="drew"
            checked={outcome === 'drew'}
            onChange={() => setOutcome('drew')}
            className="h-4 w-4 shrink-0 accent-accent"
          />
          Empataron
        </label>
      </fieldset>

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={`${sportsListId}-scoreMine`} className={LABEL}>
            Tu marcador
          </label>
          <input
            id={`${sportsListId}-scoreMine`}
            name="scoreMine"
            type="number"
            value={scoreMine}
            onChange={(e) => setScoreMine(e.target.value)}
            className={INPUT}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={`${sportsListId}-scoreTheirs`} className={LABEL}>
            Marcador de {friendName}
          </label>
          <input
            id={`${sportsListId}-scoreTheirs`}
            name="scoreTheirs"
            type="number"
            value={scoreTheirs}
            onChange={(e) => setScoreTheirs(e.target.value)}
            className={INPUT}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={`${sportsListId}-teamMine`} className={LABEL}>
            Tu equipo
          </label>
          <input
            id={`${sportsListId}-teamMine`}
            name="teamMine"
            value={teamMine}
            onChange={(e) => setTeamMine(e.target.value)}
            className={INPUT}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={`${sportsListId}-teamTheirs`} className={LABEL}>
            Equipo de {friendName}
          </label>
          <input
            id={`${sportsListId}-teamTheirs`}
            name="teamTheirs"
            value={teamTheirs}
            onChange={(e) => setTeamTheirs(e.target.value)}
            className={INPUT}
          />
        </div>
      </div>

      {state.error !== null && <p className="text-[12px] font-bold text-live">{state.error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-field bg-accent p-3 text-center text-[14px] font-extrabold text-accent-text disabled:bg-chip disabled:text-muted"
        >
          {submitLabel}
        </button>
        {onCancel !== undefined && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-field bg-chip px-4 py-3 text-[13px] font-extrabold text-muted"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}

/**
 * Una fila casual de `Historial` (`app/amigos/historial.tsx`), con Editar y
 * Borrar (§3.1, §3.3 -- los dos pueden). `children` es el contenido de
 * lectura que `Historial` ya sabe armar (fecha, resultado, autoría); este
 * componente sólo agrega el borde de la tarjeta y los dos controles, para no
 * duplicar `resultadoCasualDe`/`autoriaDe` acá.
 *
 * El toggle de edición es un `useState` LOCAL, sin levantarlo a `Historial`:
 * cada fila decide su propio estado, y `Historial` sigue siendo la función
 * pura que ya prueba `historial.unit.test.ts` llamándola directo (sin JSX) --
 * mover el hook a `Historial` mismo rompería esa forma de probarla.
 *
 * Borrar NO pide confirmación (task-4-brief.md, "Editar y borrar" -- "no
 * construyas ninguna protección"): un botón de menos es la fricción que el
 * diseño pide sacar, no agregar.
 */
export function CasualMatchRow({
  friendPlayerId,
  friendName,
  partido,
  children,
}: {
  friendPlayerId: string
  friendName: string
  partido: CasualMatch
  children: ReactNode
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <CasualForm
        friendPlayerId={friendPlayerId}
        friendName={friendName}
        action={editCasualMatch}
        submitLabel="Guardar cambios"
        onCancel={() => setEditing(false)}
        initial={{
          matchId: partido.matchId,
          sport: partido.sport,
          playedOn: partido.playedOn,
          outcome: partido.outcome,
          scoreMine: partido.score !== null ? String(partido.score.mine) : '',
          scoreTheirs: partido.score !== null ? String(partido.score.theirs) : '',
          teamMine: partido.teams.mine ?? '',
          teamTheirs: partido.teams.theirs ?? '',
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-1 rounded-field border-[1.5px] border-line p-[14px]">
      {children}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[12px] font-extrabold text-accent-link"
        >
          Editar
        </button>
        <form action={removeCasualMatch}>
          <input type="hidden" name="friendPlayerId" value={friendPlayerId} />
          <input type="hidden" name="matchId" value={partido.matchId} />
          <button type="submit" className="text-[12px] font-extrabold text-live">
            Borrar
          </button>
        </form>
      </div>
    </div>
  )
}
