import { describe, expect, it } from 'vitest'
import { rpcErrorMessage } from './errors'

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
describe('rpcErrorMessage', () => {
  it('traduce el deadlock, que Postgres reporta en inglés', () => {
    const message = rpcErrorMessage({ code: '40P01', message: 'deadlock detected' })

    expect(message).not.toContain('deadlock')
    expect(message).toMatch(/al mismo tiempo/)
    expect(message).toMatch(/probá de nuevo/i)
  })

  it('traduce el lock timeout', () => {
    const message = rpcErrorMessage({
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
    const message = rpcErrorMessage({
      code: '57014',
      message: 'canceling statement due to statement timeout',
    })

    expect(message).not.toContain('canceling statement')
    expect(message).toMatch(/probá de nuevo/i)
  })

  /*
   * El 23505 sobre un índice de `seed_position` es el código que el gate
   * reproduce con MÁS frecuencia de todos: `add_squad_seat ‖ addDiscipline` da
   * 60/60 (`npm run test:deadlock`). No deadlockea —nadie espera a nadie— pero
   * una de las dos escrituras se pierde, y sin traducir el admin lee
   * `duplicate key value violates unique constraint "discipline_entries_seed"`.
   *
   * `addToDiscipline` (`db/discipline-entries.ts`) ya traduce exactamente este
   * caso; acá se reusa el mismo criterio y el mismo mensaje.
   */
  it('traduce el choque sobre el orden de una disciplina', () => {
    const message = rpcErrorMessage({
      code: '23505',
      message: 'duplicate key value violates unique constraint "discipline_entries_seed"',
    })

    expect(message).not.toContain('duplicate key')
    expect(message).toMatch(/probá de nuevo/i)
  })

  it('traduce el choque sobre el orden de la temporada', () => {
    const message = rpcErrorMessage({
      code: '23505',
      message: 'duplicate key value violates unique constraint "season_seed_order_seed"',
    })

    expect(message).not.toContain('duplicate key')
    expect(message).toMatch(/probá de nuevo/i)
  })

  /*
   * Y NO traduce cualquier 23505: sobre la PRIMARY KEY la causa es otra
   * —"este jugador ya juega esta disciplina"—, donde "probá de nuevo" es
   * consejo equivocado. Mismo distingo por constraint que ya hace
   * `addToDiscipline`, no un `if (code === '23505')` a lo bruto.
   */
  it('NO traduce un 23505 sobre la primary key, que es otra causa', () => {
    const crudo = 'duplicate key value violates unique constraint "discipline_entries_pkey"'

    expect(rpcErrorMessage({ code: '23505', message: crudo })).toBe(crudo)
  })

  // Lo que el traductor NO tiene que hacer: pisar los mensajes que ya
  // escribimos nosotros. Un `raise exception` de plpgsql llega con SQLSTATE
  // P0001 y su texto en castellano -- prefijarlo o reemplazarlo era el defecto
  // que `addSquadSeat` ya había documentado.
  it('deja pasar verbatim el raise de una de nuestras funciones', () => {
    const nuestro = 'Sólo quien organiza la temporada puede sacar un asiento.'

    expect(rpcErrorMessage({ code: 'P0001', message: nuestro })).toBe(nuestro)
  })

  it('deja pasar el mensaje cuando no viene ningún code', () => {
    expect(rpcErrorMessage({ message: 'Ese jugador no está en el plantel.' })).toBe(
      'Ese jugador no está en el plantel.',
    )
  })
})
