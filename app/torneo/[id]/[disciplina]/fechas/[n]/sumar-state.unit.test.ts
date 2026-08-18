import { describe, expect, it } from 'vitest'
import { pair, single } from '@/core'
import { guestsToPromote, type GuestPromotionInput } from './sumar-state'

const nombres = new Map([
  ['ana', 'Ana'],
  ['beto', 'Beto'],
  ['cami', 'Cami'],
  ['invi', 'Invitado'],
  ['invi2', 'Otro invitado'],
])

function fecha(partial: Partial<GuestPromotionInput> = {}): GuestPromotionInput {
  return {
    guestIds: ['invi'],
    sides: [],
    frozenPoints: new Map<string, number>(),
    nameOf: nombres,
    ...partial,
  }
}

describe('guestsToPromote', () => {
  it('ofrece el botón con los puntos congelados de su compañero', () => {
    const [invitado] = guestsToPromote(
      fecha({
        sides: [pair('ana', 'invi')],
        frozenPoints: new Map([['ana', 5]]),
      }),
    )

    expect(invitado).toEqual({
      entryId: 'invi',
      name: 'Invitado',
      estado: 'PUEDE',
      partnerPoints: 5,
    })
  })

  it('refusa al que jugó en una pareja que no cobró', () => {
    const [invitado] = guestsToPromote(
      fecha({
        guestIds: ['invi', 'invi2'],
        sides: [pair('invi', 'invi2')],
        frozenPoints: new Map([['ana', 5]]),
      }),
    )

    expect(invitado?.estado).toBe('PAREJA_INVITADA')
  })

  it('refusa al que nunca quedó en una pareja de la fecha', () => {
    const [invitado] = guestsToPromote(
      fecha({
        sides: [pair('ana', 'beto')],
        frozenPoints: new Map([['ana', 5]]),
      }),
    )

    expect(invitado?.estado).toBe('SIN_PAREJA')
  })

  /**
   * El test que existe por el bug que ya ocurrió una vez.
   *
   * El cuantificador tiene que ser el mismo `every` que decide la base
   * (`0014_promote_guest.sql`: refusa si EXISTE una pareja suya cuyo compañero
   * no tenga award). Si mirara sólo la primera pareja —un `some` disfrazado, que
   * es lo que había—, esto mostraría el botón con los puntos del compañero que
   * cobró y rebotaría al mandarlo: el "botón que siempre rebota" que la pantalla
   * dice haber sacado.
   *
   * Los dos órdenes a propósito: mirar sólo la primera pareja acierta por
   * casualidad cuando la que no cobró viene primera, así que un solo orden no
   * mata la mutación.
   */
  it('refusa al que tiene dos parejas y sólo una cobró, en cualquier orden', () => {
    const frozenPoints = new Map([['ana', 5]])

    const [cobraPrimero] = guestsToPromote(
      fecha({
        sides: [
          pair('ana', 'invi'),
          pair('invi', 'invi2'),
        ],
        frozenPoints,
      }),
    )
    const [cobraSegundo] = guestsToPromote(
      fecha({
        sides: [
          pair('invi', 'invi2'),
          pair('ana', 'invi'),
        ],
        frozenPoints,
      }),
    )

    expect(cobraPrimero?.estado).toBe('PAREJA_INVITADA')
    expect(cobraSegundo?.estado).toBe('PAREJA_INVITADA')
  })

  /**
   * El único caso donde "promete los puntos de la PRIMERA" quiere decir algo:
   * dos parejas y las DOS cobraron. Sin este test, cambiar `partnersPoints[0]`
   * por el último elemento deja toda la suite en verde y el comentario de
   * `sumar-state.ts` pasa a describir algo que el código ya no hace.
   *
   * Que el escenario no sea alcanzable hoy no lo hace innecesario: la base
   * refusa esta promoción por el `unique` de `awards` y `generatePairs` borra
   * las parejas de la fecha antes de insertar, pero justamente por eso nadie
   * más va a notar la deriva. Lo que se fija es el copy que ve el admin, no la
   * decisión de promover — el estado sigue siendo `PUEDE` y el error se ve al
   * mandar.
   */
  it('con dos parejas que cobraron distinto, promete los puntos de la primera', () => {
    const pairs = [
      pair('ana', 'invi'),
      pair('invi', 'beto'),
    ]
    const frozenPoints = new Map([
      ['ana', 5],
      ['beto', 9],
    ])

    const [invitado] = guestsToPromote(fecha({ sides: pairs, frozenPoints }))
    // Y al revés, para que la aserción no acierte por simetría de los valores.
    const [alReves] = guestsToPromote(fecha({ sides: [...pairs].reverse(), frozenPoints }))

    expect(invitado).toEqual({
      entryId: 'invi',
      name: 'Invitado',
      estado: 'PUEDE',
      partnerPoints: 5,
    })
    expect(alReves?.estado).toBe('PUEDE')
    expect(alReves).toHaveProperty('partnerPoints', 9)
  })

  /**
   * `0010_points_can_be_zero.sql` hace legal `points = 0`, así que un award de 0
   * es un award y no una ausencia: el chequeo va contra `undefined` y nunca
   * contra la falsedad del número. Con `!points` esto daría `PAREJA_INVITADA` y
   * el invitado perdería un ascenso que la base sí acepta.
   */
  it('trata un award de 0 puntos como award, no como ausencia', () => {
    const [invitado] = guestsToPromote(
      fecha({
        sides: [pair('ana', 'invi')],
        frozenPoints: new Map([['ana', 0]]),
      }),
    )

    expect(invitado).toEqual({
      entryId: 'invi',
      name: 'Invitado',
      estado: 'PUEDE',
      partnerPoints: 0,
    })
  })

  it('clasifica a cada invitado de la fecha por su cuenta', () => {
    const estados = guestsToPromote(
      fecha({
        guestIds: ['invi', 'invi2'],
        sides: [
          pair('ana', 'invi'),
          pair('beto', 'cami'),
        ],
        frozenPoints: new Map([
          ['ana', 3],
          ['beto', 5],
          ['cami', 5],
        ]),
      }),
    ).map((guest) => guest.estado)

    expect(estados).toEqual(['PUEDE', 'SIN_PAREJA'])
  })

  it('sin invitados no devuelve nada', () => {
    expect(guestsToPromote(fecha({ guestIds: [] }))).toEqual([])
  })
})

