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
 * Los dos índices únicos de `seed_position` — el de la disciplina (0023) y el
 * de la temporada (0080). Un `23505` que nombra a uno de ellos significa que
 * otra escritura ocupó ese lugar del orden en el mismo instante: se perdió
 * esta, no pasó nada más, y reintentar es exactamente lo correcto.
 *
 * **Cuál es el camino medido, y cuál NO.** El gate reproduce este choque 60/60
 * en el par `add_squad_seat ‖ addDiscipline`, pero el 23505 lo recibe SIEMPRE
 * el bulk insert de `addDiscipline`, nunca la RPC — y tiene que ser así:
 * `add_squad_seat` llega primero a la disciplina nueva (vacía) e inserta en
 * `seed_position 0`, y el bulk insert viene después con 0..19 y choca. Si gana
 * el bulk, la RPC lee `max+1 = 20` y no choca con nada. Por eso esta traducción
 * se aplica TAMBIÉN en `addDiscipline` (`db/discipline.ts`), que es donde el
 * error aparece de verdad.
 *
 * Por esta vía (la RPC) la rama es alcanzable pero NO está medida: haría falta
 * un `add_squad_seat` sin `p_before` contra `addToDiscipline` sobre la misma
 * disciplina, o contra el bulk insert de `createSeason`. Queda escrito para que
 * nadie la cite como medida.
 *
 * Se mira el NOMBRE del índice y no sólo el código: un `23505` sobre una
 * PRIMARY KEY es otra causa ("este jugador ya juega esta disciplina"), donde
 * "probá de nuevo" sería un consejo equivocado. `addToDiscipline`
 * (`db/discipline-entries.ts`) hace el mismo distingo pero con la polaridad
 * INVERSA —lista negra: traduce todo 23505 y separa el de la PK— mientras acá
 * es lista blanca. La lista blanca es la que no miente ante un unique nuevo.
 */
const SEED_UNIQUE = /"(discipline_entries_seed|season_seed_order_seed)"/

/**
 * Un jugador tiene a lo sumo UN asiento por temporada, y `claim_seat` lo
 * chequea con un `if exists` que NO es atómico con su `update`: dos reclamos
 * concurrentes del mismo jugador sobre asientos distintos pasan los dos el
 * chequeo y el segundo rebota contra este índice. Reproducido en vivo.
 *
 * El texto copia el `raise` que `claim_seat` usa para el caso no concurrente
 * ("Ya tenés un lugar en este torneo."), porque para quien está del otro lado
 * de la pantalla es exactamente la misma situación.
 */
const ONE_SEAT_UNIQUE = /"entries_one_seat"/

/**
 * El mensaje que le llega a la pantalla cuando una escritura del plantel falla
 * por algo que NO es uno de nuestros `raise`.
 *
 * Las funciones del plantel pasan su mensaje DERECHO, sin prefijo, porque sus
 * `raise` ya están en castellano (ver `addSquadSeat`, `db/entries.ts`). Este
 * traductor existe para el resto: desde que `add_squad_seat`, `promote_guest` y
 * `remove_squad_seat` toman el advisory lock por temporada (0081/0084/0086)
 * esas llamadas pueden esperar de verdad, y cuando la espera termina mal el
 * texto lo escribe Postgres, en inglés.
 *
 * Son TRES las que toman el advisory, no cuatro. `claim_seat` —otro call site
 * de esto— no toma ninguno: verificado contra `pg_proc.prosrc`, hace `select
 * seasons` → `select players` → `update entries ... where player_id is null`,
 * sin lock explícito. Se le aplica igual porque puede esperar sobre la fila de
 * `entries` como cualquier update, y porque tiene su propio `23505`.
 *
 * **No se llama `rpcErrorMessage`** aunque nació ahí: `addDiscipline`
 * (`db/discipline.ts`) no es una RPC y es el lugar donde el `23505` sobre el
 * orden aparece de verdad (ver `SEED_UNIQUE`). Un nombre que excluye a uno de
 * sus call sites es la clase de premisa falsa que esta rama ya pagó tres veces.
 *
 * Todos los mensajes dicen que no se guardó nada porque es cierto: cada uno de
 * estos códigos aborta la transacción completa de la escritura.
 */
export function writeErrorMessage(error: { code?: string | null; message: string }): string {
  const code = error.code ?? ''
  if (LOCK_CONTENTION.has(code)) {
    return 'Otra persona estaba cambiando el plantel de este torneo al mismo tiempo. No se guardó nada: probá de nuevo.'
  }
  if (code === STATEMENT_TIMEOUT) {
    return 'El cambio tardó demasiado y se canceló. No se guardó nada: probá de nuevo.'
  }
  if (code === '23505' && SEED_UNIQUE.test(error.message)) {
    return 'Otra alta ocupó ese lugar justo ahora. No se guardó nada: probá de nuevo.'
  }
  if (code === '23505' && ONE_SEAT_UNIQUE.test(error.message)) {
    return 'Ya tenés un lugar en este torneo.'
  }
  // 23503 (`foreign_key_violation`): algo que este cambio referencia dejó de
  // existir mientras se hacía. El caso medido por el gate es `add_squad_seat`
  // contra un `deleteSeason` concurrente, 60/60 — el alta rebota contra
  // `entries_season_id_fkey` porque la temporada se borró abajo. `removeSeat`
  // traduce SU 23503 (el asiento que ya jugó) antes de llamar acá, así que ese
  // caso no llega.
  if (code === '23503') {
    return 'Algo que este cambio necesita ya no existe: puede que alguien lo haya borrado mientras editabas. Recargá la pantalla.'
  }
  return error.message
}
