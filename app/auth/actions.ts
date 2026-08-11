'use server'

import { redirect } from 'next/navigation'
import { serverClient } from '@/db/server'
import { safeNextPath } from './next-path'

export interface FormState {
  error: string | null
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MIN_PASSWORD = 6

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
  redirect(safeNextPath(String(form.get('next') ?? '')))
}

export async function signIn(_state: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim()
  const password = String(form.get('password') ?? '')

  const supabase = await serverClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  // Un mensaje distinto para "no existe el mail" y para "la contraseña está
  // mal" le confirma a cualquiera qué mails están registrados. Uno solo.
  if (error !== null) return { error: 'Mail o contraseña incorrectos.' }

  redirect(safeNextPath(String(form.get('next') ?? '')))
}

export async function signOut(): Promise<void> {
  const supabase = await serverClient()
  await supabase.auth.signOut()
  redirect('/')
}
