import { describe, expect, it, vi } from 'vitest'
import type { Client } from './client'
import { EdgeError } from './errors'
import {
  USERNAME_FORMAT_ERROR,
  chooseMyUsername,
  firstFreeUsername,
  myUsername,
  normalizeUsername,
  usernameAlternatives,
  usernameError,
  usernameStatus,
  usernameSuggestions,
} from './usuario'

/**
 * El @usuario del lado de la app (odd/tasks/amigos-faciles.md, S7): el formato,
 * las sugerencias sacadas del nombre y las dos libres cuando el que escribiste
 * ya está en uso. La regla de verdad vive en la base (0118-0122); esto es lo
 * que la pantalla dice antes de preguntarle.
 */

/** Un cliente que contesta `username_available` con la lista de tomados. */
function fakeClient(taken: readonly string[]) {
  const rpc = vi.fn(async (name: string, args: { p_username: string }) => {
    if (name !== 'username_available') throw new Error(`rpc inesperada: ${name}`)
    return { data: !taken.includes(args.p_username), error: null }
  })
  return { client: { rpc } as unknown as Client, rpc }
}

describe('normalizeUsername', () => {
  it('saca espacios y la @ de adelante, y pasa a minúsculas', () => {
    expect(normalizeUsername('  @Nico.Arias ')).toBe('nico.arias')
    expect(normalizeUsername('MartinPerez')).toBe('martinperez')
    expect(normalizeUsername('')).toBe('')
  })
})

describe('usernameError', () => {
  it('deja pasar de 3 a 20 letras, números, punto y guion bajo', () => {
    for (const bueno of ['abc', 'nico.arias', 'nico_arias', '9de.julio', 'a'.repeat(20), 'Nico.Arias']) {
      expect(usernameError(bueno), bueno).toBeNull()
    }
  })

  it('pide elegir uno si está vacío', () => {
    expect(usernameError('')).toBe('Elegí tu @usuario.')
    expect(usernameError('  @ ')).toBe('Elegí tu @usuario.')
  })

  it('rechaza el formato con un único mensaje', () => {
    expect(USERNAME_FORMAT_ERROR).toBe(
      'Usá de 3 a 20 letras, números, punto o guion bajo, empezando con una letra o un número.',
    )
    for (const malo of ['ab', 'a'.repeat(21), '.nico', '_nico', 'nico arias', 'niño', 'nico-arias']) {
      expect(usernameError(malo), malo).toBe(USERNAME_FORMAT_ERROR)
    }
  })
})

describe('usernameSuggestions', () => {
  it('del nombre: sin tildes, en minúsculas, con punto y todo junto', () => {
    expect(usernameSuggestions('Martín Pérez')).toEqual(['martin.perez', 'martinperez'])
    expect(usernameSuggestions('  Nico   Arias ')).toEqual(['nico.arias', 'nicoarias'])
  })

  it('una sola palabra da una sola sugerencia', () => {
    expect(usernameSuggestions('Juampi')).toEqual(['juampi'])
  })

  it('saca lo que no vale y no empieza con punto', () => {
    expect(usernameSuggestions('¡Facu! Gómez-Paz')).toEqual(['facu.gomezpaz', 'facugomezpaz'])
    expect(usernameSuggestions('Ñandú Peña')).toEqual(['nandu.pena', 'nandupena'])
  })

  it('corta en 20 sin dejar un punto colgando', () => {
    expect(usernameSuggestions('Maximiliano Fernández Rodríguez')).toEqual([
      'maximiliano.fernande',
      'maximilianofernandez',
    ])
    expect(usernameSuggestions('Juan Bautista Pérez')).toEqual(['juan.bautista.perez', 'juanbautistaperez'])
    expect(usernameSuggestions('Abcdefghijklmnopqrs Tu')).toEqual(['abcdefghijklmnopqrs', 'abcdefghijklmnopqrst'])
  })

  it('un nombre corto o sin letras igual da algo válido', () => {
    expect(usernameSuggestions('Al')).toEqual(['al.padel'])
    expect(usernameSuggestions('李')).toEqual(['jugador'])
    expect(usernameSuggestions('')).toEqual(['jugador'])
  })
})

