import { describe, expect, it } from 'vitest'
import { EdgeError } from '@/db/errors'
import { playersFrom, playersFromJson, slotsError, slotsFor } from './cargar-state'

const amigo = (playerId: string) => ({ kind: 'friend', playerId }) as const
const invitado = (name: string) => ({ kind: 'guest', name }) as const

describe('slotsFor', () => {
  it('1v1 tiene sólo un rival', () => {
    expect(slotsFor('1v1')).toEqual(['rival1'])
  })
  it('2v2 tiene compañero y dos rivales', () => {
    expect(slotsFor('2v2')).toEqual(['partner', 'rival1', 'rival2'])
  })
})

describe('slotsError', () => {
  it('avisa si falta alguien', () => {
    expect(slotsError('1v1', { rival1: null })).not.toBeNull()
    expect(slotsError('2v2', { partner: amigo('a'), rival1: amigo('b') })).not.toBeNull()
  })
  it('avisa si un invitado no tiene nombre', () => {
    expect(slotsError('1v1', { rival1: invitado('   ') })).not.toBeNull()
  })
  it('avisa si el mismo amigo está dos veces', () => {
    expect(slotsError('2v2', { partner: amigo('a'), rival1: amigo('a'), rival2: invitado('Beto') })).not.toBeNull()
  })
  it('acepta dos invitados con el mismo nombre de pila y amigos distintos', () => {
    expect(slotsError('2v2', { partner: amigo('a'), rival1: invitado('Beto'), rival2: amigo('b') })).toBeNull()
  })
  it('ignora lo que sobra del modo (rival2 en 1v1)', () => {
    expect(slotsError('1v1', { rival1: amigo('a'), rival2: null })).toBeNull()
  })
})

describe('playersFrom', () => {
  it('1v1: el rival va del lado theirs', () => {
    expect(playersFrom('1v1', { rival1: amigo('a'), rival2: amigo('x') })).toEqual([
      { side: 'theirs', playerId: 'a', guestName: null },
    ])
  })
  it('2v2: el compañero va del lado mine y los invitados van recortados', () => {
    expect(playersFrom('2v2', { partner: amigo('p'), rival1: invitado('  Beto '), rival2: amigo('r') })).toEqual([
      { side: 'mine', playerId: 'p', guestName: null },
      { side: 'theirs', playerId: null, guestName: 'Beto' },
      { side: 'theirs', playerId: 'r', guestName: null },
    ])
  })
})

describe('playersFromJson (borde de confianza)', () => {
  const ok = [{ side: 'theirs', playerId: 'a', guestName: null }]
  it('acepta un plantel bien formado', () => {
    expect(playersFromJson(JSON.stringify(ok))).toEqual(ok)
  })
  it('rechaza el mismo amigo repetido con un mensaje claro', () => {
    const raw = JSON.stringify([
      { side: 'mine', playerId: 'a', guestName: null },
      { side: 'theirs', playerId: 'a', guestName: null },
    ])
    expect(() => playersFromJson(raw)).toThrow('No podés elegir al mismo amigo dos veces.')
  })
  it.each([
    ['JSON roto', '{'],
    ['no es un array', '{"side":"mine"}'],
    ['array vacío', '[]'],
    ['lado inválido', '[{"side":"C","playerId":"a","guestName":null}]'],
    ['id y nombre a la vez', '[{"side":"mine","playerId":"a","guestName":"x"}]'],
    ['ni id ni nombre', '[{"side":"mine","playerId":null,"guestName":null}]'],
    ['nombre en blanco', '[{"side":"mine","playerId":null,"guestName":"  "}]'],
    ['id que no es string', '[{"side":"mine","playerId":3,"guestName":null}]'],
    ['elemento que no es objeto', '[null]'],
  ])('rechaza %s', (_caso, raw) => {
    expect(() => playersFromJson(raw)).toThrow(EdgeError)
  })
})
