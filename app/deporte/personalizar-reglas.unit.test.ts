import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { fichaSeed, type Modality, type SeasonConfig, type SideSize, type SportId } from '@/core'
import { BloquePartido, PersonalizarReglas } from './personalizar-reglas'
import {
  GROUP_COUNTS,
  formatoChoice,
  rulesErrors,
  rulesFromSeed,
  rulesHints,
  withFormatoChoice,
  withGroups,
  type DisciplineRules,
} from './personalizar-reglas-state'

const rulesOf = (kind: SportId, squad: number, modality: Modality) => rulesFromSeed(fichaSeed(kind, squad, modality))
const withConfig = (rules: DisciplineRules, patch: Partial<SeasonConfig>): DisciplineRules => ({
  ...rules,
  config: { ...rules.config, ...patch },
})

const PADEL = rulesOf('PADEL', 8, 'ROTAN')
const PING_PONG = rulesOf('PING_PONG', 6, 'INDIVIDUAL')

describe('rulesHints', () => {
  it('Pádel 8 que rotan: cada ayuda dice la consecuencia del número', () => {
    expect(rulesHints('PADEL', PADEL, 2)).toEqual({
      setsToWin: '1 = un solo set. 2 = al mejor de 3.',
      gamesPerSet: 'Con tie-break: el set termina en 4 justo.',
      formato: 'Con 8 jugadores: todos contra todos (6 partidos). Se puede cambiar al armar cada fecha.',
      points: 'Cuántos suma cada puesto de la fecha. Hay un puesto por pareja.',
      maxMatches: 'El máximo que entra en una tarde. Con 12 jugadores, todos contra todos son 15.',
      regularMatchdays: 'Sin contar el Masters.',
      countBestOf: 'Las 2 peores se descartan: podés faltar 2 veces.',
      masters: 'Los 4 mejores juegan una fecha extra que define el campeón.',
      tiebreak: 'Si empatan en puntos, gana el que iba mejor hace 3 fechas.',
    })
  })

  it('Ping pong 6 individual: gana por 2, un puesto por jugador y sin Masters', () => {
    expect(rulesHints('PING_PONG', PING_PONG, 1)).toEqual({
      setsToWin: '2 = al mejor de 3. 3 = al mejor de 5.',
      gamesPerSet: 'Se gana por 2: 11-9, 12-10…',
      // 6 jugadores de a uno son 6 lados: AUTO ya reparte en 2 grupos (6 de grupo + 4 de llave).
      formato: 'Con 6 jugadores: 2 grupos + llave (10 partidos). Se puede cambiar al armar cada fecha.',
      points: 'Cuántos suma cada puesto de la fecha. Hay un puesto por jugador.',
      maxMatches:
        'De a uno cada presente es su propio lado, así que los partidos crecen rápido: con 12 son 66 todos contra todos.',
      regularMatchdays: 'Sin Masters: en individual no hay.',
      countBestOf: 'Las 2 peores se descartan: podés faltar 2 veces.',
      masters: 'Los 4 mejores juegan una fecha extra que define el campeón.',
      tiebreak: 'Si empatan en puntos, gana el que iba mejor hace 3 fechas.',
    })
  })

  it('sin Masters en una modalidad de a dos, la fecha lo avisa corto', () => {
    expect(rulesHints('PADEL', { ...PADEL, hasMasters: false }, 2).regularMatchdays).toBe('Sin Masters.')
  })

  it('cuentan las mejores: todas, una sola peor o varias', () => {
    const hint = (countBestOf: number) => rulesHints('PADEL', withConfig(PADEL, { countBestOf }), 2).countBestOf
    expect(hint(10)).toBe('Cuentan todas: faltar resta.')
    expect(hint(9)).toBe('La peor se descarta: podés faltar 1 vez.')
    expect(hint(7)).toBe('Las 3 peores se descartan: podés faltar 3 veces.')
  })

  it('sets para ganar: el tope del deporte corta la segunda frase', () => {
    const hint = (setsToWin: number) =>
      rulesHints('PING_PONG', withConfig(PING_PONG, { matchFormat: { ...PING_PONG.config.matchFormat, setsToWin } }), 1)
        .setsToWin
    expect(hint(4)).toBe('4 = al mejor de 7.')
    expect(hint(1)).toBe('1 = un solo set. 2 = al mejor de 3.')
  })

  it('games por set: sin tie-break se gana por 2 desde el número elegido', () => {
    const format = { ...PADEL.config.matchFormat, tieBreak: false, gamesPerSet: 6 }
    expect(rulesHints('PADEL', withConfig(PADEL, { matchFormat: format }), 2).gamesPerSet).toBe(
      'Se gana por 2: 6-4, 7-5…',
    )
  })

  it('la fecha por default con grupos cuenta los partidos de grupos + llave, y uno solo en singular', () => {
    const groups = { ...PING_PONG, formatoDefault: { kind: 'GROUPS_KNOCKOUT', groups: 2, qualifiersPerGroup: 2 } } as const
    expect(rulesHints('PING_PONG', groups, 1).formato).toBe(
      'Con 6 jugadores: 2 grupos + llave (10 partidos). Se puede cambiar al armar cada fecha.',
    )
    const two = withConfig({ ...PING_PONG, formatoDefault: { kind: 'ROUND_ROBIN' } }, { squadSize: 2, points: [10, 6] })
    expect(rulesHints('PING_PONG', two, 1).formato).toBe(
      'Con 2 jugadores: todos contra todos (1 partido). Se puede cambiar al armar cada fecha.',
    )
  })
})

