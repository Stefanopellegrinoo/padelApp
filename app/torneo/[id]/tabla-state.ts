/**
 * La derivación de los defensores de la Tabla, aparte de la pantalla para que
 * se pueda testear: `tabla-view.tsx` es un componente y la suite pura no lo
 * puede importar. Mismo motivo y mismo patrón que `armado-state.ts` y
 * `sumar-state.ts`.
 */

import { disciplineSlugs, type SideSize, type SluggableDiscipline } from '@/core'

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
