import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
} from '@/core/input-limits'

export const MIN_PASSWORD = 6
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Validación de los campos del registro y del login, pura y aparte de las
 * server actions.
 *
 * No es sólo prolijidad: las actions terminan en `redirect()` y hablan con
 * `serverClient()`, así que no se pueden testear directo. Sacar la validación
 * acá deja que el límite de longitud —el fix de seguridad— se pruebe solo, y
 * que la action se limite a traducir el error a `FormState`.
 */

/** El mensaje de error del registro, o `null` si está todo bien. */
export function signUpError(displayName: string, email: string, password: string): string | null {
  if (displayName.length === 0) return 'Escribí tu nombre.'
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return `Tu nombre no puede pasar de ${MAX_DISPLAY_NAME_LENGTH} caracteres.`
  }
  if (email.length === 0 || !EMAIL.test(email)) return 'Escribí un mail válido, con @ y dominio.'
  if (email.length > MAX_EMAIL_LENGTH) return 'Escribí un mail válido, con @ y dominio.'
  if (password.length < MIN_PASSWORD) return `Mínimo ${MIN_PASSWORD} caracteres.`
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `La contraseña no puede pasar de ${MAX_PASSWORD_LENGTH} caracteres.`
  }
  return null
}

/**
 * El login no valida formato (lo deja a Supabase, y un mensaje distinto filtraría
 * qué mails existen). Acá sólo se frena el tamaño: un mail o contraseña gigante
 * no tiene que llegar a GoTrue. Mismo mensaje genérico para no revelar nada.
 */
export function signInError(email: string, password: string): string | null {
  if (email.length > MAX_EMAIL_LENGTH) return 'Mail o contraseña incorrectos.'
  if (password.length > MAX_PASSWORD_LENGTH) return 'Mail o contraseña incorrectos.'
  return null
}
