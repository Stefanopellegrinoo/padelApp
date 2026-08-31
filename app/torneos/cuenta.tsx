'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { initials } from '@/app/format'
import { signOut } from '@/app/auth/actions'
import { SubmitButton } from '@/app/submit-button'

/**
 * El círculo con la inicial, arriba a la derecha de Mis torneos, y su menú.
 *
 * Es el ÚNICO lugar de la app donde un jugador puede cerrar sesión. Antes
 * estaban los dos peores posibles: la landing `/`, que después de entrar no se
 * vuelve a ver, y Ajustes del torneo, que redirige a quien no es admin — o sea
 * que un jugador común no tenía ninguno. Mis torneos es la pantalla de entrada
 * y la única que está por encima de todos los torneos, así que la cuenta va acá.
 *
 * Cliente por el desplegable, y por nada más: la sesión la cierra `signOut`, que
 * es una Server Action.
 */
export function Cuenta({ name }: { name: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Tocar afuera y Escape cierran. Sin esto el menú queda abierto tapando la
  // lista y la única salida es elegir algo, que en un menú con "Cerrar sesión"
  // es la trampa exacta que hay que no tender.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name === '' ? 'Tu cuenta' : `Tu cuenta, ${name}`}
        onClick={() => setOpen(!open)}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-chip text-[13px] font-extrabold text-text"
      >
        {initials(name)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-[210px] overflow-hidden rounded-[14px] border border-line bg-surface"
        >
          {name !== '' && (
            <p className="truncate border-b border-line px-3 py-2.5 text-[12.5px] font-bold text-muted">
              {name}
            </p>
          )}
          <Link
            href="/amigos"
            role="menuitem"
            className="block w-full border-b border-line px-3 py-3 text-left text-[14px] font-[750] text-text"
          >
            Amigos
          </Link>
          <form action={signOut}>
            <SubmitButton
              role="menuitem"
              className="w-full px-3 py-3 text-left text-[14px] font-[750] text-live"
            >
              Cerrar sesión
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  )
}
