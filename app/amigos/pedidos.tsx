'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Icono } from '@/app/torneos/inicio/iconos'
import { primerNombre } from '@/app/torneo/[id]/[disciplina]/jugador/amistad-texto'
import { Avatar } from '@/app/ui/avatar'
import { button } from '@/app/ui/button'
import { row } from '@/app/ui/row'
import { Section } from '@/app/ui/section'
import { Toast } from '@/app/ui/toast'
import type { PedidoRecibido } from '@/db/inicio'
import { aceptarPedidoDe, deshacerPedido, rechazarPedidoDe, type AmistadResult } from './actions'
import { metaRecibidoEnAmigos, metaRecibidoEnInicio } from './pedidos-texto'

/**
 * Los pedidos de amistad a la vista (odd/tasks/amigos-faciles.md, S4,
 * `design/amigos-faciles/03-pedidos-visibles.html`): en Inicio, resaltados
 * arriba de tus amigos; en Amigos, "Te pidieron" y "Pedidos enviados".
 *
 * Todo va por la persona (`playerId`), con las mismas acciones del perfil del
 * torneo. Aceptar avisa "Ahora sos amigo de Juampi" con "Ver"; ✕ y Cancelar
 * borran el pedido sin deshacer. La fila se va apenas responde bien, sin
 * esperar a que la página vuelva con la lista nueva; si falla, queda y el
 * aviso dice por qué.
 *
 * El aviso vive en el componente y no en la fila: aunque la página ya no
 * traiga ningún pedido (el último pasó a ser amigo), el componente sigue
 * montado y el aviso con él.
 */

/** Un pedido que mandé, con su "Sin respuesta · hace 3 días" ya armado en el servidor. */
export interface PedidoEnviado {
  playerId: string
  displayName: string
  meta: string
}

type Aviso = { texto: string; ver?: string }

function usePedidos(verHref: (playerId: string) => string) {
  const router = useRouter()
  const [hechos, setHechos] = useState<ReadonlySet<string>>(new Set())
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [pending, startTransition] = useTransition()

  const responder = (
    accion: (friendPlayerId: string) => Promise<AmistadResult>,
    playerId: string,
    listo?: Aviso,
  ) =>
    startTransition(async () => {
      const result = await accion(playerId)
      if (!result.ok) {
        setAviso({ texto: result.error })
        return
      }
      setHechos((antes) => new Set(antes).add(playerId))
      setAviso(listo ?? null)
    })

  const aceptar = (persona: { playerId: string; displayName: string }) =>
    responder(aceptarPedidoDe, persona.playerId, {
      texto: `Ahora sos amigo de ${primerNombre(persona.displayName)}`,
      ver: verHref(persona.playerId),
    })

  const ver = aviso?.ver
  const toast = (className?: string) => (
    <Toast
      message={aviso?.texto ?? null}
      action={ver === undefined ? undefined : { label: 'Ver', onClick: () => router.push(ver) }}
      onDismiss={() => setAviso(null)}
      className={className}
    />
  )

  return { hechos, pending, responder, aceptar, toast }
}

/** Aceptar y ✕: el ✕ chico y aparte, porque no tiene deshacer. */
function Responder({
  nombre,
  pending,
  onAceptar,
  onRechazar,
}: {
  nombre: string
  pending: boolean
  onAceptar: () => void
  onRechazar: () => void
}) {
  return (
    <>
      <button type="button" disabled={pending} onClick={onAceptar} className={`${button('primary')} shrink-0`}>
        Aceptar
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={onRechazar}
        aria-label={`Rechazar el pedido de ${primerNombre(nombre)}`}
        className="press grid h-11 w-11 shrink-0 place-items-center rounded-btn bg-chip text-muted"
      >
        <Icono name="x" className="h-5 w-5" />
      </button>
    </>
  )
}

