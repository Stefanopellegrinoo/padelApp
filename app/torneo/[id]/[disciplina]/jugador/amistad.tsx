'use client'

import Link from 'next/link'
import { useState, useTransition, type ReactNode } from 'react'
import { aceptarPedidoDe, agregarAmigo, deshacerPedido, rechazarPedidoDe } from '@/app/amigos/actions'
import { chip } from '@/app/ui/chip'
import { Toast } from '@/app/ui/toast'
import { amigosHref } from './amistad-texto'

/**
 * La amistad con la persona del perfil del torneo (odd/tasks/amigos-faciles.md,
 * S2, opción 1 de `design/amigos-faciles/01-perfil-del-torneo.html`). Dos
 * piezas porque viven en dos lugares del Hero: el chip arriba a la derecha y,
 * cuando el otro ya pidió, la tarjeta grande abajo del nombre.
 *
 * El estado NO es de acá: la página lo lee de la base y lo pasa. Cada acción
 * revalida el perfil y la página vuelve con el estado nuevo; lo único propio
 * es el aviso de abajo, que sobrevive a ese cambio porque el chip sigue
 * montado.
 */

/** Trazos de Lucide (ISC), los mismos de la maqueta. */
function Icono({ children, className = 'h-4 w-4' }: { children: ReactNode; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`${className} shrink-0 fill-none stroke-current stroke-[2.4] [stroke-linecap:round] [stroke-linejoin:round]`}
    >
      {children}
    </svg>
  )
}

const PERSONA = (
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
  </>
)

export function ChipAmistad({
  playerId,
  nombre,
  estado,
}: {
  playerId: string
  /** El primer nombre ("Nico"). */
  nombre: string
  estado: 'none' | 'sent' | 'friends'
}) {
  const [aviso, setAviso] = useState<{ texto: string; deshacer: boolean } | null>(null)
  const [pending, startTransition] = useTransition()

  const agregar = () =>
    startTransition(async () => {
      const result = await agregarAmigo(playerId)
      if (!result.ok) setAviso({ texto: result.error, deshacer: false })
      // Una pantalla vieja: el otro ya había pedido, y "Agregar" lo aceptó.
      else if (result.estado === 'friends') setAviso({ texto: `Ahora sos amigo de ${nombre}`, deshacer: false })
      else setAviso({ texto: `Le mandaste el pedido a ${nombre}`, deshacer: true })
    })

  const deshacer = () =>
    startTransition(async () => {
      const result = await deshacerPedido(playerId)
      if (!result.ok) setAviso({ texto: result.error, deshacer: false })
    })

  return (
    <>
      {estado === 'none' && (
        <button
          type="button"
          disabled={pending}
          onClick={agregar}
          aria-label={`Agregar a ${nombre} como amigo`}
          className={chip('onBlock')}
        >
          <Icono>
            {PERSONA}
            <path d="M19 8v6" />
            <path d="M22 11h-6" />
          </Icono>
          Agregar
        </button>
      )}
      {estado === 'sent' && (
        <span className={chip('hueca')}>
          <Icono>
            <path d="M20 6 9 17l-5-5" />
          </Icono>
          Enviado
        </span>
      )}
      {estado === 'friends' && (
        <Link href={amigosHref(playerId)} aria-label={`Amigos: ver el historial con ${nombre}`} className={chip('hueca')}>
          <Icono>
            <path d="m16 11 2 2 4-4" />
            {PERSONA}
          </Icono>
          Amigos
          <Icono className="h-3.5 w-3.5">
            <path d="m9 18 6-6-6-6" />
          </Icono>
        </Link>
      )}
      <Toast
        message={aviso?.texto ?? null}
        action={aviso?.deshacer === true ? { label: 'Deshacer', onClick: deshacer } : undefined}
        onDismiss={() => setAviso(null)}
        // Arriba de la barra de pestañas del torneo, como el de `carga.tsx`.
        className="bottom-[calc(96px+env(safe-area-inset-bottom))]"
      />
    </>
  )
}

/**
 * "Nico te pidió ser amigos": la tarjeta blanca en el encabezado. Se tiene
 * que notar (feedback L6), por eso va en grande y no en el chip. La ✕
 * rechaza: borra el pedido, sin aviso al otro.
 */
export function PedidoRecibido({ playerId, nombre, hace }: { playerId: string; nombre: string; hace: string }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const responder = (accion: (friendPlayerId: string) => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      const result = await accion(playerId)
      setError(result.ok ? null : result.error)
    })

  return (
    // Adentro del bloque el foco es blanco; sobre esta tarjeta vuelve a la tinta.
    <div className="mt-4 rounded-tile bg-bg py-3 pr-3 pl-4 text-text [--color-focus:var(--color-text)]">
      <div className="flex items-center gap-2.5">
        <p className="min-w-0 flex-1 text-[16px] leading-tight font-bold">
          {nombre} te pidió ser amigos
          <small className="block text-[14px] font-normal text-muted">{hace}</small>
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => responder(aceptarPedidoDe)}
          className="press min-h-[44px] shrink-0 rounded-btn bg-cta px-4 text-[16px] font-bold text-on-cta"
        >
          Aceptar
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => responder(rechazarPedidoDe)}
          aria-label={`Rechazar el pedido de ${nombre}`}
          className="press grid h-11 w-11 shrink-0 place-items-center rounded-btn bg-chip text-muted"
        >
          <Icono className="h-5 w-5">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </Icono>
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="mt-2 text-[14px] font-semibold text-live">
          {error}
        </p>
      )}
    </div>
  )
}
