import { describe, expect, it } from 'vitest'
import { defaultConfig, fichaSeed } from './config'
import { desempateLine, fichaLine, reglamento, type ReglamentoInput } from './reglamento'
import type { Modality, SportId } from './sports'

const seeded = (kind: SportId, squadSize: number, modality: Modality): ReglamentoInput => {
  const { config, pairSize, fixedTeams, allowsDraw, hasMasters, formatoDefault } = fichaSeed(kind, squadSize, modality)
  return { kind, pairSize, fixedTeams, allowsDraw, hasMasters, formatoDefault, config }
}
const byKey = (input: ReglamentoInput) => Object.fromEntries(reglamento(input).map((line) => [line.key, line.text]))

describe('reglamento', () => {
  it('Pádel de hoy: el párrafo de §6 de la spec, en presente, línea por línea', () => {
    expect(reglamento(seeded('PADEL', 8, 'ROTAN'))).toEqual([
      { key: 'modalidad', text: 'Parejas que rotan. La primera fecha se arma por nivel; después, por la tabla.' },
      { key: 'partido', text: 'Partidos a 1 set de 4 games.' },
      { key: 'fecha', text: 'Cada fecha se arma sola, según cuántos vengan.' },
      { key: 'puntos', text: 'Gana 10, segundo 6, tercero 3, cuarto 1.' },
      { key: 'temporada', text: '10 fechas, cuentan las 8 mejores.' },
      { key: 'desempate', text: 'Si empatan en puntos, gana el que iba mejor hace 3 fechas.' },
      { key: 'masters', text: 'Masters al final con los 4 mejores.' },
    ])
  })

  it('Ping pong individual: sets que se ganan por 2, primera fecha al azar y sin Masters', () => {
    expect(reglamento(seeded('PING_PONG', 6, 'INDIVIDUAL'))).toEqual([
      { key: 'modalidad', text: 'Individual. La primera fecha se arma al azar; después, por la tabla.' },
      { key: 'partido', text: 'Partidos al mejor de 3 sets de 11 puntos, se gana por 2.' },
      { key: 'fecha', text: 'Cada fecha se arma sola, según cuántos vengan.' },
      { key: 'puntos', text: 'Gana 10, segundo 7, tercero 5, cuarto 3, quinto 2, sexto 1.' },
      { key: 'temporada', text: '10 fechas, cuentan las 8 mejores.' },
      { key: 'desempate', text: 'Si empatan en puntos, gana el que iba mejor hace 3 fechas.' },
    ])
  })

  it('FIFA individual de 8: goles con empate y la cola de ceros que no suma', () => {
    const lines = byKey(seeded('FIFA', 8, 'INDIVIDUAL'))
    expect(lines.partido).toBe('Partidos a goles; se puede empatar.')
    expect(lines.puntos).toBe('Gana 10, segundo 7, tercero 5, cuarto 3, quinto 2, sexto 1; del séptimo para abajo no suman.')
    expect(lines).not.toHaveProperty('masters')
  })

  it('goles sin empate dice que siempre hay un ganador', () => {
    const input = { ...seeded('FIFA', 8, 'INDIVIDUAL'), allowsDraw: false }
    expect(byKey(input).partido).toBe('Partidos a goles, siempre con un ganador.')
  })

  it('torneo existente: sin firstFecha no inventa cómo se armó la primera fecha y respeta su formato de fecha', () => {
    const lines = byKey({
      kind: 'PADEL',
      pairSize: 2,
      fixedTeams: false,
      hasMasters: true,
      allowsDraw: false,
      formatoDefault: { kind: 'ROUND_ROBIN' },
      config: defaultConfig(8),
    })
    expect(lines.modalidad).toBe('Parejas que rotan.')
    expect(lines.fecha).toBe('Cada fecha, todos contra todos.')
  })

  it('un deporte fuera del registro nunca tira: etiqueta genérica y games', () => {
    const lines = byKey({
      kind: 'TEJO',
      pairSize: 2,
      fixedTeams: true,
      hasMasters: false,
      allowsDraw: false,
      formatoDefault: { kind: 'AUTO' },
      config: defaultConfig(8),
    })
    expect(lines.modalidad).toBe('Parejas fijas.')
    expect(lines.partido).toBe('Partidos a 1 set de 4 games.')
  })

  it('la modalidad sale de la ficha del deporte: Ping pong fijas es "Dobles fijos"', () => {
    expect(byKey(seeded('PING_PONG', 8, 'FIJAS')).modalidad).toBe(
      'Dobles fijos. La primera fecha se arma al azar; después, por la tabla.',
    )
  })

  it('bordes de la temporada: cuentan todas y una sola fecha', () => {
    const base = seeded('PADEL', 8, 'ROTAN')
    const withSeason = (regularMatchdays: number, countBestOf: number) =>
      byKey({ ...base, config: { ...base.config, regularMatchdays, countBestOf } }).temporada
    expect(withSeason(10, 10)).toBe('10 fechas, cuentan todas.')
    expect(withSeason(1, 1)).toBe('1 fecha.')
  })

  it('el desempate de cada fecha se dice en singular y la fecha en grupos nombra los grupos', () => {
    const base = seeded('PADEL', 8, 'ROTAN')
    const lines = byKey({
      ...base,
      formatoDefault: { kind: 'GROUPS_KNOCKOUT', groups: 4, qualifiersPerGroup: 2 },
      config: { ...base.config, tiebreakSnapshotEvery: 1 },
    })
    expect(lines.fecha).toBe('Cada fecha, 4 grupos + llave.')
    expect(lines.desempate).toBe('Si empatan en puntos, gana el que iba mejor la fecha anterior.')
  })

  it('puntos: un solo puesto que suma, y ordinales más allá del décimo', () => {
    const base = seeded('PADEL', 8, 'ROTAN')
    const withPoints = (points: number[]) => byKey({ ...base, config: { ...base.config, points } }).puntos
    expect(withPoints([10, 0, 0])).toBe('Gana 10; del segundo para abajo no suman.')
    expect(withPoints([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])).toBe(
      'Gana 12, segundo 11, tercero 10, cuarto 9, quinto 8, sexto 7, séptimo 6, octavo 5, noveno 4, décimo 3, 11° 2, 12° 1.',
    )
  })
})

