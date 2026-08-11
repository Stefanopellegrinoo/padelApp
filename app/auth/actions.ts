'use server'

import { redirect } from 'next/navigation'
import type { Client } from '@/db/client'
import { mySeasons } from '@/db/read'
import { serverClient } from '@/db/server'
import { safeNextPath } from './next-path'

export interface FormState {
  error: string | null
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MIN_PASSWORD = 6

/**
 * A dónde mandar a alguien que recién entró.
 *
 * Un `next` explícito —el link de invitación— gana siempre, así que se
 * revisa antes de tocar la base. `LoginForm`/`RegistroForm` mandan el campo
 * `next` SIEMPRE con algo, nunca vacío: cuando no hay `?next=` en la URL,
 * ellos mismos lo normalizan con este mismo `safeNextPath` antes de ponerlo
 * en el input oculto, y esa normalización cae en `'/'`. Por eso no alcanza
 * con mirar si `next` vino vacío — acá SIEMPRE llega algo — hay que mirar si,
 * ya sanitizado, es distinto de `'/'`: un link de invitación real nunca
 * apunta a la raíz, así que esta distinción no le saca nada al caso que tiene
 * que ganar siempre.
 *
 * Sin next real, el caso común de este MVP es una sola temporada: se va
 * directo a su tabla. Con más de una no hay todavía una pantalla propia para
 * elegir —"Mis torneos" es Plan 4—, así que se queda en la landing, que ahora
 * sabe mostrarse distinta a alguien logueado. Sin ninguna temporada, también
 * a la landing: no tiene torneo al que ir.
 */
async function loginDestination(supabase: Client, next: string): Promise<string> {
  const safeNext = safeNextPath(next)
  if (safeNext !== '/') return safeNext
  const seasons = await mySeasons(supabase)
  const [only, ...rest] = seasons
  return only !== undefined && rest.length === 0 ? `/torneo/${only.id}` : '/'
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

export async function signOut(): Promise<void> {
  const supabase = await serverClient()
  await supabase.auth.signOut()
  redirect('/')
}