/**
 * PR18b: en una disciplina de a uno el invitado ES su propio lado. No hay
 * compañero de quien copiar puntos, y `promote_guest` HOY lo rechaza — su
 * guard de "¿el compañero cobró?" da TRUE con `entry_b` nulo, misma lógica de
 * tres valores que C17 (W35, verify-report ronda 10). Ofrecer el botón ahí
 * sería el rebote garantizado que esta pantalla existe para no ofrecer.
 *
 * PR18c (slice D re-especificada) es la que hace que la base acepte esa
 * promoción; cuando aterrice, estos dos tests son los que cambian.
 */
describe('guestsToPromote con lados de uno (pair_size=1)', () => {
  it('no ofrece la tarjeta al invitado que jugó solo', () => {
    const promovibles = guestsToPromote(
      fecha({ sides: [single('invi'), single('ana')], frozenPoints: new Map([['ana', 5]]) }),
    )
    expect(promovibles).toEqual([])
  })

  it('el que jugó solo no tapa al que sí tiene compañero en un torneo mixto', () => {
    const promovibles = guestsToPromote(
      fecha({
        guestIds: ['invi', 'invi2'],
        sides: [single('invi'), pair('ana', 'invi2')],
        frozenPoints: new Map([['ana', 7]]),
      }),
    )
    expect(promovibles).toEqual([
      { entryId: 'invi2', name: 'Otro invitado', estado: 'PUEDE', partnerPoints: 7 },
    ])
  })
})
