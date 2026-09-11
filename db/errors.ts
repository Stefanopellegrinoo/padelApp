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
 * Espera sobre un lock que terminó mal. `40P01` es el deadlock (Postgres lo
 * detecta a los `deadlock_timeout = 1s` y aborta una de las dos transacciones)
 * y `55P03` es el `lock_timeout` venciendo antes de conseguir el lock.
 *
 * Casi siempre significan que hubo otra escritura encima. No es la única causa
 * posible —un `alter table entries` durante un deploy produce la misma espera—
 * pero sí la única que un admin puede hacer algo al respecto, y la acción es
 * la misma en los dos casos.
 */
const LOCK_CONTENTION = new Set(['40P01', '55P03'])

/**
 * El statement se canceló por `statement_timeout` — y es, MEDIDO, el código
 * que de verdad llega por este camino.
 *
 * Con el advisory de la temporada retenido por otra sesión, una llamada a
 * `remove_squad_seat` por PostgREST (rol `authenticated`, como la app) espera
 * 8s y vuelve con `{"code":"57014","message":"canceling statement due to
 * statement timeout"}`, no con `55P03`.
 *
 * **El motivo NO es que el `lock_timeout` se pierda** — se probó y sobrevive:
 * `set lock_timeout='2s'; set role authenticated;` deja `lock_timeout=2s` en
 * pie, y con esa configuración la misma llamada vuelve con `55P03`. El motivo
 * es más simple: en la sesión real los dos presupuestos valen 8s
 * (`pg_roles.rolconfig`: `authenticator` tiene `statement_timeout` Y
 * `lock_timeout` en 8s), y el reloj del `statement_timeout` arranca al empezar
 * el statement mientras el del `lock_timeout` recién arranca cuando empieza la
 * espera. Con presupuestos iguales, `statement_timeout` gana siempre.
 *
 * O sea: `55P03` NO es código muerto. Está a un `alter role ... set
 * lock_timeout` más corto de distancia, que es una cosa perfectamente normal
 * de tunear. No lo saques de `LOCK_CONTENTION`.
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
 * traductor existe para lo que NO es uno de esos `raise`: desde que
 * `add_squad_seat`, `promote_guest` y `remove_squad_seat` toman el advisory
 * lock por temporada (0081/0084/0086) pueden esperar de verdad, y cuando la
 * espera termina mal el texto lo escribe Postgres, en inglés.
 *
 * Son TRES, no cuatro. `claim_seat` —el cuarto call site donde se usa esto—
 * no toma ningún advisory: verificado contra `pg_proc.prosrc`, hace
 * `select seasons` → `select players` → `update entries ... where player_id is
 * null`, sin lock explícito. Se le aplica igual porque puede esperar sobre la
 * fila de `entries` como cualquier update, no porque esté en la sección
 * crítica del advisory.
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
