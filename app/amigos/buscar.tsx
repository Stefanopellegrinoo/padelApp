'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react'
import { Icono } from '@/app/torneos/inicio/iconos'
import { Avatar } from '@/app/ui/avatar'
import { chip } from '@/app/ui/chip'
import { row } from '@/app/ui/row'
import { Toast } from '@/app/ui/toast'
import type { EstadoBusqueda, UsernameMatch } from '@/db/buscar'
import { aceptarPedidoDe, agregarAmigo, buscarPorUsuario } from './actions'
import {
  AYUDA_BUSQUEDA,
  BUSQUEDA_CORTA,
  ESPERA_MS,
  SIN_RESULTADOS,
  campoDeBusqueda,
  partesDelUsuario,
  resumenDeBusqueda,
} from './buscar-texto'
import { CompartirMiLink } from './link'

/**
 * El buscador de Amigos por @usuario (odd/tasks/amigos-faciles.md, S8,
 * `design/amigos-faciles/05-buscar-por-usuario.html`), justo abajo del
 * encabezado. Busca cuando dejás de escribir y desde 3 letras; la base hace
 * cumplir el mínimo, el tope de 10 y quién aparece (0124).
 *
 * Mientras hay búsqueda, los resultados reemplazan a las secciones de abajo
 * (`children`). Las secciones no se desmontan, sólo se esconden: al borrar
 * vuelven como estaban, con sus "Enviado" y todo.
 *
 * Cada fila lleva a su perfil (`/perfil/<id>`, S9) y, a la derecha, su estado:
 * "Agregar" (queda en "Enviado"), "Enviado", "Amigos ›" al historial, o
 * "Te pidió · Aceptar". Rechazar va desde el perfil, no acá. Lo que se toca
 * acá se recuerda mientras sigas en la pantalla, aunque vuelvas a buscar.
 *
 * Sólo tipos de `@/db/buscar`: un componente `'use client'` no se puede
 * arrastrar `db/friends` (ver `link.tsx`).
 */
export function BuscarPorUsuario({ token, children }: { token: string; children: ReactNode }) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [texto, setTexto] = useState('')
  const [respuesta, setRespuesta] = useState<
    { query: string; resultados: UsernameMatch[] } | { query: string; error: string } | null
  >(null)
  const [estados, setEstados] = useState<Record<string, EstadoBusqueda>>({})
  const [aviso, setAviso] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const campo = campoDeBusqueda(texto)
  const query = campo.kind === 'buscar' ? campo.query : null

  useEffect(() => {
    if (query === null) return
    // Una respuesta que llega tarde, de algo que ya cambiaste, no se muestra.
    let vigente = true
    const timer = setTimeout(() => {
      buscarPorUsuario(query)
        .then((resultado) => {
          if (!vigente) return
          setRespuesta(resultado.ok ? { query, resultados: resultado.resultados } : { query, error: resultado.error })
        })
        .catch(() => {
          if (vigente) setRespuesta({ query, error: 'No se pudo buscar. Probá de nuevo.' })
        })
    }, ESPERA_MS)
    return () => {
      vigente = false
      clearTimeout(timer)
    }
  }, [query])

  const responder = (persona: UsernameMatch, accion: 'agregar' | 'aceptar') =>
    startTransition(async () => {
      // "Agregar" a quien justo te había pedido los deja amigos (`addFriend`).
      const result =
        accion === 'agregar'
          ? await agregarAmigo(persona.playerId)
          : await aceptarPedidoDe(persona.playerId).then((r) => (r.ok ? { ...r, estado: 'friends' as const } : r))
      if (!result.ok) {
        setAviso(result.error)
        return
      }
      setEstados((antes) => ({ ...antes, [persona.playerId]: result.estado }))
    })

  const borrar = () => {
    setTexto('')
    setRespuesta(null)
    input.current?.focus()
  }

  // Hasta que llega la primera respuesta de esta búsqueda, la de antes (si había).
  const vista = query === null ? null : respuesta

  return (
    <>
      <form role="search" className="px-4 pt-4" onSubmit={(event) => event.preventDefault()}>
        {/* El anillo de foco va en la caja entera, como en `campo-fecha.tsx`: el del input quedaría adentro. */}
        <label htmlFor={id} className="sr-only">
          Buscar por @usuario
        </label>
        <div className="flex min-h-12 items-center gap-2.5 rounded-btn bg-surface pr-1 pl-3.5 shadow-[inset_0_0_0_1px_var(--color-line)] focus-within:shadow-[inset_0_0_0_2px_var(--color-accent-link)] has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus">
          <IconoBuscar />
          <input
            ref={input}
            id={id}
            type="search"
            value={texto}
            onChange={(event) => setTexto(event.target.value)}
            placeholder="Buscá por @usuario"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-describedby={query === null ? `${id}-ayuda` : undefined}
            className="min-h-11 min-w-0 flex-1 bg-transparent text-[17px] text-text placeholder:text-muted placeholder:opacity-100 [--color-focus:transparent] [&::-webkit-search-cancel-button]:hidden"
          />
          {texto !== '' && (
            <button
              type="button"
              onClick={borrar}
              aria-label="Borrar la búsqueda"
              className="press grid h-11 w-11 shrink-0 place-items-center rounded-btn text-muted"
            >
              <Icono name="x" className="h-5 w-5" />
            </button>
          )}
        </div>
        {query === null && (
          <p id={`${id}-ayuda`} role={campo.kind === 'corta' ? 'status' : undefined} className="mt-2 text-[14px] text-muted">
            {campo.kind === 'corta' ? BUSQUEDA_CORTA : AYUDA_BUSQUEDA}
          </p>
        )}
      </form>

      {vista !== null &&
        ('error' in vista ? (
          <p role="alert" className="mx-4 mt-4 rounded-btn bg-live-bg px-3 py-2.5 text-[15px] font-semibold text-live">
            {vista.error}
          </p>
        ) : vista.resultados.length === 0 ? (
          <div role="status" className="mx-4 mt-4 rounded-tile bg-surface px-[18px] pt-[18px] pb-2.5">
            <p className="text-muted">{SIN_RESULTADOS}</p>
            <div className="mt-2 -ml-4">
              <CompartirMiLink token={token} variant="ghost" />
            </div>
          </div>
        ) : (
          <section className="px-4 pt-3.5" aria-label="Resultados">
            <p role="status" className="mb-1 text-[14px] text-muted">
              {resumenDeBusqueda(vista.resultados.length, vista.query)}
            </p>
            <ul className="-mx-4">
              {vista.resultados.map((persona) => (
                <FilaResultado
                  key={persona.playerId}
                  persona={persona}
                  query={vista.query}
                  estado={estados[persona.playerId] ?? persona.estado}
                  pending={pending}
                  onAgregar={() => responder(persona, 'agregar')}
                  onAceptar={() => responder(persona, 'aceptar')}
                />
              ))}
            </ul>
          </section>
        ))}

      <div hidden={query !== null}>{children}</div>

      <Toast message={aviso} onDismiss={() => setAviso(null)} />
    </>
  )
}

