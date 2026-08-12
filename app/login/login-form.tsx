'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useActionState, useState } from 'react'
import { signIn, type FormState } from '@/app/auth/actions'
import { safeNextPath } from '@/app/auth/next-path'
import { browserClient } from '@/db/client'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const INITIAL_STATE: FormState = { error: null }

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, INITIAL_STATE)
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
    <main className="flex min-h-dvh flex-col bg-bg px-6 pt-4 pb-[26px] text-text">
      <div className="flex items-center justify-between text-[12.5px]">
        <Link href="/" className="font-[750] text-muted">
          ← Volver
        </Link>
        <Link
          href={next === '/' ? '/registro' : `/registro?next=${encodeURIComponent(next)}`}
          className="font-[750] text-accent-link"
        >
          Crear cuenta
        </Link>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-[30px] font-extrabold tracking-[-.03em]">Entrá a tu cuenta</h1>
          <p className="text-[14px] font-[550] text-muted">
            Con el mail que usaste cuando entraste al torneo.
          </p>
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          className="rounded-field border-[1.5px] border-line p-4 text-[15px] font-extrabold"
        >
          Continuar con Google
        </button>
        {googleError && (
          <p className="text-[12px] font-bold text-live">No pudimos entrar con Google. Probá de nuevo.</p>
        )}
        <div className="flex items-center gap-3 text-[11.5px] font-[600] text-muted">
          <span className="h-px flex-1 bg-line" />
          o
          <span className="h-px flex-1 bg-line" />
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-[11.5px] font-extrabold text-muted">
              Mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={`rounded-field border-[1.5px] bg-surface p-[15px] text-[16px] font-bold text-text outline-none ${
                emailError === null ? 'border-line' : 'border-live'
              }`}
            />
            {emailError !== null && <p className="text-[12px] font-bold text-live">{emailError}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-[11.5px] font-extrabold text-muted">
              Contraseña
            </label>
            <div className="flex items-center rounded-field border-[1.5px] border-line bg-surface pr-[15px]">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="flex-1 bg-transparent p-[15px] text-[16px] font-bold text-text outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="text-[11.5px] font-extrabold text-muted"
              >
                {showPassword ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </div>

          <Link href="/login/recuperar" className="text-[12.5px] font-[750] text-accent-link">
            Olvidé mi contraseña
          </Link>

          {state.error !== null && <p className="text-[12px] font-bold text-live">{state.error}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-field bg-accent p-4 text-[15px] font-extrabold text-accent-text disabled:bg-chip disabled:text-muted"
          >
            Entrar
          </button>
        </form>
      </div>
    </main>
  )
}
