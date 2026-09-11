import { describe, expect, it } from 'vitest'
import { rpcErrorMessage } from './errors'

/**
 * Las RPC del plantel (`add_squad_seat`, `promote_guest`, `remove_squad_seat`,
 * `claim_seat`) pasan el mensaje de error DERECHO a la pantalla, sin prefijo:
 * sus `raise` ya están escritos en castellano y para que los lea el admin.
 *
 * El problema es lo que NO es uno de esos `raise`. Con el advisory lock por
 * temporada (0081/0084/0086) los cuatro caminos pueden esperar de verdad, y
 * cuando esa espera termina mal el mensaje lo escribe Postgres, en inglés:
 * `deadlock detected` (40P01) o `canceling statement due to lock timeout`
 * (55P03, con el `lock_timeout = 8s` que la sesión hereda del rol
 * `authenticator`). Eso es lo que este traductor ataja.
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
   * no con 55P03. El `lock_timeout = 8s` está en el rol `authenticator` (el de
   * login), no en `authenticated`, y el que gana es el `statement_timeout = 8s`
   * de `authenticated`. Dejar 57014 afuera era dejar afuera el único código
   * alcanzable por este camino.
   */
  it('traduce el statement timeout, que es el que PostgREST devuelve de verdad', () => {
    const message = rpcErrorMessage({
      code: '57014',
      message: 'canceling statement due to statement timeout',
    })

    expect(message).not.toContain('canceling statement')
    expect(message).toMatch(/probá de nuevo/i)
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