describe('usernameAlternatives', () => {
  it('para uno en uso, primero con un número y después con "padel"', () => {
    expect(usernameAlternatives('nico.arias').slice(0, 2)).toEqual(['nico.arias2', 'nicoarias.padel'])
  })

  it('todas son válidas, distintas y ninguna es la tomada', () => {
    const alternativas = usernameAlternatives('maximiliano.fernande')
    expect(alternativas.length).toBeGreaterThanOrEqual(4)
    expect(new Set(alternativas).size).toBe(alternativas.length)
    for (const alternativa of alternativas) {
      expect(usernameError(alternativa), alternativa).toBeNull()
      expect(alternativa).not.toBe('maximiliano.fernande')
    }
    // Con 20 caracteres, el número le come la última letra.
    expect(alternativas[0]).toBe('maximiliano.fernand2')
  })
})

describe('usernameStatus', () => {
  it('vacío no pregunta nada', async () => {
    const { client, rpc } = fakeClient([])
    expect(await usernameStatus(client, '')).toEqual({ kind: 'vacio' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('un formato inválido no llega a la base', async () => {
    const { client, rpc } = fakeClient([])
    expect(await usernameStatus(client, 'ni')).toEqual({ kind: 'formato', message: USERNAME_FORMAT_ERROR })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('libre: "@martinperez está libre"', async () => {
    const { client } = fakeClient([])
    expect(await usernameStatus(client, '@MartinPerez')).toEqual({
      kind: 'libre',
      username: 'martinperez',
      message: '@martinperez está libre',
    })
  })

  it('en uso: "@nico.arias ya está en uso" y dos libres para elegir', async () => {
    const { client } = fakeClient(['nico.arias', 'nicoarias.padel'])
    expect(await usernameStatus(client, 'nico.arias')).toEqual({
      kind: 'en-uso',
      username: 'nico.arias',
      message: '@nico.arias ya está en uso',
      suggestions: ['nico.arias2', 'nico.arias3'],
    })
  })

  it('si la base falla, no inventa una respuesta', async () => {
    const client = { rpc: vi.fn(async () => ({ data: null, error: { message: 'se cayó' } })) } as unknown as Client
    await expect(usernameStatus(client, 'nico.arias')).rejects.toThrow(EdgeError)
  })
})

describe('firstFreeUsername', () => {
  it('la primera sugerencia del nombre que esté libre', async () => {
    expect(await firstFreeUsername(fakeClient([]).client, 'Martín Pérez')).toBe('martin.perez')
    expect(await firstFreeUsername(fakeClient(['martin.perez']).client, 'Martín Pérez')).toBe('martinperez')
    expect(
      await firstFreeUsername(fakeClient(['martin.perez', 'martinperez']).client, 'Martín Pérez'),
    ).toBe('martin.perez2')
  })

  it('si todas están tomadas, deja la primera para que la persona la cambie', async () => {
    const todas = [...usernameSuggestions('Juampi'), ...usernameAlternatives('juampi')]
    expect(await firstFreeUsername(fakeClient(todas).client, 'Juampi')).toBe('juampi')
  })
})

describe('chooseMyUsername y myUsername', () => {
  it('pasan el @usuario normalizado y devuelven lo de la base', async () => {
    const rpc = vi.fn(async (name: string) =>
      name === 'choose_my_username' ? { data: 'nico.arias', error: null } : { data: null, error: null },
    )
    const client = { rpc } as unknown as Client
    expect(await chooseMyUsername(client, ' @Nico.Arias')).toBe('nico.arias')
    expect(rpc).toHaveBeenCalledWith('choose_my_username', { p_username: 'nico.arias' })
    expect(await myUsername(client)).toBeNull()
  })

  it('el motivo de la base sale como EdgeError, tal cual', async () => {
    const client = {
      rpc: vi.fn(async () => ({ data: null, error: { message: 'Ese @usuario ya está en uso.' } })),
    } as unknown as Client
    await expect(chooseMyUsername(client, 'nico.arias')).rejects.toThrow(new EdgeError('Ese @usuario ya está en uso.'))
  })

  it('un formato inválido no llega a la base', async () => {
    const rpc = vi.fn()
    await expect(chooseMyUsername({ rpc } as unknown as Client, 'ni')).rejects.toThrow(
      new EdgeError(USERNAME_FORMAT_ERROR),
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('si no se puede leer el tuyo, lo dice', async () => {
    const client = { rpc: vi.fn(async () => ({ data: null, error: { message: 'x' } })) } as unknown as Client
    await expect(myUsername(client)).rejects.toThrow(new EdgeError('No se pudo leer tu @usuario.'))
  })
})
