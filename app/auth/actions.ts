'use server'

import { redirect } from 'next/navigation'
import type { Client } from '@/db/client'
import { mySeasons } from '@/db/read'
import { serverClient } from '@/db/server'
import { afterLogin } from './next-path'

export interface FormState {
  error: string | null
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MIN_PASSWORD = 6

/**
 * A dónde mandar a alguien que recién entró.
 *
 * Un `next` explícito —el link de invitación— gana siempre, así que se
 * revisa antes que nada. `LoginForm`/`RegistroForm` mandan el campo `next`
 * SIEMPRE con algo, nunca vacío: cuando no hay `?next=` en la URL, ellos
 * mismos lo normalizan con este mismo `safeNextPath` antes de ponerlo en el
 * input oculto, y esa normalización cae en `'/'`. Por eso no alcanza con
 * mirar si `next` vino vacío —acá SIEMPRE llega algo— hay que mirar si, ya
 * sanitizado, es distinto de `'/'`: un link de invitación real nunca apunta a
 * la raíz.
 *
 * Sin next real, todos van a Mis torneos. El Plan 3 tenía acá un caso especial
 * —con una sola temporada, directo a su tabla— porque no existía una pantalla
 * donde elegir. Ahora existe, y un camino distinto para el mismo destino sólo
 * es una rama más que puede quedar mal.
 */
async function loginDestination(_supabase: Client, next: string): Promise<string> {
  return afterLogin(next)
}

export async function signUp(_state: FormState, form: FormData): Promise<FormState> {
  const displayName = String(form.get('displayName') ?? '').trim()
  const email = String(form.get('email') ?? '').trim()
  const password = String(form.get('password') ?? '')

  if (displayName.length === 0) return { error: 'Escribí tu nombre.' }
  if (!EMAIL.test(email)) return { error: 'Escribí un mail válido, con @ y dominio.' }
  if (password.length < MIN_PASSWORD) return { error: `Mínimo ${MIN_PASSWORD} caracteres.` }

  const supabase = await serverClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  })
  if (error !== null) return { error: 'No pudimos crear la cuenta. Probá de nuevo.' }

  // Quien llega por un link de invitación tiene que volver a la invitación, no
  // a la home: si no, se registra y queda varado sin haber reclamado su lugar.
  redirect(await loginDestination(supabase, String(form.get('next') ?? '')))
}

export async function signIn(_state: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim()
  const password = String(form.get('password') ?? '')

  const supabase = await serverClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  // Un mensaje distinto para "no existe el mail" y para "la contraseña está
  // mal" le confirma a cualquiera qué mails están registrados. Uno solo.
  if (error !== null) return { error: 'Mail o contraseña incorrectos.' }

  redirect(await loginDestination(supabase, String(form.get('next') ?? '')))
}

export interface ResetState {
  error: string | null
  sent: boolean
}

/**
 * Manda el mail con el link para elegir una contraseña nueva.
 *
 * El "listo" es el mismo exista o no la cuenta: no se dice "ese mail no tiene
 * cuenta". No es un cierre completo y no pretende serlo —si el SMTP falla, o se
 * pide dos veces seguidas el mismo mail, sólo las cuentas reales dan error; y
 * con la confirmación de mail apagada el registro ya dice si un mail existe—.
 * Lo que sí se evita es fingir que el mail salió cuando no salió: deja a la
 * persona esperando un mail que no llega.
 */
export async function requestPasswordReset(_state: ResetState, form: FormData): Promise<ResetState> {
  const email = String(form.get('email') ?? '').trim()
  if (!EMAIL.test(email)) return { error: 'Escribí un mail válido, con @ y dominio.', sent: false }

  const supabase = await serverClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email)
  if (error?.status === 429) {
    return { error: 'Se pidieron muchos links seguidos. Esperá un rato y probá de nuevo.', sent: false }
  }
  if (error !== null) return { error: 'No pudimos mandar el mail. Probá de nuevo en un rato.', sent: false }
  return { error: null, sent: true }
}

/**
 * El botón de la página a la que lleva el link del mail (`app/auth/confirm`).
 * Recién acá se usa el token: abrir la página no lo gasta, así un escáner de
 * correo que abre el link antes que la persona no se lo vence.
 *
 * Se verifica con `token_hash` y no con el `code` de PKCE que usa el callback
 * de Google: el `code` sólo se canjea en el mismo navegador que pidió el mail,
 * y en el celular el mail se abre casi siempre en otro (la app de Gmail tiene
 * su navegador propio). El destino es fijo: nada del link decide a dónde va.
 */
export async function confirmRecovery(form: FormData): Promise<void> {
  const tokenHash = String(form.get('token_hash') ?? '')
  if (tokenHash === '') redirect('/login/recuperar?error=link')

  const supabase = await serverClient()
  const { error } = await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash })
  if (error !== null) redirect('/login/recuperar?error=link')

  redirect('/login/nueva-clave')
}

/**
 * Guarda la contraseña nueva con la sesión que dejó `confirmRecovery` y entra
 * directo.
 */
export async function setNewPassword(_state: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get('password') ?? '')
  if (password.length < MIN_PASSWORD) return { error: `Mínimo ${MIN_PASSWORD} caracteres.` }

  const supabase = await serverClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user === null) return { error: 'El link venció. Pedí uno nuevo.' }

  const { error } = await supabase.auth.updateUser({ password })
  if (error?.code === 'same_password') return { error: 'Tiene que ser distinta de la que tenías.' }
  if (error?.code === 'weak_password') return { error: 'Esa contraseña es muy fácil. Probá con una más larga.' }
  if (error !== null) return { error: 'No pudimos guardar la contraseña. Probá de nuevo.' }

  redirect(afterLogin(null))
}

export async function signOut(): Promise<void> {
  const supabase = await serverClient()
  await supabase.auth.signOut()
  redirect('/')
}
