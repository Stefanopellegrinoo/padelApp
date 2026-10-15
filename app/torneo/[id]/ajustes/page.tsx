import { redirect } from 'next/navigation'
import { disciplineSlugs, formatsLabel, sportLabel, unitOf, validateConfig } from '@/core'
import { disciplineConfig } from '@/db/discipline'
import {
  disciplineRulesOf,
  myEntryId,
  playerNames,
  seasonHeader,
  seasonMatchdaysOf,
  seasonSquadMembersOf,
} from '@/db/read'
import { squadSeedOrder } from '@/db/season'
import { serverClient } from '@/db/server'
import { renameTournament } from './actions'
import { CargaDeJugadores } from './carga-jugadores'
import { CopiarLink } from './copiar'
import { Disciplinas } from './disciplinas'
import { EliminarTorneo } from './eliminar'
import { Plantel, type SeatVM } from './plantel'
import { Reglas } from './reglas'
import { ReglasDeporte } from './reglas-deporte'
import { Volver } from '../volver'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}

const ROW = 'flex items-center justify-between gap-3 px-3 py-3'
const LABEL = 'text-[14px] font-bold'
const VALUE = 'shrink-0 text-[13px] font-[750] text-muted'

/**
 * Ajustes — el CONTENEDOR (Task 4, docs/plan-arquitectura-de-paginas.md;
 * docs/arquitectura-de-paginas.md §2.5/§3.2/§5). Nombre, plantel, link de
 * invitación, borrar el torneo, y la lista de disciplinas: lo que
 * `docs/arquitectura-de-paginas.md` §3.2 pone del lado de `seasons`, no del
 * de `disciplines`.
 *
 * Con una sola disciplina —el 100% de los torneos que existen hoy— esta
 * misma pantalla sigue mostrando SUS paneles (las reglas del deporte y el
 * texto de la casa) inline, como hacía antes de esta Task: partir Ajustes en
 * dos para el caso simple sería cobrarle a ese 100% un peaje por el 0% que
 * hoy tiene 2+. Con 2+, esos paneles se mudan a `[disciplina]/ajustes` y
 * acá sólo queda el link de cada una (`<Disciplinas>` más abajo).
 *
 * La guarda de la pantalla es `isAdmin`, y la guarda de verdad es RLS para
 * casi todo: la mayoría de las escrituras de acá —y las de
 * `[disciplina]/ajustes`— pasan por políticas que piden `is_season_admin`
 * (`disciplines_write`, y el `count: 'exact'` de `db/entries.ts` para el
 * plantel). La excepción es `takeSeat`/`claimOwnSeat` (`db/entries.ts:108`):
 * usa el mismo `claim_seat` que Unirse, que sólo pide el invite token, no
 * `is_season_admin` — a quien llega hasta acá lo único que lo frena es
 * `isAdmin` de esta pantalla. Ésta es cortesía para el resto, para no
 * dibujarle a un jugador botones que le van a rebotar.
 *
 * Lo que NO está, y es a propósito (decisión registrada 6): Notificaciones,
 * Apariencia, "Cambiar contraseña" y "Salir del torneo" — las dos primeras no
 * son del torneo y las dos últimas no tienen backend.
 */
