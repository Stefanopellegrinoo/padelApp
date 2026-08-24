import { redirect } from 'next/navigation'
import { DISCIPLINE_LABELS } from '@/app/torneos/nuevo/wizard-state'
import { disciplineSlugs, formatsLabel, validateConfig } from '@/core'
import {
  matchdaysOf,
  myEntryId,
  playerNames,
  primaryDiscipline,
  seasonHeader,
  seasonRules,
  seasonSquadMembersOf,
} from '@/db/read'
import { serverClient } from '@/db/server'
import { renameTournament } from './actions'
import { CopiarLink } from './copiar'
import { Disciplinas } from './disciplinas'
import { EliminarTorneo } from './eliminar'
import { Formato } from './formato'
import { Plantel, type SeatVM } from './plantel'
import { Reglas } from './reglas'
import { Volver } from '../volver'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}

const ROW = 'flex items-center justify-between gap-3 px-3 py-3'
const LABEL = 'text-[14px] font-bold'
const VALUE = 'shrink-0 text-[13px] font-[750] text-muted'

/**
 * Ajustes — la única pantalla de administración pura de la app.
 *
 * La guarda de la pantalla es `isAdmin`, pero la guarda de verdad es RLS: todas
 * las escrituras de acá pasan por políticas que piden `is_season_admin`. Ésta
 * es cortesía, para no dibujarle a un jugador botones que le van a rebotar.
 *
 * Lo que NO está, y es a propósito (decisión registrada 6): Notificaciones,
 * Apariencia, "Cambiar contraseña" y "Salir del torneo" — las dos primeras no
 * son del torneo y las dos últimas no tienen backend.
 */
