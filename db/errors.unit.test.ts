import { describe, expect, it } from 'vitest'
import { writeErrorMessage } from './errors'

/**
 * Las RPC del plantel (`add_squad_seat`, `promote_guest`, `remove_squad_seat`,
 * `claim_seat`) pasan el mensaje de error DERECHO a la pantalla, sin prefijo:
 * sus `raise` ya están escritos en castellano y para que los lea el admin.
 *
 * El problema es lo que NO es uno de esos `raise`. Las TRES primeras toman el
 * advisory lock por temporada (0081/0084/0086) — `claim_seat` no toma ninguno,
 * verificado contra `pg_proc.prosrc` — así que pueden esperar de verdad, y
 * cuando esa espera termina mal el mensaje lo escribe Postgres, en inglés.
 * Eso es lo que este traductor ataja.
 */
describe('writeErrorMessage', () => {
  it('traduce el deadlock, que Postgres reporta en inglés', () => {
    const message = writeErrorMessage({ code: '40P01', message: 'deadlock detected' })

    expect(message).not.toContain('deadlock')
    expect(message).toMatch(/al mismo tiempo/)
    expect(message).toMatch(/probá de nuevo/i)
  })

  it('traduce el lock timeout', () => {
    const message = writeErrorMessage({
      code: '55P03',
      message: 'canceling statement due to lock timeout',
    })

    expect(message).not.toContain('canceling statement')
    expect(message).toMatch(/probá de nuevo/i)
  })

  /*
   * Éste es el que de VERDAD llega, y no es el que el reporte de la deuda
   * nombraba. Medido contra PostgREST (rol `authenticated`, JWT firmado con el
   * secret local) con el advisory de la temporada retenido por otra sesión:
   * la llamada espera 8s y vuelve con
   *
   *   {"code":"57014","message":"canceling statement due to statement timeout"}
   *
   * no con 55P03. El porqué está en `db/errors.ts`, y NO es que el
   * `lock_timeout` se pierda al cambiar de rol: sobrevive. Es que en la sesión
   * real los dos presupuestos valen 8s y el reloj del `statement_timeout`
   * arranca antes. Con `lock_timeout` más corto, el que llega es 55P03 — por
   * eso los dos casos tienen su test y ninguno de los dos sobra.
   */
  it('traduce el statement timeout, que es el que PostgREST devuelve de verdad', () => {
    const message = writeErrorMessage({
      code: '57014',
      message: 'canceling statement due to statement timeout',
    })

    expect(message).not.toContain('canceling statement')
    expect(message).toMatch(/probá de nuevo/i)
  })

  /*
   * El 23505 sobre un índice de `seed_position`: una de las dos escrituras
   * pierde su lugar en el orden sin que nadie deadlockee, y sin traducir el
   * admin lee `duplicate key value violates unique constraint
   * "discipline_entries_seed"`.
   *
   * **Dónde llega de verdad**: el gate lo reproduce 60/60 en el par
   * `add_squad_seat ‖ addDiscipline`, pero instrumentando los dos corredores
   * por separado se ve que el 23505 cae SIEMPRE del lado de `addDiscipline`
   * —el bulk insert, que no es una RPC— y nunca del lado de la función. Por eso
   * la traducción se aplica también en `db/discipline.ts`. Por ESTA vía la
   * rama es alcanzable pero NO está medida; el detalle está en `SEED_UNIQUE`
   * (`db/errors.ts`).
   *
   * `addToDiscipline` (`db/discipline-entries.ts`) traduce el mismo choque,
   * pero con la polaridad inversa (lista negra) y un texto un poco distinto.
   */
  it('traduce el choque sobre el orden de una disciplina', () => {
    const message = writeErrorMessage({
      code: '23505',
      message: 'duplicate key value violates unique constraint "discipline_entries_seed"',
    })

    expect(message).not.toContain('duplicate key')
    expect(message).toMatch(/probá de nuevo/i)
  })

  it('traduce el choque sobre el orden de la temporada', () => {
    const message = writeErrorMessage({
      code: '23505',
      message: 'duplicate key value violates unique constraint "season_seed_order_seed"',
    })

    expect(message).not.toContain('duplicate key')
    expect(message).toMatch(/probá de nuevo/i)
  })

  /*
   * El otro 23505 que llega de verdad, y por otro camino: `claim_seat` chequea
   * "ya tenés un lugar" con un `if exists` que NO es atómico con su `update`,
   * así que dos reclamos concurrentes del MISMO jugador sobre asientos
   * distintos pasan los dos el chequeo y el segundo rebota contra
   * `entries_one_seat`. Reproducido contra la base.
   */
  it('traduce el choque de dos reclamos del mismo jugador', () => {
    const message = writeErrorMessage({
      code: '23505',
      message: 'duplicate key value violates unique constraint "entries_one_seat"',
    })

    expect(message).not.toContain('duplicate key')
    expect(message).toBe('Ya tenés un lugar en este torneo.')
  })

  /*
   * 23503: algo que el cambio referencia dejó de existir mientras se hacía. El
   * gate lo reproduce 60/60 en `add_squad_seat ‖ deleteSeason` — el alta rebota
   * contra `entries_season_id_fkey` porque la temporada se borró abajo. Es el
   * código que el gate reproduce MÁS veces de todos (120 iteraciones a N=60,
   * repartidas en dos pares), y no tenía traducción.
   */
  it('traduce la FK violada cuando algo se borró abajo', () => {
    const message = writeErrorMessage({
      code: '23503',
      message: 'insert or update on table "entries" violates foreign key constraint "entries_season_id_fkey"',
    })

    expect(message).not.toContain('foreign key')
    expect(message).toMatch(/ya no existe/i)
  })

  /*
   * Y NO traduce cualquier 23505: sobre la PRIMARY KEY la causa es otra
   * —"este jugador ya juega esta disciplina"—, donde "probá de nuevo" es
   * consejo equivocado. Es una lista BLANCA de índices conocidos, no un
   * `if (code === '23505')` a lo bruto.
   */
  it('NO traduce un 23505 sobre la primary key, que es otra causa', () => {
    const crudo = 'duplicate key value violates unique constraint "discipline_entries_pkey"'

    expect(writeErrorMessage({ code: '23505', message: crudo })).toBe(crudo)
  })

  // Lo que el traductor NO tiene que hacer: pisar los mensajes que ya
  // escribimos nosotros. Un `raise exception` de plpgsql llega con SQLSTATE
  // P0001 y su texto en castellano -- prefijarlo o reemplazarlo era el defecto
  // que `addSquadSeat` ya había documentado.
  it('deja pasar verbatim el raise de una de nuestras funciones', () => {
    const nuestro = 'Sólo quien organiza la temporada puede sacar un asiento.'

    expect(writeErrorMessage({ code: 'P0001', message: nuestro })).toBe(nuestro)
  })

  it('deja pasar el mensaje cuando no viene ningún code', () => {
    expect(writeErrorMessage({ message: 'Ese jugador no está en el plantel.' })).toBe(
      'Ese jugador no está en el plantel.',
    )
  })
})
