import { describe, expect, it } from 'vitest'
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
} from '@/core/input-limits'
import { MIN_PASSWORD, signInError, signUpError, signUpUsernameError } from './validate'

const VALID_NAME = 'Juan Pérez'
const VALID_EMAIL = 'juan@example.com'
const VALID_PASSWORD = 'una-clave-larga'

describe('signUpError', () => {
  it('deja pasar un registro válido', () => {
    expect(signUpError(VALID_NAME, VALID_EMAIL, VALID_PASSWORD)).toBeNull()
  })

  it('pide el nombre', () => {
    expect(signUpError('', VALID_EMAIL, VALID_PASSWORD)).toBe('Escribí tu nombre.')
  })

  it(`rechaza un nombre de más de ${MAX_DISPLAY_NAME_LENGTH} caracteres`, () => {
    const nombre = 'a'.repeat(MAX_DISPLAY_NAME_LENGTH + 1)
    expect(signUpError(nombre, VALID_EMAIL, VALID_PASSWORD)).toContain('no puede pasar')
    // El límite exacto sí pasa.
    expect(signUpError('a'.repeat(MAX_DISPLAY_NAME_LENGTH), VALID_EMAIL, VALID_PASSWORD)).toBeNull()
  })

  it('pide un mail válido', () => {
    expect(signUpError(VALID_NAME, 'no-es-un-mail', VALID_PASSWORD)).toBe(
      'Escribí un mail válido, con @ y dominio.',
    )
  })

  it(`rechaza un mail de más de ${MAX_EMAIL_LENGTH} caracteres`, () => {
    const local = 'a'.repeat(MAX_EMAIL_LENGTH)
    const email = `${local}@example.com`
    expect(signUpError(VALID_NAME, email, VALID_PASSWORD)).toBe(
      'Escribí un mail válido, con @ y dominio.',
    )
  })

  it('pide el mínimo de contraseña', () => {
    expect(signUpError(VALID_NAME, VALID_EMAIL, 'corta')).toBe(`Mínimo ${MIN_PASSWORD} caracteres.`)
  })

  it(`rechaza una contraseña de más de ${MAX_PASSWORD_LENGTH} caracteres`, () => {
    const clave = 'a'.repeat(MAX_PASSWORD_LENGTH + 1)
    expect(signUpError(VALID_NAME, VALID_EMAIL, clave)).toContain('no puede pasar')
    expect(signUpError(VALID_NAME, VALID_EMAIL, 'a'.repeat(MAX_PASSWORD_LENGTH))).toBeNull()
  })
})

// El @usuario del registro (odd/tasks/amigos-faciles.md, S7): el mismo formato que la base.
describe('signUpUsernameError', () => {
  it('deja pasar uno válido, con o sin la @ y en cualquier mayúscula', () => {
    expect(signUpUsernameError('martinperez')).toBeNull()
    expect(signUpUsernameError('@Nico.Arias')).toBeNull()
  })

  it('lo pide si falta', () => {
    expect(signUpUsernameError('')).toBe('Elegí tu @usuario.')
  })

  it('rechaza el formato con el mensaje de la base', () => {
    for (const malo of ['ab', 'a'.repeat(21), '.nico', 'nico arias', 'niño']) {
      expect(signUpUsernameError(malo), malo).toBe(
        'Usá de 3 a 20 letras, números, punto o guion bajo, empezando con una letra o un número.',
      )
    }
  })
})

describe('signInError', () => {
  it('deja pasar credenciales de tamaño normal', () => {
    expect(signInError(VALID_EMAIL, VALID_PASSWORD)).toBeNull()
  })

  // El login no valida formato (lo deja a Supabase para no filtrar qué mails
  // existen): acá sólo se frena el tamaño, con el mensaje genérico.
  it(`frena un mail gigante con el mensaje genérico`, () => {
    const email = `${'a'.repeat(MAX_EMAIL_LENGTH)}@example.com`
    expect(signInError(email, VALID_PASSWORD)).toBe('Mail o contraseña incorrectos.')
  })

  it(`frena una contraseña gigante con el mensaje genérico`, () => {
    expect(signInError(VALID_EMAIL, 'a'.repeat(MAX_PASSWORD_LENGTH + 1))).toBe(
      'Mail o contraseña incorrectos.',
    )
  })
})
