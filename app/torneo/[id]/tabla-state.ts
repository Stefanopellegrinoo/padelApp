/**
 * La derivación de los defensores de la Tabla, aparte de la pantalla para que
 * se pueda testear: `tabla-view.tsx` es un componente y la suite pura no lo
 * puede importar. Mismo motivo y mismo patrón que `armado-state.ts` y
 * `sumar-state.ts`.
 */

import { disciplineSlugs, MASTERS_SIZE, type SideSize, type SluggableDiscipline } from '@/core'
import type { StandingsRow } from './desempate'

/** Una fecha cerrada con los premios que se congelaron al cerrarla. */
export interface ClosedMatchdayAwards {
  number: number
  awards: readonly { entryId: string; position: number }[]
}

export interface Defenders {
  matchdayNumber: number
  names: string[]
}

export interface VolverDestination {
  href: string
  label: string
}

/**
 * Dónde cae el corte "CLASIFICAN AL MASTERS" de la Tabla (`Desempate`
 * dibuja la línea después de la fila `mastersCutoff`). Sólo existe con
 * `has_masters`: sin Masters devuelve `rowCount + 1`, fuera de rango a
 * propósito —mismo truco que la tabla global (`page.tsx`)— y la línea no se
 * dibuja. Antes la Tabla pasaba `MASTERS_SIZE` siempre y una FIFA individual
 * decía "CLASIFICAN AL MASTERS" sin tener Masters.
 *
 * `mastersRows` son las filas que cubren a los `MASTERS_SIZE` primeros
 * jugadores: `MASTERS_SIZE` cuando cada fila es una persona, y
 * `pairRows(...).mastersAfter` cuando la tabla va por pareja (con `rowCount`
 * también en filas de pareja). Con parejas fijas SIN Masters sigue valiendo
 * `rowCount + 1`: tener parejas no enciende la línea.
 */
export function mastersCutoffFor(hasMasters: boolean, rowCount: number, mastersRows = MASTERS_SIZE): number {
  return hasMasters ? mastersRows : rowCount + 1
}

/**
 * La Tabla de un deporte de parejas fijas: una fila por pareja ("Fede &
 * Martina"), con los puntos, el movimiento y el lugar del mejor ubicado de los
 * dos; los sueltos quedan como están. Los puestos se numeran de nuevo, 1..n.
 * El orden sale de la tabla de entrada (`rows`, ya ordenada), nunca del orden de
 * `teams`: `teamsOf` devuelve en orden de uuid los equipos que se crearon en
 * una sola inserción. El nombre sí sigue el orden del equipo (`a & b`), para
 * que no cambie de lado cuando se cruzan en la tabla.
 *
 * `mastersAfter` es cuántas filas cubren a los `MASTERS_SIZE` primeros
 * jugadores (una pareja son 2): ahí cae la línea "CLASIFICAN AL MASTERS".
 *
 * Los empates se marcan de nuevo entre FILAS: los dos de una pareja empatan
 * siempre entre sí, y el compañero ya no es una fila a la que apuntar. Sólo si
 * la tabla de entrada marcaba alguno — sin fecha cerrada `tabla-view` los apaga
 * a propósito, y entre las filas de pareja no puede haber un empate que entre
 * las personas no hubiera.
 *
 * ponytail: si los dos de una pareja tuvieran puntos distintos (una fecha
 * jugada antes de armar la pareja), la fila muestra los del mejor ubicado.
 * Un equipo con alguien que no está en `rows` se ignora: el otro queda suelto.
 */
export function pairRows(
  rows: readonly StandingsRow[],
  teams: readonly { a: string; b: string }[],
): { rows: StandingsRow[]; mastersAfter: number } {
  const byEntry = new Map(rows.map((row) => [row.entryId, row]))
  const teamOf = new Map<string, { first: StandingsRow; second: StandingsRow }>()
  for (const { a, b } of teams) {
    const first = byEntry.get(a)
    const second = byEntry.get(b)
    if (first === undefined || second === undefined) continue
    teamOf.set(a, { first, second })
    teamOf.set(b, { first, second })
  }

  const merged = new Set<string>()
  const paired: StandingsRow[] = []
  let mastersAfter = 0
  let covered = 0
  for (const row of rows) {
    if (merged.has(row.entryId)) continue
    const team = teamOf.get(row.entryId)
    if (team !== undefined) {
      merged.add(team.first.entryId)
      merged.add(team.second.entryId)
    }
    paired.push(
      team === undefined
        ? row
        : {
            ...row,
            displayName: `${team.first.displayName} & ${team.second.displayName}`,
            initials: team.first.initials.slice(0, 1) + team.second.initials.slice(0, 1),
          },
    )
    if (covered < MASTERS_SIZE) {
      covered += team === undefined ? 1 : 2
      mastersAfter += 1
    }
  }

  const showTies = rows.some((row) => row.tiedWithEntryId !== null)
  const numbered = paired.map((row, index): StandingsRow => {
    const previous = paired[index - 1]
    const next = paired[index + 1]
    const tied =
      previous !== undefined && previous.points === row.points
        ? previous.entryId
        : next !== undefined && next.points === row.points
          ? next.entryId
          : null
    return { ...row, position: index + 1, tiedWithEntryId: showTies ? tied : null }
  })

  return { rows: numbered, mastersAfter }
}