describe('formato por default de la fecha', () => {
  it('formatoChoice nombra la elección del botón', () => {
    expect(formatoChoice({ kind: 'AUTO' })).toBe('AUTO')
    expect(formatoChoice({ kind: 'ROUND_ROBIN' })).toBe('ROUND_ROBIN')
    expect(formatoChoice({ kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 })).toBe('GROUPS_KNOCKOUT')
  })

  it('elegir Grupos + llave arranca en 2 grupos', () => {
    expect(withFormatoChoice(PADEL, 'GROUPS_KNOCKOUT').formatoDefault).toEqual({
      kind: 'GROUPS_KNOCKOUT',
      groups: 2,
      qualifiersPerGroup: 2,
    })
  })

  it('volver a tocar la elección vigente no pisa los 4 grupos que ya había', () => {
    const four = { ...PADEL, formatoDefault: { kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 } } as const
    expect(withFormatoChoice(four, 'GROUPS_KNOCKOUT')).toBe(four)
  })

  it('se ofrecen 2 y 4 grupos, y elegir uno no toca nada más', () => {
    expect(GROUP_COUNTS).toEqual([2, 4])
    expect(withGroups(PADEL, 4)).toEqual({
      ...PADEL,
      formatoDefault: { kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 },
    })
  })

  it('cambiar de elección no toca nada más', () => {
    const next = withFormatoChoice(PADEL, 'ROUND_ROBIN')
    expect(next).toEqual({ ...PADEL, formatoDefault: { kind: 'ROUND_ROBIN' } })
  })
})

describe('rulesFromSeed y rulesErrors', () => {
  it('toma de la ficha sólo lo que la hoja edita', () => {
    const seed = fichaSeed('PADEL', 8, 'ROTAN')
    expect(rulesFromSeed(seed)).toEqual({
      config: seed.config,
      hasMasters: true,
      formatoDefault: { kind: 'AUTO' },
    })
  })

  it('las reglas de la ficha no tienen errores; contar más fechas de las que se juegan sí', () => {
    expect(rulesErrors(PADEL, 2)).toEqual([])
    expect(rulesErrors(withConfig(PADEL, { countBestOf: 11 }), 2)).toContain(
      'No pueden contar más fechas de las que se juegan.',
    )
  })
})

interface SheetProps {
  kind: SportId
  modality: Modality
  pairSize: SideSize
  rules: DisciplineRules
  ficha: DisciplineRules | null
  note: string | null
  pending: boolean
  error: string | null
}

function sheet(kind: SportId, squad: number, modality: Modality, override: Partial<SheetProps> = {}): string {
  const seed = fichaSeed(kind, squad, modality)
  const rules = rulesFromSeed(seed)
  return renderToStaticMarkup(
    createElement(PersonalizarReglas, {
      kind,
      modality,
      pairSize: seed.pairSize,
      rules,
      ficha: rules,
      note: null,
      pending: false,
      error: null,
      onChange: () => {},
      onDone: () => {},
      onClose: () => {},
      ...override,
    }),
  )
}

