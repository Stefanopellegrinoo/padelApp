import { describe, expect, it } from 'vitest'
import { fichaSeed, type DisciplineId } from '@/core'
import { rulesFromSeed } from '@/app/deporte/personalizar-reglas-state'
import { newSportOf, opcionesDeAlta } from './nuevo-deporte-state'

const entryIds = ['a', 'b', 'c', 'd', 'e']
const fifaRules = rulesFromSeed(fichaSeed('FIFA', entryIds.length, 'INDIVIDUAL'))
const padelRules = rulesFromSeed(fichaSeed('PADEL', 4, 'FIJAS'))

describe('opcionesDeAlta', () => {
  it('ofrece "Por nivel" (el orden del torneo), "Al azar" y un "Igual que" por cada deporte del torneo', () => {
    const options = opcionesDeAlta([
      { id: 'p1', kind: 'PADEL', slug: 'padel' },
      { id: 'f1', kind: 'FIFA', slug: 'fifa' },
    ])

    expect(options).toEqual([
      { value: 'NIVEL', label: 'Por nivel', sub: 'el orden del torneo' },
      { value: 'SORTEO', label: 'Al azar', sub: 'sorteo' },
      { value: { igualQue: 'p1' }, label: 'Igual que Pádel', sub: null },
      { value: { igualQue: 'f1' }, label: 'Igual que FIFA', sub: null },
    ])
  })

  it('dos del mismo deporte se distinguen por su slug', () => {
    const labels = opcionesDeAlta([
      { id: 'p1', kind: 'PADEL', slug: 'padel' },
      { id: 'p2', kind: 'PADEL', slug: 'padel-2' },
    ]).map((option) => option.label)

    expect(labels).toEqual(['Por nivel', 'Al azar', 'Igual que Pádel (padel)', 'Igual que Pádel (padel-2)'])
  })
})

describe('newSportOf', () => {
  const fifa = { kind: 'FIFA', modality: 'INDIVIDUAL', rules: fifaRules, entryIds } as const

  it('"Al azar": shuffle, y la primera fecha queda como sorteo', () => {
    const spec = newSportOf({ ...fifa, primeraFecha: 'SORTEO' })

    expect(spec).toMatchObject({ kind: 'FIFA', pairSize: 1, fixedTeams: false, allowsDraw: true, hasMasters: false, shuffle: true })
    expect(spec.config.firstFecha).toBe('SORTEO')
    expect(spec.sameOrderAs).toBeUndefined()
  })

  it('"Por nivel": ni sorteo ni copia, queda el orden del torneo', () => {
    const spec = newSportOf({ ...fifa, primeraFecha: 'NIVEL' })

    expect(spec.config.firstFecha).toBe('NIVEL')
    expect(spec.shuffle).toBeUndefined()
    expect(spec.sameOrderAs).toBeUndefined()
  })

  it('"Igual que": manda la disciplina y deja que la base copie cómo se armó su primera fecha', () => {
    const spec = newSportOf({ ...fifa, primeraFecha: { igualQue: 'p1' } })

    expect(spec.sameOrderAs).toBe('p1' as DisciplineId)
    expect(spec.shuffle).toBeUndefined()
    expect(spec.config.firstFecha).toBe(fifaRules.config.firstFecha)
  })

  it('la modalidad escribe los lados y las parejas fijas; el formato por default y las reglas pasan tal cual', () => {
    const spec = newSportOf({ kind: 'PADEL', modality: 'FIJAS', primeraFecha: 'SORTEO', rules: padelRules, entryIds: ['a', 'b', 'c', 'd'] })

    expect(spec).toMatchObject({ kind: 'PADEL', pairSize: 2, fixedTeams: true, allowsDraw: false, hasMasters: true })
    expect(spec.formatoDefault).toEqual({ kind: 'AUTO' })
    expect(spec.config.matchFormat).toEqual(padelRules.config.matchFormat)
  })

  it('de a uno nunca hay Masters, aunque las reglas lo traigan prendido', () => {
    const spec = newSportOf({ ...fifa, primeraFecha: 'SORTEO', rules: { ...fifaRules, hasMasters: true } })

    expect(spec.hasMasters).toBe(false)
  })
})