describe('desempateLine', () => {
  it('cada 1 es la fecha anterior; cada N, hace N fechas', () => {
    expect(desempateLine(1)).toBe('Si empatan en puntos, gana el que iba mejor la fecha anterior.')
    expect(desempateLine(3)).toBe('Si empatan en puntos, gana el que iba mejor hace 3 fechas.')
  })
})

describe('fichaLine', () => {
  it('la ficha en una línea: Pádel, Ping pong y FIFA', () => {
    expect(fichaLine(seeded('PADEL', 8, 'ROTAN'))).toBe(
      '1 set a 4 games · 10 fechas · cuentan las 8 mejores · Masters al final',
    )
    expect(fichaLine(seeded('PING_PONG', 6, 'INDIVIDUAL'))).toBe(
      'Mejor de 3 sets a 11 puntos · 10 fechas · cuentan las 8 mejores',
    )
    expect(fichaLine(seeded('FIFA', 8, 'INDIVIDUAL'))).toBe('A goles · 10 fechas · cuentan las 8 mejores')
  })

  it('bordes: cuentan todas, y una sola fecha no dice "1 fechas" ni cuáles cuentan', () => {
    const base = seeded('PADEL', 8, 'ROTAN')
    const withSeason = (regularMatchdays: number, countBestOf: number) =>
      fichaLine({ ...base, config: { ...base.config, regularMatchdays, countBestOf } })
    expect(withSeason(10, 10)).toBe('1 set a 4 games · 10 fechas · cuentan todas · Masters al final')
    expect(withSeason(1, 1)).toBe('1 set a 4 games · 1 fecha · Masters al final')
  })
})
