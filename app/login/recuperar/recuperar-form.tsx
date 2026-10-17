'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useActionState, useState } from 'react'
import { requestPasswordReset, type ResetState } from '@/app/auth/actions'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const INITIAL_STATE: ResetState = { error: null, sent: false }

// Misma escala que Entrar (`login-form.tsx`): esta pantalla no está en el
// handoff y es su continuación directa.
export default function RecuperarForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, INITIAL_STATE)
  const [email, setEmail] = useState('')
  const linkExpired = useSearchParams().get('error') === 'link'

  const emailError =
    email.length > 0 && !EMAIL.test(email) ? 'Escribí un mail válido, con @ y dominio.' : null
  const canSubmit = EMAIL.test(email) && !pending

  return (
    <main className="flex min-h-dvh flex-col bg-bg px-6 pt-4 pb-[26px] text-text">
      <div className="flex items-center text-[12.5px]">
        <Link href="/login" className="font-[750] text-muted">
          ← Volver a entrar
        </Link>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-[30px] font-extrabold tracking-[-.03em]">Recuperar contraseña</h1>
          <p className="text-[14px] font-[550] text-muted">
            Te mandamos un link a tu mail para que elijas una nueva.
          </p>
        </div>

        {state.sent ? (
          // El mail que escribió va a la vista: si lo escribió mal, es acá
          // donde lo ve, y no esperando un mail que nunca llega.
          <p role="status" className="text-[14px] font-[550]">
            Listo. Si <strong className="font-extrabold">{email}</strong> tiene cuenta, te llega un link
            para elegir una contraseña nueva. Mirá también en spam.
          </p>
        ) : (
          <form action={formAction} className="flex flex-col gap-4">
            {linkExpired && (
              <p className="text-[12px] font-bold text-live">El link venció o ya se usó. Pedí uno nuevo.</p>
            )}

            <div className="flex flex-col gap-1">
              <label htmlFor="email" className="text-[11.5px] font-extrabold text-muted">
                Mail
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={`rounded-field border-[1.5px] bg-surface p-[15px] text-[16px] font-bold text-text outline-none ${
                  emailError === null ? 'border-line' : 'border-live'
                }`}
              />
              {emailError !== null && <p className="text-[12px] font-bold text-live">{emailError}</p>}
            </div>

            {state.error !== null && <p className="text-[12px] font-bold text-live">{state.error}</p>}

            <button
              type="submit"
              disabled={!canSubmit}
              className={`rounded-field bg-accent p-4 text-[15px] font-extrabold text-accent-text disabled:bg-chip disabled:text-muted ${
                pending ? '' : 'disabled:opacity-100'
              }`}
            >
              Mandarme el link
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