export default async function AjustesPage({ params, searchParams }: PageProps) {
  const { id: seasonId } = await params
  const { error: renameError } = await searchParams
  const supabase = await serverClient()

  const [header, rulesByDiscipline, myEntry, matchdays, squadMembers] = await Promise.all([
    seasonHeader(supabase, seasonId),
    disciplineRulesOf(supabase, seasonId),
    myEntryId(supabase, seasonId),
    // Temporada ENTERA (`seasonMatchdaysOf`), no `matchdaysOf`: `deleteSeason`
    // (`db/season.ts`) borra las fechas de TODAS las disciplinas, así que
    // `playedCount` (`:150-152` acá abajo, filtra CLOSED) tiene que contarlas
    // todas. `matchdaysOf` resuelve `defaultDisciplineId` (`db/read.ts`) y
    // sólo trae las de esa disciplina -- con 2+, el modal quedaba mudo sobre
    // las fechas cerradas de las demás, aunque `deleteSeason` se las lleve
    // igual. Sin medición propia: no hay hoy una temporada de prueba con
    // fechas cerradas en 2+ disciplinas contra la que correrlo.
    seasonMatchdaysOf(supabase, seasonId),
    // Temporada ENTERA, no la disciplina por defecto (C14,
    // ronda 8): "Plantel" administra el asiento de la TEMPORADA (renombrar,
    // reclamar, sacar), no el de una disciplina — usar `entriesOf(seasonId)`
    // sin disciplina caía en la disciplina por defecto y perdía a cualquier
    // SQUAD promovido desde otra. Mismo criterio que ya usaba
    //"+ Agregar disciplina" (REQ-D1-3): cualquier asiento de la temporada.
    seasonSquadMembersOf(supabase, seasonId),
  ])
  if (!header.isAdmin) redirect(`/torneo/${seasonId}`)

  // Task 4: con una sola disciplina esta pantalla sigue mostrando sus
  // paneles inline (ver el docblock de arriba); con 2+, se muestran en
  // `[disciplina]/ajustes`.
  const single = header.disciplines.length === 1
  const only = single ? header.disciplines[0] : undefined
  const slugs = disciplineSlugs(header.disciplines)
  // `fixedTeams` no viaja en `DisciplineHeader`: se pide con `disciplineConfig`, igual que
  // `[disciplina]/ajustes`. Sólo con una disciplina; con 2+ las reglas viven allá.
  const fixedTeams = only === undefined ? false : (await disciplineConfig(supabase, only.id)).fixedTeams

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
  //
  // Sobre TODAS las disciplinas (`flatMap`), no sólo una: el plantel se
  // EDITA acá, en el contenedor (§3.2 del diseño) — sacar un asiento en
  // `Plantel` de más abajo puede desalinear a una disciplina sin tocar la
  // otra, así que el aviso tiene que vivir donde de verdad se puede actuar.
  // Con 2+, cada mensaje lleva el nombre de SU disciplina (mismo prefijo que
  // `formatsLabel`, "Pádel: ..."); con una sola, `header.disciplines` tiene
  // un elemento y el resultado sale idéntico al de antes de esta Task.
  // `[disciplina]/ajustes` repite el mismo aviso sin prefijo, para quien
  // entra directo a esa pantalla sin pasar por acá.
  //
  // La cuenta es la de QUIEN JUEGA cada disciplina (`squadSeedOrder`, la misma que
  // `[disciplina]/ajustes`), no el plantel entero: un deporte sumado para 5 de los 6 tiene 5
  // valores de puntos y está bien. Con una sola disciplina las dos cuentas coinciden (ver
  // `squadSizeHere` en `[disciplina]/ajustes`) y no se paga la consulta.
  const seatsByDiscipline = single
    ? [seats.length]
    : (await Promise.all(header.disciplines.map((candidate) => squadSeedOrder(supabase, candidate.id)))).map(
        (players) => players.length,
      )
  const mismatchMessages = header.disciplines.flatMap((candidate, position) => {
    const seatsHere = seatsByDiscipline[position] ?? seats.length
    if (seatsHere === candidate.config.squadSize) return []
    const label = single ? null : sportLabel(candidate.kind)
    // `candidate.pairSize` real desde W30: `DisciplineHeader` ya trae
    // `pair_size` del mismo select que `config`.
    return validateConfig({ ...candidate.config, squadSize: seatsHere }, candidate.pairSize).map(
      (message, index) => ({
        key: `${candidate.id}-${index}`,
        text: label === null ? message : `${label}: ${message}`,
      }),
    )
  })

  // Sólo se computa con una sola disciplina (`single`): con 2+ esta fila no
  // se dibuja, así que no hace falta resumir el formato de TODAS acá — cada
  // una lo dice en su propia pantalla (`[disciplina]/ajustes`).
  //
  // `formatsLabel` y no `formatLabel` (que ni siquiera sale del barrel,
  // `core/narrate.ts:191`): el segundo pide un `MatchFormat` suelto, y
  // `header.disciplines` ya es la lista que arma el resto de esta función.
  // Con `single`, esa lista SIEMPRE tiene un elemento, así que el resultado
  // es la etiqueta de esa única disciplina -- nunca la combinación
  // "Pádel: … · FIFA: …" que esta misma función produce en Reglas y en el
  // resumen del wizard, donde sí corre sobre 2+.
  const formatoLabel = single
    ? formatsLabel(
        header.disciplines.map((candidate) => ({
          label: sportLabel(candidate.kind),
          matchFormat: candidate.config.matchFormat,
          unit: unitOf(candidate.kind, candidate.config.matchFormat),
        })),
      )
    : null
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

          {/* Sólo con una disciplina (Task 4): con 2+ el panel al que este
              ancla apunta ya no vive en esta pantalla -- se mudó a
              `[disciplina]/ajustes`, y esta fila desaparece en vez de
              quedar apuntando a un `#formato` que ya no existe acá (el
              defecto medido: el ancla siempre caía en la disciplina [0]). */}
          {single && (
            <a href="#formato" className={`${ROW} border-t border-line`}>
              <span className={LABEL}>Formato</span>
              <span className={VALUE}>{formatoLabel} ›</span>
            </a>
          )}

          <a href="#disciplinas" className={`${ROW} border-t border-line`}>
            <span className={LABEL}>Disciplinas</span>
            <span className={VALUE}>{header.disciplines.length} ›</span>
          </a>

          <div className={`${ROW} border-t border-line`}>
            <span className={LABEL}>Link de invitación</span>
            <CopiarLink token={header.inviteToken} />
          </div>

          {/* Lo único que abre: cargar el resultado de un partido de una fecha
              EN JUEGO. Abrir, cerrar y reabrir la fecha, el formato, las reglas
              y el plantel siguen siendo de quien organiza, con el permiso
              prendido o apagado. */}
          <div className={`${ROW} border-t border-line`}>
            <span className={LABEL}>Los jugadores cargan los resultados</span>
            <CargaDeJugadores seasonId={seasonId} enabled={header.playersCanScore} />
          </div>
        </div>

        {renameError !== undefined && (
          <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
            {renameError}
          </p>
        )}

        {single && (
          <p className="text-[11.5px] font-[600] text-muted">
            Cambiar el formato con fechas ya jugadas no recalcula la tabla vieja.
          </p>
        )}
      </section>

      {mismatchMessages.map(({ key, text }) => (
        <p key={key} className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          {text}
        </p>
      ))}

      <Plantel seasonId={seasonId} seats={seats} canTakeSeat={myEntry === null} />
      {/* Task 4: este bloque sólo se dibuja con una sola disciplina —con 2+, una tarjeta por
          disciplina acá mismo sería la mezcla de alturas que esta Task saca del contenedor
          (§2.5 del diseño); con 2+ viven en `[disciplina]/ajustes`. Torneos-deportes, Tarea 14:
          la tarjeta `ReglasDeporte` reemplaza a los paneles "Formato" y "Formato de las fechas".

          El `id="formato"` va en este `<div>` y no en la tarjeta: es el ancla de la fila "Formato"
          de arriba, y este bloque sólo existe cuando hay una disciplina. */}
      {only !== undefined && (
        <div id="formato" className="scroll-mt-4">
          <ReglasDeporte
            seasonId={seasonId}
            disciplineId={only.id}
            kind={only.kind}
            pairSize={only.pairSize}
            fixedTeams={fixedTeams}
            allowsDraw={only.allowsDraw}
            rules={{ config: only.config, hasMasters: only.hasMasters, formatoDefault: only.formatoDefault }}
          />
        </div>
      )}
      <Disciplinas
        seasonId={seasonId}
        disciplines={header.disciplines.map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          slug: slugs.get(candidate.id) ?? candidate.kind.toLowerCase(),
        }))}
        squad={squadMembers.map((member) => ({ entryId: member.id, name: member.displayName }))}
      />
      {/* Mismo criterio que el bloque de reglas de arriba: con 2+ el texto de la casa
          de cada disciplina vive en `[disciplina]/ajustes`, no acá. */}
      {single && (
        <div className="flex flex-col gap-5">
          {header.disciplines.map((candidate) => (
            <Reglas
              key={candidate.id}
              seasonId={seasonId}
              disciplineId={candidate.id}
              text={rulesByDiscipline.get(candidate.id) ?? ''}
              disciplineLabel={null}
            />
          ))}
        </div>
      )}

      {/* Acá estaba "Cerrar sesión", que no es de esta pantalla: es de la
          cuenta, no del torneo, y encima esta pantalla redirige a quien no es
          admin — así que un jugador común no tenía dónde cerrar sesión. Se mudó
          al círculo de Mis torneos. Lo que sí es de acá es eliminar el torneo. */}
      <EliminarTorneo seasonId={seasonId} name={header.name} playedCount={playedCount} />
    </div>
  )
}
