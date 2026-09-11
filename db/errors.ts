/**
 * An error the player is meant to read. Anything that is not one of these is a
 * bug, and its details belong in the server log, not on the screen.
 */
export class EdgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EdgeError'
  }
}

/**
 * Contención sobre un lock, dicha sin ambigüedad por Postgres: `40P01` es el
 * deadlock (lo detecta a los `deadlock_timeout = 1s` y aborta una de las dos
 * transacciones) y `55P03` es el `lock_timeout` venciendo antes de conseguir
 * el lock. Cuando llega uno de estos dos, hubo otra escritura encima: no hay
 * otra causa posible.
 */
const LOCK_CONTENTION = new Set(['40P01', '55P03'])

/**
 * El statement se canceló por `statement_timeout` — y es, MEDIDO, el código
 * que de verdad llega por este camino.
 *
 * Con el advisory de la temporada retenido por otra sesión, una llamada a
 * `remove_squad_seat` por PostgREST (rol `authenticated`, como la app) espera
 * 8s y vuelve con `{"code":"57014","message":"canceling statement due to
 * statement timeout"}` — no con `55P03`. El `lock_timeout = 8s` está en
 * `authenticator`, el rol de LOGIN, y no sobrevive al `set role authenticated`
 * que hace PostgREST; el que gobierna es el `statement_timeout = 8s` de
 * `authenticated` (`alter role`, visible en `pg_roles.rolconfig`).
 *
 * Va aparte de los otros dos porque su causa no es única: acá la espera es la
 * causa esperable, pero una consulta lenta por cualquier otro motivo termina
 * igual. Por eso el mensaje dice qué pasó y qué hacer, y no inventa a otra
 * persona que puede no existir.
 */
const STATEMENT_TIMEOUT = '57014'

/**
 * El mensaje que le llega a la pantalla desde una RPC.
 *
 * Las funciones del plantel pasan su mensaje DERECHO, sin prefijo, porque sus
 * `raise` ya están en castellano (ver `addSquadSeat`, `db/entries.ts`). Este
 * traductor existe para lo que NO es uno de esos `raise`: desde que las cuatro
 * toman el advisory lock por temporada (0081/0084/0086) pueden esperar de
 * verdad, y cuando la espera termina mal el texto lo escribe Postgres, en
 * inglés.
 *
 * Los dos mensajes dicen que no se guardó nada porque es cierto: las tres
 * cosas abortan la transacción de la función, que es un único statement, así
 * que no queda nada a medias.
 */
export function rpcErrorMessage(error: { code?: string | null; message: string }): string {
  const code = error.code ?? ''
  if (LOCK_CONTENTION.has(code)) {
    return 'Otra persona estaba cambiando el plantel de este torneo al mismo tiempo. No se guardó nada: probá de nuevo.'
  }
  if (code === STATEMENT_TIMEOUT) {
    return 'El cambio tardó demasiado y se canceló. No se guardó nada: probá de nuevo.'
  }
  return error.message
}
