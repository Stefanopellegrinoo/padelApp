'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useActionState, useState, useTransition } from 'react'
import { signIn, type FormState } from '@/app/auth/actions'
import { safeNextPath } from '@/app/auth/next-path'
import { browserClient } from '@/db/client'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'
import { CampoClave, IconoGoogle, Separador, campoClase, etiqueta, mensajeError } from './campo'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const INITIAL_STATE: FormState = { error: null }

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, INITIAL_STATE)
  const [googlePending, startGoogle] = useTransition()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const searchParams = useSearchParams()
  const googleError = searchParams.get('error') === 'google'
  const next = safeNextPath(searchParams.get('next'))

  const emailError =
    email.length > 0 && !EMAIL.test(email) ? 'Escribí un mail válido, con @ y dominio.' : null
  const canSubmit = EMAIL.test(email) && password.length > 0 && !pending

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
          title="Entrá a tu cuenta"
          subtitle="Con el mail que usaste cuando entraste al torneo."
        />
        <Link
          href={next === '/' ? '/registro' : `/registro?next=${encodeURIComponent(next)}`}
          className="press absolute top-[calc(1px+env(safe-area-inset-top))] right-3 flex min-h-[44px] items-center rounded-[12px] px-3 text-[16px] font-bold text-on-block [--color-focus:var(--color-on-block)] active:bg-white/15"
        >
          Crear cuenta
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
        {googleError && <p className={mensajeError}>No pudimos entrar con Google. Probá de nuevo.</p>}
        <Separador />

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
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
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              show={showPassword}
              onToggle={() => setShowPassword((value) => !value)}
            />
          </div>

          <Link
            href="/login/recuperar"
            className="-my-1 flex min-h-[44px] w-fit items-center text-[15px] font-bold text-accent-link"
          >
            Olvidé mi contraseña
          </Link>

          {state.error !== null && <p className={mensajeError}>{state.error}</p>}

          {/* `canSubmit` is overloaded: disabled means either "form not valid
              yet" or "submit in flight". The colour swap already reads as
              disabled on its own, so the global opacity dim only earns its
              keep while actually pending — otherwise it just washes out the
              first thing a new user sees on arrival. */}
          <button
            type="submit"
            disabled={!canSubmit}
            className={`${button('primary', { size: 'lg', full: true })} mt-1 disabled:bg-chip disabled:text-muted ${
              pending ? '' : 'disabled:opacity-100'
            }`}
          >
            Entrar
          </button>
        </form>
      </div>
    </main>
  )
}
