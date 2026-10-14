import type { CasualResultInput } from '@/db/friends'

/**
 * Los campos del formulario tal cual llegan de `FormData`: `parseCasualResult`
 * (`db/friends.ts`) es el único lugar que valida, para que
 * `createCasualMatch`/`updateCasualMatch` se puedan probar sin pasar por esta
 * capa (ver los tests de `db/friends.db.test.ts`).
 *
 * Pegamento hasta la Tarea 4b (plan-amigos-deporte-y-2v2): el formulario
 * todavía es el viejo, con dos números de marcador. En PADEL esos dos números
 * pasan a ser UN set a un set, con `gamesPerSet` = el mayor de los dos -- el
 * resultado sale igual de validado por `matchError`, sólo que con el formato
 * más permisivo que el formulario viejo puede expresar.
 */
export function casualInputFrom(formData: FormData): CasualResultInput {
  const campo = (name: string) => String(formData.get(name) ?? '')
  const input: CasualResultInput = {
    sport: campo('sport'),
    playedOn: campo('playedOn'),
    outcome: campo('outcome'),
    scoreMine: campo('scoreMine'),
    scoreTheirs: campo('scoreTheirs'),
    teamMine: campo('teamMine'),
    teamTheirs: campo('teamTheirs'),
    setsToWin: '',
    gamesPerSet: '',
    sets: '',
  }
  if (input.sport !== 'PADEL') return input
  const mine = Number(input.scoreMine)
  const theirs = Number(input.scoreTheirs)
  return {
    ...input,
    scoreMine: '',
    scoreTheirs: '',
    setsToWin: '1',
    gamesPerSet: String(Math.max(mine, theirs)),
    sets: JSON.stringify([{ mine, theirs }]),
  }
}

/**
 * A dónde vuelven Editar/Borrar: a la pantalla del amigo desde la que se envió
 * el formulario si es parte del partido (en un 2v2 la base devuelve "el primer
 * otro jugador con cuenta", que puede ser otro amigo); si no, a lo que
 * devolvió la base; si tampoco, `/amigos`.
 */
export function redirectTarget(submittedFriendId: string, participantIds: readonly string[], fromDb: string | null): string {
  if (submittedFriendId !== '' && participantIds.includes(submittedFriendId)) return `/amigos/${submittedFriendId}`
  return fromDb === null ? '/amigos' : `/amigos/${fromDb}`
}