const stepperRows = (html: string) => html.match(/data-stepper="[A-Za-z]+"/g) ?? []
const listoTag = (html: string) => html.match(/<button[^>]*>Listo<\/button>/)?.[0] ?? ''
/** Los textos de los botones que dicen "elegido" (`aria-pressed="true"`), sin etiquetas. */
const pressed = (html: string) =>
  [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*>(.*?)<\/button>/g)].map((m) => (m[1] ?? '').replace(/<[^>]+>/g, ''))

describe('PersonalizarReglas', () => {
  it('es un diálogo modal con título, subtítulo y una cruz de 44px', () => {
    const html = sheet('PADEL', 8, 'ROTAN')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toMatch(/aria-labelledby="[^"]+"/)
    expect(html).toContain('Reglas de Pádel')
    expect(html).toContain('Parejas que rotan · 8 jugadores')
    expect(html).toMatch(/<button[^>]*aria-label="Cerrar"/)
  })

  it('Pádel que rotan: los dos steppers del partido, Masters y el reglamento vivo', () => {
    const html = sheet('PADEL', 8, 'ROTAN')
    expect(html).toContain('El partido')
    expect(html).toContain('La fecha')
    expect(html).toContain('La temporada')
    expect(html.match(/data-stepper="(setsToWin|gamesPerSet)"/g)).toHaveLength(2)
    expect(html).toContain('Masters al final')
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/)
    expect(html).toContain('Así queda:')
    expect(html).toContain('Partidos a 1 set de 4 games.')
    expect(html).toContain('Volver a las reglas de Pádel')
  })

  it('"Así queda" no repite la modalidad, que ya está en el subtítulo', () => {
    expect(sheet('PADEL', 8, 'ROTAN')).not.toContain('La primera fecha se arma')
  })

  it('Ping pong individual: un solo stepper de partido, el 11 fijo y sin Masters', () => {
    const html = sheet('PING_PONG', 6, 'INDIVIDUAL')
    expect(html.match(/data-stepper="(setsToWin|gamesPerSet)"/g)).toHaveLength(1)
    expect(html).toContain('data-stepper="setsToWin"')
    expect(html).toMatch(/data-fixed="gamesPerSet"[^>]*>.*?<span[^>]*>11<\/span>/)
    expect(html).toContain('Puntos por set')
    expect(html).not.toContain('Masters al final')
    expect(html).not.toContain('role="switch"')
    expect(html).toContain('Sin Masters: en individual no hay.')
  })

  it('FIFA: el partido es a goles, así que no hay bloque "El partido"', () => {
    const html = sheet('FIFA', 6, 'INDIVIDUAL')
    expect(html).not.toContain('El partido')
    expect(html).toContain('La fecha')
    expect(html).toContain('La temporada')
  })

  it('Cómo se arma: tres botones /rapido en un grupo con título; Automático viene elegido', () => {
    const html = sheet('PADEL', 8, 'ROTAN')
    expect(html).toMatch(/role="group"[^>]*aria-labelledby="[^"]+"/)
    expect(html).toContain('según cuántos vengan')
    expect(html).toContain('Todos contra todos')
    expect(html).toContain('Grupos + llave')
    expect(pressed(html).some((text) => text.startsWith('Automático'))).toBe(true)
    expect(html).not.toContain('4 grupos')
  })

  it('con Grupos + llave aparece el segundo renglón de 2 o 4 grupos', () => {
    const rules = { ...PADEL, formatoDefault: { kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 } } as const
    const html = sheet('PADEL', 8, 'ROTAN', { rules })
    expect(html).toContain('2 grupos')
    expect(html).toContain('4 grupos')
    expect(pressed(html)).toContain('4 grupos')
    expect(pressed(html)).toContain('Grupos + llave')
  })

  it('Puntos por posición: un mosaico por puesto y el primero elegido', () => {
    const html = sheet('PADEL', 8, 'ROTAN')
    expect(html.match(/data-tile="\d+"/g)).toHaveLength(4)
    expect(html).toContain('grid grid-cols-4 gap-2')
    expect(pressed(html).some((text) => text.startsWith('10') && text.endsWith('1°'))).toBe(true)
  })

  it('cada mosaico se anuncia con su puesto y su valor, "1 punto" en singular', () => {
    const html = sheet('PING_PONG', 6, 'INDIVIDUAL')
    expect(html).toContain('aria-label="1° puesto: 10 puntos"')
    expect(html).toContain('aria-label="6° puesto: 1 punto"')
  })

  it('la temporada: fechas, cuentan las mejores, desempate y partidos por fecha, cada uno con su stepper', () => {
    const html = sheet('PADEL', 8, 'ROTAN')
    for (const key of ['maxMatches', 'regularMatchdays', 'countBestOf', 'tiebreakSnapshotEvery']) {
      expect(html).toContain(`data-stepper="${key}"`)
    }
    expect(html).toContain('Desempate')
    expect(html).toContain('Cuentan las mejores')
    expect(html).toContain('Partidos por fecha')
  })

  it('sin ficha no hay a qué volver', () => {
    expect(sheet('PADEL', 8, 'ROTAN', { ficha: null })).not.toContain('Volver a las reglas')
  })

  it('contar más fechas de las que se juegan avisa y traba "Listo"', () => {
    const rules = withConfig(PADEL, { countBestOf: 11 })
    const html = sheet('PADEL', 8, 'ROTAN', { rules })
    expect(html).toContain('No pueden contar más fechas de las que se juegan.')
    expect(listoTag(html)).toContain('disabled=""')
  })

  it('con las reglas bien, "Listo" está habilitado; con un guardado en curso, no', () => {
    expect(listoTag(sheet('PADEL', 8, 'ROTAN'))).not.toContain('disabled=""')
    expect(listoTag(sheet('PADEL', 8, 'ROTAN', { pending: true }))).toContain('disabled=""')
  })

  it('un guardado en curso traba también los controles', () => {
    expect(sheet('PADEL', 8, 'ROTAN', { pending: true })).toContain('<fieldset disabled=""')
  })

  it('lo que traba el fieldset se ve trabado: botones de elección, mosaicos y el switch', () => {
    const html = sheet('PADEL', 8, 'ROTAN', { pending: true })
    const tags = [...html.matchAll(/<button[^>]*(?:aria-pressed|role="switch")[^>]*>/g)].map((m) => m[0])
    expect(tags.length).toBeGreaterThan(4)
    for (const tag of tags) expect(tag).toContain('disabled:opacity-40')
  })

  it('muestra el aviso de Ajustes junto a "Listo" y el error del servidor', () => {
    const html = sheet('PADEL', 8, 'ROTAN', { note: 'Los cambios valen desde la próxima fecha.', error: 'No se pudo guardar.' })
    expect(html).toContain('Los cambios valen desde la próxima fecha.')
    expect(html).toContain('No se pudo guardar.')
  })
})

describe('BloquePartido', () => {
  const render = (kind: string, format: SeasonConfig['matchFormat'], disabled = false) =>
    renderToStaticMarkup(createElement(BloquePartido, { kind, format, disabled, onChange: () => {} }))

  it('un deporte de sets dibuja un stepper por eje que se puede tocar', () => {
    const html = render('PADEL', PADEL.config.matchFormat)
    expect(html).toContain('Sets para ganar')
    expect(html).toContain('Games por set')
    expect(html).toContain('1 = un solo set. 2 = al mejor de 3.')
  })

  it('goles, marcador abierto o un deporte fuera del registro: no se dibuja', () => {
    expect(render('FIFA', fichaSeed('FIFA', 6, 'INDIVIDUAL').config.matchFormat)).toBe('')
    expect(render('PADEL', { ...PADEL.config.matchFormat, openScore: true })).toBe('')
    expect(render('CRICKET', PADEL.config.matchFormat)).toBe('')
  })

  it('disabled traba los steppers', () => {
    expect(render('PADEL', PADEL.config.matchFormat, true)).toContain('<fieldset disabled=""')
    expect(render('PADEL', PADEL.config.matchFormat)).not.toContain('<fieldset disabled=""')
  })
})
