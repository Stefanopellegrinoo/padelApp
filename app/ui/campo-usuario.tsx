'use client'

import { useEffect, useState } from 'react'
import { revisarUsuario } from '@/app/auth/usuario-actions'
import { etiqueta } from '@/app/login/campo'
import { chip } from '@/app/ui/chip'
import { USERNAME_RULE, normalizeUsername, usernameError, type UsernameStatus } from '@/db/usuario'

/** Cuánto esperar a que dejes de escribir antes de preguntar. */
const ESPERA_MS = 300

/**
 * Lo que dice el campo del valor de AHORA: el formato se contesta enseguida;
 * si está libre o en uso, cuando dejás de escribir (`revisarUsuario`). Una
 * respuesta que llega tarde, de algo que ya borraste, no se muestra. `null`
 * mientras no se sabe.
 */
export function useEstadoUsuario(value: string): UsernameStatus | null {
  const username = normalizeUsername(value)
  const [respuesta, setRespuesta] = useState<{ username: string; estado: UsernameStatus } | null>(null)

  useEffect(() => {
    if (username.length === 0 || usernameError(username) !== null) return
    let vigente = true
    const timer = setTimeout(() => {
      revisarUsuario(username)
        .then((estado) => {
          if (vigente && estado !== null) setRespuesta({ username, estado })
        })
        .catch(() => {})
    }, ESPERA_MS)
    return () => {
      vigente = false
      clearTimeout(timer)
    }
  }, [username])

  if (username.length === 0) return { kind: 'vacio' }
  const problem = usernameError(username)
  if (problem !== null) return { kind: 'formato', message: problem }
  return respuesta?.username === username ? respuesta.estado : null
}

/** Si con este estado se puede seguir: formato bien y no se sabe que esté en uso. */
export function usuarioUsable(value: string, estado: UsernameStatus | null): boolean {
  return usernameError(value) === null && estado?.kind !== 'en-uso'
}

/**
 * El campo @usuario del registro y de la pantalla única (lámina 07): la @ ya
 * puesta adelante, "está libre" o "ya está en uso" abajo, dos libres para
 * tocar cuando el tuyo está tomado y la regla, que avisa que no se cambia.
 * Escribe en minúsculas: así es como lo guarda la base.
 */
export function CampoUsuario({
  value,
  onChange,
  estado,
}: {
  value: string
  onChange: (value: string) => void
  estado: UsernameStatus | null
}) {
  const malo = estado?.kind === 'formato' || estado?.kind === 'en-uso'
  const bien = estado?.kind === 'libre'
  const mensaje = estado !== null && estado.kind !== 'vacio' ? estado.message : ''

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="username" className={etiqueta}>
        @usuario
      </label>
      <div
        className={`flex min-h-[52px] w-full items-center rounded-btn border-[1.5px] bg-surface-2 pr-1 pl-4 text-[16px] font-semibold text-text focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-focus focus-within:outline-solid ${
          malo ? 'border-live' : bien ? 'border-up' : 'border-muted/70'
        }`}
      >
        <span aria-hidden="true" className="mr-px font-bold text-muted">
          @
        </span>
        <input
          id="username"
          name="username"
          value={value}
          onChange={(event) => onChange(normalizeUsername(event.target.value))}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={20}
          aria-invalid={malo}
          aria-describedby="username-aviso username-regla"
          className="h-12 min-w-0 flex-1 bg-transparent outline-none [--color-focus:transparent]"
        />
      </div>
      <p
        id="username-aviso"
        aria-live="polite"
        className={`text-[14px] font-bold ${malo ? 'text-live' : 'text-up'}`}
      >
        {mensaje}
      </p>
      {estado?.kind === 'en-uso' && estado.suggestions.length > 0 && (
        <div role="group" aria-label="Libres para usar" className="flex flex-wrap items-center gap-2 text-[14px] text-muted">
          <span aria-hidden="true">Libres:</span>
          {estado.suggestions.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => onChange(suggestion)} className={chip('claro')}>
              @{suggestion}
            </button>
          ))}
        </div>
      )}
      <p id="username-regla" className="text-[14px] text-muted">
        {USERNAME_RULE}
      </p>
    </div>
  )
}