/** La lupa de la maqueta (Lucide, ISC): decorativa, el campo ya tiene su etiqueta. */
function IconoBuscar() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0 text-muted"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

// Los dos chips que `chip()` no trae, sobre su misma receta (34 a la vista, 44 de toque, S6):
// "Amigos ›" con el borde de la lista, y "Aceptar" con el color del botón principal.
const CHIP_AMIGOS = chip('claro').replace('bg-opcion text-accent-link', 'text-text shadow-[inset_0_0_0_1.5px_var(--color-line)]')
const CHIP_ACEPTAR = chip('claro').replace('bg-opcion text-accent-link', 'bg-cta text-on-cta')

function FilaResultado({
  persona,
  query,
  estado,
  pending,
  onAgregar,
  onAceptar,
}: {
  persona: UsernameMatch
  query: string
  estado: EstadoBusqueda
  pending: boolean
  onAgregar: () => void
  onAceptar: () => void
}) {
  const { prefijo, resto } = partesDelUsuario(persona.username, query)
  return (
    // Quien te pidió va resaltado, como el pedido en Inicio.
    <li className={`${row} min-h-[72px] ${estado === 'received' ? 'border-transparent bg-sport-tint' : ''}`}>
      <Link href={`/perfil/${persona.playerId}`} className="flex min-h-12 min-w-0 flex-1 items-center gap-3">
        <Avatar name={persona.displayName} />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-[17px] leading-tight font-bold break-words">{persona.displayName}</span>
          <span className="mt-0.5 block truncate text-[14px] leading-snug text-muted">
            {prefijo !== '' ? <b className="font-bold text-text">@{prefijo}</b> : '@'}
            {resto}
          </span>
        </span>
      </Link>
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
      ) : estado === 'sent' ? (
        <span className={chip('claroHecho')}>
          <Icono name="check" className="h-4 w-4" />
          Enviado
        </span>
      ) : estado === 'friends' ? (
        <Link
          href={`/amigos/${persona.playerId}?desde=amigos`}
          aria-label={`Amigos: ver el historial con ${persona.displayName}`}
          className={CHIP_AMIGOS}
        >
          Amigos
          <Icono name="chev" className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <span className="flex shrink-0 items-center gap-2">
          <small className="text-[13px] font-bold text-muted">Te pidió</small>
          <button
            type="button"
            disabled={pending}
            onClick={onAceptar}
            aria-label={`Aceptar el pedido de ${persona.displayName}`}
            className={CHIP_ACEPTAR}
          >
            Aceptar
          </button>
        </span>
      )}
    </li>
  )
}