export default async function AjustesPage({ params, searchParams }: PageProps) {
  const { id: seasonId } = await params
  const { error: renameError } = await searchParams
  const supabase = await serverClient()

  const [header, rules, myEntry, matchdays, squadMembers] = await Promise.all([
    seasonHeader(supabase, seasonId),
    seasonRules(supabase, seasonId),
    myEntryId(supabase, seasonId),
    matchdaysOf(supabase, seasonId),
    // Temporada ENTERA, no la disciplina por defecto (C14, 
    // ronda 8): "Plantel" administra el asiento de la TEMPORADA (renombrar,
    // reclamar, sacar), no el de una disciplina — usar `entriesOf(seasonId)`
    // sin disciplina caía en la disciplina por defecto y perdía a cualquier
    // SQUAD promovido desde otra. Mismo criterio que ya usaba
    //"+ Agregar disciplina" (REQ-D1-3): cualquier asiento de la temporada.
    seasonSquadMembersOf(supabase, seasonId),
  ])
  if (!header.isAdmin) redirect(`/torneo/${seasonId}`)
  const discipline = primaryDiscipline(header)
  const slugs = disciplineSlugs(header.disciplines)

  const owners = await playerNames(
    supabase,
    squadMembers.map((member) => member.playerId).filter((playerId): playerId is string => playerId !== null),
  )
  const seats: SeatVM[] = squadMembers.map((member) => ({
    entryId: member.id,
    name: member.displayName,
    ownerName: member.playerId === null ? null : (owners.get(member.playerId) ?? null),
  }))

  // El desajuste entre los asientos que hay y los que dice la config se reporta
  // con `validateConfig`, no con un copy nuevo: agregar o sacar un asiento no
  // toca `squadSize` ni `points` (decisión registrada 3), así que las dos cosas
  // pueden quedar en desacuerdo y hay que decirlo con la voz que ya existe.
  const mismatch =
    seats.length === discipline.config.squadSize
      ? []
      : // `discipline.pairSize` real desde W30:
        // `DisciplineHeader` ya trae `pair_size` del mismo select que `config`.
        validateConfig({ ...discipline.config, squadSize: seats.length }, discipline.pairSize)

  // `formatsLabel` sobre TODAS las disciplinas y no `formatLabel` sobre la
  // [0]: esta fila decía "1 set a 4 games" en un torneo que tiene una mitad
  // que se juega a goles. Con una sola
  // disciplina dice exactamente lo que decía. Es la misma etiqueta que
  // muestran Reglas y el resumen del wizard — antes eran tres copias, y ésa es
  // la razón por la que las tres mentían igual.
  const formatoLabel = formatsLabel(
    header.disciplines.map((candidate) => ({
      label: DISCIPLINE_LABELS[candidate.kind],
      matchFormat: candidate.config.matchFormat,
    })),
  )
  // CLOSED y no todas: lo que el modal tiene que poner en juego es lo que ya se
  // jugó, no una fecha en DRAFT que no cuesta nada volver a abrir.
  const playedCount = matchdays.filter((matchday) => matchday.status === 'CLOSED').length

  return (
    <div className="flex flex-col gap-4 pt-3">
      {/* A la Tabla, no a Mis torneos: acá se entra por el engranaje de la
          Tabla, así que volver es deshacer ese paso. Mandar a Mis torneos
          sacaría del torneo a quien sólo quiso cerrar los ajustes. */}
      <Volver href={`/torneo/${seasonId}`} label="Tabla" />
      <header className="flex flex-col gap-[3px]">
        <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
          {header.name}
        </p>
        <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Ajustes</h1>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">Torneo</h2>

        <div className="overflow-hidden rounded-[14px] border border-line bg-surface">
          {/* El nombre se manda con un form y sin JavaScript: es un campo y un
              Enter. El error vuelve por la query. */}
          <form action={renameTournament} className={ROW}>
            <input type="hidden" name="seasonId" value={seasonId} />
            <label className={LABEL} htmlFor="nombre">
              Nombre
            </label>
            <input
              id="nombre"
              name="name"
              defaultValue={header.name}
              required
              className={`min-w-0 flex-1 rounded-field border bg-surface px-3 py-2 text-right text-[16px] font-[750] outline-none ${
                renameError === undefined ? 'border-line' : 'border-live'
              }`}
            />
          </form>

          <a href="#plantel" className={`${ROW} border-t border-line`}>
            <span className={LABEL}>Plantel</span>
            <span className={VALUE}>{seats.length} ›</span>
          </a>

          <a href="#formato" className={`${ROW} border-t border-line`}>
            <span className={LABEL}>Formato</span>
            <span className={VALUE}>{formatoLabel} ›</span>
          </a>

          <a href="#disciplinas" className={`${ROW} border-t border-line`}>
            <span className={LABEL}>Disciplinas</span>
            <span className={VALUE}>{header.disciplines.length} ›</span>
          </a>

          <div className={`${ROW} border-t border-line`}>
            <span className={LABEL}>Link de invitación</span>
            <CopiarLink token={header.inviteToken} />
          </div>
        </div>

        {renameError !== undefined && (
          <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
            {renameError}
          </p>
        )}

        <p className="text-[11.5px] font-[600] text-muted">
          Cambiar el formato con fechas ya jugadas no recalcula la tabla vieja.
        </p>
      </section>

      {mismatch.map((message) => (
        <p key={message} className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          {message}
        </p>
      ))}

      <Plantel seasonId={seasonId} seats={seats} canTakeSeat={myEntry === null} />
      {/* UN panel POR DISCIPLINA (C36). Editaba sólo la [0], y con eso
          `has_masters` de la segunda no se podía cambiar desde ninguna
          pantalla — la decisión #4029 parte 2 dice "editable en Ajustes", y
          sólo lo era para la primaria. Desde que cada disciplina juega su
          propio Masters (decisión #4035), que Ajustes editara una sola
          quedaba además inconsistente con la pantalla de Fechas.

          `disciplineLabel` ya venía preparado para esto desde W65: con una
          sola disciplina el título sale como el mismo nodo de texto de
          siempre. El `id="formato"` va acá y no en cada `<section>`: con más
          de una habría un `id` repetido, y el ancla de la fila de arriba
          salta igual al primero, que es la primaria. */}
      <div id="formato" className="flex flex-col gap-5 scroll-mt-4">
        {header.disciplines.map((candidate) => (
          <Formato
            key={candidate.id}
            seasonId={seasonId}
            disciplineId={candidate.id}
            config={candidate.config}
            pairSize={candidate.pairSize}
            hasMasters={candidate.hasMasters}
            disciplineLabel={header.disciplines.length > 1 ? DISCIPLINE_LABELS[candidate.kind] : null}
          />
        ))}
      </div>
      <Disciplinas
        seasonId={seasonId}
        disciplines={header.disciplines.map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          slug: slugs.get(candidate.id) ?? candidate.kind.toLowerCase(),
        }))}
        squad={squadMembers.map((member) => ({ entryId: member.id, name: member.displayName }))}
      />
      <Reglas seasonId={seasonId} text={rules.text} />

      {/* Acá estaba "Cerrar sesión", que no es de esta pantalla: es de la
          cuenta, no del torneo, y encima esta pantalla redirige a quien no es
          admin — así que un jugador común no tenía dónde cerrar sesión. Se mudó
          al círculo de Mis torneos. Lo que sí es de acá es eliminar el torneo. */}
      <EliminarTorneo seasonId={seasonId} name={header.name} playedCount={playedCount} />
    </div>
  )
}
