'use client'

import { useState, useTransition } from 'react'
import { agregarAmigo, deshacerPedido } from '@/app/amigos/actions'
import { Toast } from '@/app/ui/toast'
import { Trazo } from './piezas'

/**
 * La amistad en el encabezado del perfil (odd/tasks/amigos-faciles.md, S9;
 * `design/amigos-faciles/06-perfil.html`). Los mismos estados y las mismas
 * acciones que el chip del perfil del torneo (`ChipAmistad`), en la píldora
 * grande de la maqueta: "Agregar amigo" → "Enviado" (con "Deshacer" en el
 * aviso) y "Amigos ✓". Cuando el otro ya pidió va la tarjeta del torneo
 * (`PedidoRecibido`), que la página pone en lugar de esto.
 *
 * El estado lo trae la página; cada acción revalida `/perfil/<id>`
 * (`enElPerfil`, `app/amigos/actions.ts`) y vuelve con el nuevo. El aviso es
 * de acá y sobrevive a ese cambio.
 */

const PILDORA = 'press inline-flex min-h-[44px] items-center gap-2 rounded-pill px-[18px] text-[16px] font-extrabold'

export function AccionAmistad({
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
        <button type="button" disabled={pending} onClick={agregar} className={`${PILDORA} bg-on-block text-block`}>
          <Trazo name="sumarPersona" className="h-5 w-5 stroke-[2.4]" />
          Agregar amigo
        </button>
      )}
      {estado !== 'none' && (
        <span className={`${PILDORA} text-on-block shadow-[inset_0_0_0_1.5px_var(--color-on-block-soft)]`}>
          <Trazo name="check" className="h-5 w-5 stroke-[2.4]" />
          {estado === 'sent' ? 'Enviado' : 'Amigos'}
        </span>
      )}
      <Toast
        message={aviso?.texto ?? null}
        action={aviso?.deshacer === true ? { label: 'Deshacer', onClick: deshacer } : undefined}
        onDismiss={() => setAviso(null)}
      />
    </>
  )
}
