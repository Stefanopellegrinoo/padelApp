'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { initials } from '@/app/format'
import { signOut } from '@/app/auth/actions'
import { SubmitButton } from '@/app/submit-button'

/**
 * El círculo con las iniciales, arriba a la derecha de Inicio (sobre el
 * bloque de color), y su menú.
 *
 * Es el ÚNICO lugar de la app donde un jugador puede cerrar sesión. Antes
 * estaban los dos peores posibles: la landing `/`, que después de entrar no se
 * vuelve a ver, y Ajustes del torneo, que redirige a quien no es admin — o sea
 * que un jugador común no tenía ninguno. Inicio es la pantalla de entrada y la
 * única que está por encima de todos los torneos, así que la cuenta va acá.
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

  // Las filas del menú: 48 de alto, texto de 16. El menú es una superficie
  // propia encima del bloque, así que el texto y el anillo de foco vuelven a
  // ser los de la pantalla y no el blanco del bloque.
  const item = 'flex min-h-[48px] w-full items-center border-t border-line first:border-t-0 px-4 text-left text-[16px] font-semibold'

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={name === '' ? 'Tu cuenta' : `Tu cuenta, ${name}`}
        onClick={() => setOpen(!open)}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-on-block text-[15px] font-[750] text-block dark:bg-white/15 dark:text-on-block"
      >
        {initials(name)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-[240px] overflow-hidden rounded-tile border-[1.5px] border-line bg-surface-2 text-text [--color-focus:var(--color-text)]"
        >
          {name !== '' && <p className="truncate px-4 pt-3 pb-2.5 text-[14px] font-semibold text-muted">{name}</p>}
          <Link href="/amigos" role="menuitem" className={`${item} press-fila`}>
            Amigos
          </Link>
          <Link href="/privacidad" role="menuitem" className={`${item} press-fila`}>
            Privacidad
          </Link>
          <Link href="/cuenta/borrar" role="menuitem" className={`${item} press-fila`}>
            Borrar cuenta
          </Link>
          <form action={signOut}>
            <SubmitButton role="menuitem" className={`${item} press-fila font-bold text-live`}>
              Cerrar sesión
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  )
}
