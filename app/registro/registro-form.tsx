'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useActionState, useState, useTransition } from 'react'
import { signUp, type FormState } from '@/app/auth/actions'
import { safeNextPath } from '@/app/auth/next-path'
import { browserClient } from '@/db/client'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'
import { CampoClave, IconoGoogle, Separador, campoClase, etiqueta, mensajeError } from '@/app/login/campo'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MIN_PASSWORD = 6

const INITIAL_STATE: FormState = { error: null }

export default function RegistroForm() {
  const [state, formAction, pending] = useActionState(signUp, INITIAL_STATE)
  const [googlePending, startGoogle] = useTransition()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const next = safeNextPath(useSearchParams().get('next'))

  const emailError =
    email.length > 0 && !EMAIL.test(email) ? 'Escribí un mail válido, con @ y dominio.' : null
  const passwordError =
    password.length > 0 && password.length < MIN_PASSWORD ? `Mínimo ${MIN_PASSWORD} caracteres.` : null
  const canSubmit =
    displayName.trim().length > 0 &&
    EMAIL.test(email) &&
    password.length >= MIN_PASSWORD &&
    !pending

  async function handleGoogle() {
    const supabase = browserClient()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-8 text-text">
      <div className="relative">
        <Hero
          back={{ href: '/', label: 'Inicio' }}
          title="Creá tu cuenta"
          subtitle="Sólo para poder volver a entrar desde otro teléfono. Nada más."
        />
        <Link
          href={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`}
          className="press absolute top-[calc(1px+env(safe-area-inset-top))] right-3 flex min-h-[44px] items-center rounded-[12px] px-3 text-[16px] font-bold text-on-block [--color-focus:var(--color-on-block)] active:bg-white/15"
        >
          Iniciar sesión
        </Link>
      </div>

      <div className="flex flex-col gap-5 px-4 pt-6">
        <button
          type="button"
          disabled={googlePending}
          onClick={() => startGoogle(handleGoogle)}
          className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-btn border-[1.5px] border-muted/70 px-5 text-[17px] font-bold"
        >
          <IconoGoogle />
          Continuar con Google
        </button>
        <Separador />

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="displayName" className={etiqueta}>
              Tu nombre
            </label>
            <input
              id="displayName"
              name="displayName"
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className={campoClase(false)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className={etiqueta}>
              Mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={campoClase(emailError !== null)}
            />
            {emailError !== null && <p className={mensajeError}>{emailError}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className={etiqueta}>
              Contraseña
            </label>
            <CampoClave
              id="password"
              name="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              show={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
              error={passwordError !== null}
            />
            {passwordError !== null && <p className={mensajeError}>{passwordError}</p>}
          </div>

          {state.error !== null && <p className={mensajeError}>{state.error}</p>}

          {/* Como en /login: gris mientras falta algo, y además atenuado sólo
              mientras se manda, para que el formulario vacío no amanezca lavado. */}
          <button
            type="submit"
            disabled={!canSubmit}
            className={`${button('primary', { size: 'lg', full: true })} mt-1 disabled:bg-chip disabled:text-muted ${
              pending ? '' : 'disabled:opacity-100'
            }`}
          >
            Crear cuenta
          </button>

          <p className="text-center text-[14px] text-muted">
            Al crear la cuenta aceptás la{' '}
            <Link href="/privacidad" className="font-bold text-accent-link underline">
              política de privacidad
            </Link>
            .
          </p>
        </form>
      </div>
    </main>
  )
}
