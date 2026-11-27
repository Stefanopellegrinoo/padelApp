'use client'

import Link from 'next/link'
import { useState, useTransition, type ReactNode } from 'react'
import { Icono } from '@/app/torneos/inicio/iconos'
import { Avatar } from '@/app/ui/avatar'
import { button } from '@/app/ui/button'
import { chip } from '@/app/ui/chip'
import { row } from '@/app/ui/row'
import { Section } from '@/app/ui/section'
import { Toast } from '@/app/ui/toast'
import type { GenteDeTorneo } from '@/db/friends'
import { agregarAmigo } from './actions'
import { GENTE_EN_AMIGOS, GENTE_EN_INICIO, metaDeGente } from './gente-texto'

/**
 * "Gente de tus torneos" (odd/tasks/amigos-faciles.md, S3,
 * `design/amigos-faciles/02-gente-de-tus-torneos.html`): en Amigos, abajo de
 * tus amigos; en Inicio, cuando todavía no tenés ninguno.
 *
 * La lista es una FOTO de cuando se abrió la pantalla (`useState` con la
 * primera que llega): "Agregar" revalida la página, y el servidor ya no
 * sugiere a quien le pediste (pasa a "Pedidos enviados"). Con la foto, esa
 * fila se queda en "Enviado" mientras sigas acá, como decidió el orquestador;
 * al volver a entrar, la foto es nueva y esa persona ya no está.
 */

type Estado = 'none' | 'sent' | 'friends'

function useGente(gente: GenteDeTorneo[], avisoClassName?: string) {
  const [foto] = useState(gente)
  const [estados, setEstados] = useState<Record<string, Estado>>({})
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const agregar = (playerId: string) =>
    startTransition(async () => {
      const result = await agregarAmigo(playerId)
      if (!result.ok) setError(result.error)
      else setEstados((antes) => ({ ...antes, [playerId]: result.estado }))
    })

  const filas = (personas: GenteDeTorneo[]) => (
    <ul className="-mx-4">
      {personas.map((persona) => (
        <FilaGente
          key={persona.playerId}
          persona={persona}
          estado={estados[persona.playerId] ?? 'none'}
          pending={pending}
          onAgregar={() => agregar(persona.playerId)}
        />
      ))}
    </ul>
  )

  const aviso = <Toast message={error} onDismiss={() => setError(null)} className={avisoClassName} />

  return { foto, filas, aviso }
}

function FilaGente({
  persona,
  estado,
  pending,
  onAgregar,
}: {
  persona: GenteDeTorneo
  estado: Estado
  pending: boolean
  onAgregar: () => void
}) {
  return (
    <li className={`${row} min-h-[72px]`}>
      <Avatar name={persona.displayName} />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-[17px] leading-tight font-bold break-words">{persona.displayName}</span>
        <span className="mt-0.5 block text-[14px] leading-snug text-muted">{metaDeGente(persona)}</span>
      </span>
      {estado === 'none' ? (
        <button
          type="button"
          disabled={pending}
          onClick={onAgregar}
          aria-label={`Agregar a ${persona.displayName}`}
          className={chip('claro')}
        >
          <Icono name="sumarPersona" className="h-4 w-4" />
          Agregar
        </button>
      ) : (
        <span className={chip('claroHecho')}>
          <Icono name="check" className="h-4 w-4" />
          {estado === 'sent' ? 'Enviado' : 'Amigos'}
        </span>
      )}
    </li>
  )
}

/** En Amigos: la sección entera, con las primeras cuatro y "Ver los N". Sin nadie, no hay sección. */
export function GenteDeTusTorneos({ gente }: { gente: GenteDeTorneo[] }) {
  const { foto, filas, aviso } = useGente(gente)
  const [todos, setTodos] = useState(false)
  if (foto.length === 0) return null

  const hayMas = foto.length > GENTE_EN_AMIGOS && !todos
  return (
    <Section title="Gente de tus torneos" className="pt-7">
      <p className="-mt-1.5 mb-2 text-[15px] text-muted">Jugaron con vos y tienen cuenta</p>
      {filas(hayMas ? foto.slice(0, GENTE_EN_AMIGOS) : foto)}
      {hayMas && (
        <button type="button" onClick={() => setTodos(true)} className={button('ghost')}>
          Ver los {foto.length}
        </button>
      )}
      {aviso}
    </Section>
  )
}

/**
 * En Inicio, adentro de "Amigos", cuando todavía no tenés ninguno: las dos
 * primeras personas y "Ver más gente". Sin nadie para sugerir, `children` (lo
 * de siempre, "Sumá un amigo").
 */
export function EmpezaPorTusTorneos({ gente, children }: { gente: GenteDeTorneo[]; children: ReactNode }) {
  // Arriba de "Cargar partido", la barra de abajo de Inicio.
  const { foto, filas, aviso } = useGente(gente, 'bottom-[calc(96px+env(safe-area-inset-bottom))]')
  if (foto.length === 0) return children

  return (
    <>
      <p className="-mt-1.5 mb-2 text-[15px] text-muted">Empezá por la gente de tus torneos</p>
      {filas(foto.slice(0, GENTE_EN_INICIO))}
      {foto.length > GENTE_EN_INICIO && (
        <Link href="/amigos" className={button('ghost')}>
          Ver más gente
        </Link>
      )}
      {aviso}
    </>
  )
}
