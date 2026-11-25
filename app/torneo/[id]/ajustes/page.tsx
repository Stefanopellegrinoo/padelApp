import { redirect } from 'next/navigation'
import { disciplineSlugs, formatsLabel, sportLabel, unitOf, validateConfig } from '@/core'
import { disciplineConfig } from '@/db/discipline'
import {
  disciplineRulesOf,
  myEntryId,
  playerNames,
  seasonHeader,
  seasonInviteToken,
  seasonMatchdaysOf,
  seasonSquadMembersOf,
} from '@/db/read'
import { squadSeedOrder } from '@/db/season'
import { serverClient } from '@/db/server'
import { Hero } from '@/app/ui/hero'
import { Section } from '@/app/ui/section'
import { CargaDeJugadores } from './carga-jugadores'
import { CopiarLink } from './copiar'
import { PasarAdmin } from './pasar-admin'
import { Disciplinas } from './disciplinas'
import { EliminarTorneo } from './eliminar'
import { NombreTorneo } from './nombre'
import { Aviso, GRUPO } from './piezas'
import { Plantel, type SeatVM } from './plantel'
import { Reglas } from './reglas'
import { ReglasDeporte } from './reglas-deporte'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}

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
 * La pantalla va en secciones con título (Torneo, Plantel con el link de
 * invitación, las reglas y los Deportes, Administración) y lo que se edita se edita en una hoja:
 * antes era un solo scroll largo con formularios abiertos en el medio
 * (`docs/arquitectura-de-paginas.md` §2.5). Eliminar va al final, separado y
 * en rojo.
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

  // S8: el token ya no viaja en el header (revocado a no-admins). Acá, ya
  // confirmado el admin, se pide aparte por `season_invite_token`.
  const inviteToken = (await seasonInviteToken(supabase, seasonId)) ?? ''

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

  // El formato de cada deporte, para la línea gris de su fila en "Deportes".
  // `formatsLabel` con UN elemento devuelve la frase sin prefijo
  // (`narrate.ts`, `distinct.length <= 1`); se llama así porque el barril de
  // `core/` no exporta `formatLabel` a propósito.
  const formatOf = (candidate: (typeof header.disciplines)[number]) =>
    formatsLabel([
      {
        label: sportLabel(candidate.kind),
        matchFormat: candidate.config.matchFormat,
        unit: unitOf(candidate.kind, candidate.config.matchFormat),
      },
    ])
  // CLOSED y no todas: lo que el modal tiene que poner en juego es lo que ya se
  // jugó, no una fecha en DRAFT que no cuesta nada volver a abrir.
  const playedCount = matchdays.filter((matchday) => matchday.status === 'CLOSED').length

  const sports = header.disciplines.map((candidate) => sportLabel(candidate.kind))
  return (
    <div className="pb-4">
      {/* A la Tabla, no a Mis torneos: acá se entra por el engranaje de la
          Tabla, así que volver es deshacer ese paso. Con un solo deporte la
          raíz del torneo redirige a su Tabla; con 2+ es la general. */}
      <Hero
        back={{ href: `/torneo/${seasonId}`, label: single ? 'Tabla' : 'Tabla general' }}
        kicker={header.name}
        title="Ajustes"
        subtitle={sports.length === 1 ? sports[0] : `${sports.slice(0, -1).join(', ')} y ${sports.at(-1)}`}
        sport={only?.kind}
      />

      <Section title="Torneo">
        <div className={GRUPO}>
          {/* El nombre se guarda con un form y la server action de siempre;
              el error vuelve por la query y la `key` remonta la fila para que
              la hoja arranque abierta con él. */}
          <NombreTorneo key={renameError ?? ''} seasonId={seasonId} name={header.name} error={renameError} />
          {/* Lo único que abre: cargar el resultado de un partido de una fecha
              EN JUEGO. Abrir, cerrar y reabrir la fecha, el formato, las reglas
              y el plantel siguen siendo de quien organiza, con el permiso
              prendido o apagado. */}
          <CargaDeJugadores seasonId={seasonId} enabled={header.playersCanScore} />
        </div>
      </Section>

      <Plantel seasonId={seasonId} seats={seats} canTakeSeat={myEntry === null} me={myEntry}>
        <CopiarLink seasonId={seasonId} seasonName={header.name} token={inviteToken} />
        {mismatchMessages.map(({ key, text }) => (
          <Aviso key={key} className="mb-3">
            {text}
          </Aviso>
        ))}
      </Plantel>

      {/* Task 4: las reglas del deporte y el texto de la casa sólo se dibujan acá con una sola
          disciplina —con 2+, una tarjeta por disciplina acá mismo sería la mezcla de alturas que
          esta Task saca del contenedor (§2.5 del diseño); con 2+ viven en `[disciplina]/ajustes`. */}
      {only !== undefined && (
        <>
          <ReglasDeporte
            seasonId={seasonId}
            disciplineId={only.id}
            kind={only.kind}
            pairSize={only.pairSize}
            fixedTeams={fixedTeams}
            allowsDraw={only.allowsDraw}
            rules={{ config: only.config, hasMasters: only.hasMasters, formatoDefault: only.formatoDefault }}
          />
          <Reglas
            seasonId={seasonId}
            disciplineId={only.id}
            text={rulesByDiscipline.get(only.id) ?? ''}
            disciplineLabel={null}
          />
        </>
      )}

      <Disciplinas
        seasonId={seasonId}
        disciplines={header.disciplines.map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          // `slugs` sale de esta misma lista: siempre tiene la clave.
          slug: slugs.get(candidate.id)!,
          meta: formatOf(candidate),
        }))}
        squad={squadMembers.map((member) => ({ entryId: member.id, name: member.displayName }))}
      />

      <Section title="Administración">
        <div className={GRUPO}>
          {/* Sólo asientos reclamados (`playerId` no nulo = alguien con
              cuenta lo tomó con el link) y no el propio. */}
          <PasarAdmin
            seasonId={seasonId}
            candidates={squadMembers
              .filter((member) => member.playerId !== null && member.id !== myEntry)
              .map((member) => ({ entryId: member.id, name: member.displayName }))}
          />
        </div>
      </Section>

      {/* Acá estaba "Cerrar sesión", que no es de esta pantalla: es de la
          cuenta, no del torneo, y encima esta pantalla redirige a quien no es
          admin — así que un jugador común no tenía dónde cerrar sesión. Se mudó
          al círculo de Mis torneos. Lo que sí es de acá es eliminar el torneo. */}
      <EliminarTorneo seasonId={seasonId} name={header.name} playedCount={playedCount} />
    </div>
  )
}
