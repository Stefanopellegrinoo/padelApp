import { EdgeError } from '@/db/errors'
import type { CasualPlayerInput, CasualResultInput } from '@/db/friends'

/**
 * Los campos del formulario tal cual llegan de `FormData`: `parseCasualResult`
 * (`db/friends.ts`) es el único lugar que valida, para que
 * `createCasualMatch`/`updateCasualMatch` se puedan probar sin pasar por esta
 * capa (ver los tests de `db/friends.db.test.ts`).
 */
export function casualInputFrom(formData: FormData): CasualResultInput {
  const campo = (name: string) => String(formData.get(name) ?? '')
  return {
    sport: campo('sport'),
    playedOn: campo('playedOn'),
    outcome: campo('outcome'),
    scoreMine: campo('scoreMine'),
    scoreTheirs: campo('scoreTheirs'),
    teamMine: campo('teamMine'),
    teamTheirs: campo('teamTheirs'),
    setsToWin: campo('setsToWin'),
    gamesPerSet: campo('gamesPerSet'),
    sets: campo('sets'),
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

/**
 * El historial es por amigo (`historyWith`): un partido cuyo plantel no incluye
 * al amigo de la pantalla desde la que se cargó se guarda pero no aparece en
 * ella, y quien lo cargó cree que falló y lo repite. Borde de confianza: el
 * cliente ya lo exige (`slotsError`), pero el `players` lo puede armar a mano
 * cualquiera.
 */
export function assertFriendPlays(friendPlayerId: string, players: readonly CasualPlayerInput[]): void {
  if (friendPlayerId === '' || !players.some((player) => player.playerId === friendPlayerId)) {
    throw new EdgeError('Tiene que jugar el amigo de esta pantalla.')
  }
}
