'use client'

import { useActionState, useState } from 'react'
import { setNewPassword, type FormState } from '@/app/auth/actions'

const MIN_PASSWORD = 6

const INITIAL_STATE: FormState = { error: null }

// Misma escala que Entrar y Crear cuenta: es el final del mismo recorrido.
export default function NuevaClaveForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(setNewPassword, INITIAL_STATE)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const passwordError =
    password.length > 0 && password.length < MIN_PASSWORD ? `Mínimo ${MIN_PASSWORD} caracteres.` : null
  const canSubmit = password.length >= MIN_PASSWORD && !pending

  return (
    <main className="flex min-h-dvh flex-col bg-bg px-6 pt-4 pb-[26px] text-text">
      <div className="flex flex-1 flex-col justify-center gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-[30px] font-extrabold tracking-[-.03em]">Elegí tu contraseña nueva</h1>
          {email !== '' && <p className="text-[14px] font-[550] text-muted">Para {email}.</p>}
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          {/* Para que el gestor de contraseñas guarde la clave nueva en la cuenta
              correcta: lo busca en un campo de usuario dentro del mismo form. */}
          <input type="email" autoComplete="username" value={email} readOnly hidden />
          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-[11.5px] font-extrabold text-muted">
              Contraseña nueva
            </label>
            <div
              className={`flex items-center rounded-field border-[1.5px] bg-surface pr-[15px] ${
                passwordError === null ? 'border-line' : 'border-live'
              }`}
            >
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
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
            {passwordError !== null && <p className="text-[12px] font-bold text-live">{passwordError}</p>}
          </div>

          {state.error !== null && <p className="text-[12px] font-bold text-live">{state.error}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            className={`rounded-field bg-accent p-4 text-[15px] font-extrabold text-accent-text disabled:bg-chip disabled:text-muted ${
              pending ? '' : 'disabled:opacity-100'
            }`}
          >
            Guardar y entrar
          </button>
        </form>
      </div>
    </main>
  )
}
