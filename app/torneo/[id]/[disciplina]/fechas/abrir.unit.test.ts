import { describe, expect, it, vi, afterEach } from 'vitest'
import { today } from './abrir'

/**
 * `today()` arma el `YYYY-MM-DD` que pide `<input type="date">` con los
 * componentes LOCALES. Lo que este test defiende es que no vuelva a
 * `toISOString()`: con huso negativo —Argentina es UTC-3— eso devuelve AYER
 * durante las últimas tres horas de cada día.
 *
 * El otro lado del mismo problema (que el default lo calculara el SERVIDOR, en
 * UTC, y diera MAÑANA) se cierra con el `useEffect` de `AbrirFecha`, que corre
 * sólo en el navegador. Eso no se puede pinchar acá: `renderToStaticMarkup` no
 * ejecuta efectos, que es justamente por qué el bug existía.
 */
describe('today', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('devuelve el día LOCAL, no el de UTC', () => {
    // 2026-08-24 22:30 en Argentina (UTC-3) ya es el 25 en UTC.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-25T01:30:00.000Z'))
    const local = new Date()
    const esperado = `${local.getFullYear()}-${`${local.getMonth() + 1}`.padStart(2, '0')}-${`${local.getDate()}`.padStart(2, '0')}`

    expect(today()).toBe(esperado)
    // Y la red que importa: NO es el día de UTC salvo que la máquina esté en UTC.
    if (local.getTimezoneOffset() !== 0) {
      expect(today()).not.toBe(new Date().toISOString().slice(0, 10))
    }
  })

  it('rellena mes y día con cero a la izquierda', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 5, 12, 0, 0)) // 5 de enero, hora local
    expect(today()).toBe('2026-01-05')
  })
})