/**
 * A dónde manda el "volver" de la Tabla por-disciplina (spec
 * `docs/tipos-de-torneo.md` §2.4, segundo arreglo: "con una sola disciplina,
 * mostrar una tabla"). Con 2+ disciplinas sube a la tabla global
 * (`/torneo/{seasonId}`, `page.tsx`) — la pantalla que arma la lista de
 * links a cada una. Con exactamente 1, esa misma raíz REDIRIGE acá (ver
 * `singleDisciplineRedirect` abajo, que llama `page.tsx`), así que apuntarla
 * de vuelta rebotaría al toque. Ahí el destino pasa a ser "Mis torneos", el
 * mismo Volver que usa la raíz cuando no redirige.
 */
export function volverDestination(seasonId: string, disciplineCount: number): VolverDestination {
  return disciplineCount === 1
    ? { href: '/torneos', label: 'Mis torneos' }
    : { href: `/torneo/${seasonId}`, label: 'Tabla general' }
}

/**
 * A dónde redirige la raíz de la temporada (`page.tsx`) — spec
 * `docs/tipos-de-torneo.md` §2.4, segundo arreglo, línea 225: "Con una sola
 * disciplina, mostrar **una** tabla". `null` con 2+ disciplinas: ahí la raíz
 * se queda mostrando la global de siempre, sin cambio.
 *
 * `disciplines.length !== 1` primero, no un `.find`: con exactamente 1, el
 * único elemento es `disciplines[0]`, pero `noUncheckedIndexedAccess` igual
 * lo tipa `| undefined` — el chequeo de abajo es sólo para que compile, la
 * longitud ya lo garantiza en runtime. `slug === undefined` es la misma
 * defensa por-si-acaso de `fechas/page.tsx` (otra ruta que colapsa a la
 * disciplina primaria): `disciplineSlugs` arma un slug para
 * CADA elemento de la lista que se le pasa, así que en la práctica nunca
 * dispara — acá se resuelve devolviendo `null` (se queda en la global) en vez
 * de tirar `EdgeError`, porque a diferencia de esa ruta esta pantalla SÍ
 * tiene algo razonable para mostrar si el redirect no aplica.
 */
export function singleDisciplineRedirect(
  seasonId: string,
  disciplines: readonly SluggableDiscipline[],
): string | null {
  if (disciplines.length !== 1) return null
  const discipline = disciplines[0]
  if (discipline === undefined) return null
  const slug = disciplineSlugs(disciplines).get(discipline.id)
  return slug === undefined ? null : `/torneo/${seasonId}/${slug}`
}

/**
 * Quién defiende el título de la fecha anterior, o `null` cuando no defiende
 * nadie.
 *
 * Nada de esto se guarda (spec 3.3): sale de los `awards` congelados, igual
 * que `previousContext` en `core/history.ts`. Quien ya repitió gastó su
 * defensa y no vuelve a aparecer.
 *
 * W42: con `sideSize === 1` NO HAY defensores, y esto
 * lo tiene que decir la pantalla porque el sorteo ya lo dice. Defender el
 * título es una restricción del sorteo DE PAREJAS —`buildSides` con
 * `sideSize === 1` ignora `defenders` entero, y `pairingContextFor` ni
 * siquiera lo calcula (C19)—, así que anunciar "Repiten" sobre un jugador
 * solo promete una regla que después no se aplica. Misma decisión y mismo
 * motivo que `championsOf` en `core/history.ts`, que devuelve `null` para un
 * lado de uno: las dos derivaciones tienen que contestar lo mismo.
 */
export function defendersOf(
  closedRegular: readonly ClosedMatchdayAwards[],
  nameOf: ReadonlyMap<string, string>,
  sideSize: SideSize,
): Defenders | null {
  if (sideSize === 1) return null

  const sorted = [...closedRegular].sort((a, b) => b.number - a.number)
  const last = sorted[0]
  const beforeLast = sorted[1]

  const winnersOf = (matchday: ClosedMatchdayAwards | undefined): string[] =>
    matchday === undefined
      ? []
      : matchday.awards.filter((award) => award.position === 1).map((award) => award.entryId)

  const lastWinnerIds = winnersOf(last)
  const beforeLastWinnerIds = new Set(winnersOf(beforeLast))
  const alreadyRepeated =
    lastWinnerIds.length > 0 &&
    lastWinnerIds.length === beforeLastWinnerIds.size &&
    lastWinnerIds.every((entryId) => beforeLastWinnerIds.has(entryId))

  if (last === undefined || lastWinnerIds.length === 0 || alreadyRepeated) return null
  return {
    matchdayNumber: last.number,
    names: lastWinnerIds.map((entryId) => nameOf.get(entryId) ?? ''),
  }
}