function NombreYMeta({ nombre, meta }: { nombre: string; meta: string | null }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="line-clamp-2 block text-[17px] leading-tight font-bold break-words">{nombre}</span>
      {meta !== null && <span className="mt-0.5 block text-[14px] leading-snug text-muted">{meta}</span>}
    </span>
  )
}

/**
 * En Inicio, adentro de "Amigos" y arriba de todo: cada pedido resaltado con
 * el tinte del deporte, "Te pidió ser amigos · Los Pibes del Martes". "Ver"
 * lleva a su historial, que vuelve a Inicio.
 */
export function PedidosEnInicio({ pedidos }: { pedidos: PedidoRecibido[] }) {
  const { hechos, pending, responder, aceptar, toast } = usePedidos((playerId) => `/amigos/${playerId}`)
  const visibles = pedidos.filter((pedido) => !hechos.has(pedido.playerId))

  return (
    <>
      {visibles.length > 0 && (
        // El `gap-px` deja ver el fondo entre dos pedidos: el divisor de las filas.
        <ul className="-mx-4 mb-1 flex flex-col gap-px">
          {visibles.map((pedido) => (
            <li key={pedido.playerId} className="flex min-h-[72px] items-center gap-3 bg-sport-tint px-4 py-3">
              <Avatar name={pedido.displayName} />
              <NombreYMeta nombre={pedido.displayName} meta={metaRecibidoEnInicio(pedido.torneos)} />
              <Responder
                nombre={pedido.displayName}
                pending={pending}
                onAceptar={() => aceptar(pedido)}
                onRechazar={() => responder(rechazarPedidoDe, pedido.playerId)}
              />
            </li>
          ))}
        </ul>
      )}
      {/* Arriba de "Cargar partido", la barra de abajo de Inicio. */}
      {toast('bottom-[calc(96px+env(safe-area-inset-bottom))]')}
    </>
  )
}

/** En Amigos, arriba de todo: "Te pidieron", con "De Los Pibes del Martes". "Ver" vuelve a Amigos. */
export function TePidieron({ pedidos }: { pedidos: PedidoRecibido[] }) {
  const { hechos, pending, responder, aceptar, toast } = usePedidos((playerId) => `/amigos/${playerId}?desde=amigos`)
  const visibles = pedidos.filter((pedido) => !hechos.has(pedido.playerId))

  return (
    <>
      {visibles.length > 0 && (
        <Section title="Te pidieron">
          <ul className="-mx-4">
            {visibles.map((pedido) => (
              <li key={pedido.playerId} className={`${row} min-h-[72px]`}>
                <Avatar name={pedido.displayName} />
                <NombreYMeta nombre={pedido.displayName} meta={metaRecibidoEnAmigos(pedido.torneos)} />
                <Responder
                  nombre={pedido.displayName}
                  pending={pending}
                  onAceptar={() => aceptar(pedido)}
                  onRechazar={() => responder(rechazarPedidoDe, pedido.playerId)}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}
      {toast()}
    </>
  )
}

/** En Amigos: los pedidos que mandé y nadie contestó, con "Cancelar". */
export function PedidosEnviados({ enviados }: { enviados: PedidoEnviado[] }) {
  const { hechos, pending, responder, toast } = usePedidos((playerId) => `/amigos/${playerId}`)
  const visibles = enviados.filter((pedido) => !hechos.has(pedido.playerId))

  return (
    <>
      {visibles.length > 0 && (
        <Section title="Pedidos enviados" className="pt-7">
          <ul className="-mx-4">
            {visibles.map((pedido) => (
              <li key={pedido.playerId} className={`${row} min-h-[72px]`}>
                <Avatar name={pedido.displayName} />
                <NombreYMeta nombre={pedido.displayName} meta={pedido.meta} />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => responder(deshacerPedido, pedido.playerId)}
                  aria-label={`Cancelar el pedido a ${primerNombre(pedido.displayName)}`}
                  className={`${button('secondary')} shrink-0`}
                >
                  Cancelar
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {toast()}
    </>
  )
}
