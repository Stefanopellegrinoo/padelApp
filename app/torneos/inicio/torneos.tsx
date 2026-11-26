'use client'

import Link from 'next/link'
import { useId, useState, type ReactNode } from 'react'
import { Section } from '@/app/ui/section'
import { torneosALaVista, verTorneosTexto, type VistaTorneo } from './estado'
import { IconoDeporte } from './iconos'

/** Un torneo en juego de Inicio, ya resumido por el servidor (`cardFor`, `app/torneos/page.tsx`). */
export interface TorneoTile {
  id: string
  name: string
  /** El `kind` de la disciplina principal: el color del bloque (`data-deporte`). */
  sport: string
  /** "Pádel", o "Pádel y FIFA" con más de un deporte. */
  sports: string
  /** "Fecha 8 de 12", "Sin empezar". */
  progreso: string
  /** `null` cuando la temporada todavía no repartió un punto: no hay posición que mostrar. */
  position: number | null
  squadSize: number
}

/** La clase de cada bloque con la grilla plegada: exactamente un `display`, para no pelear entre `flex` y `hidden`. */
const DISPLAY: Record<VistaTorneo, string> = {
  siempre: 'flex',
  ancho: 'hidden sm:flex',
  abierta: 'hidden',
}

/**
 * "Tus torneos": una grilla de bloques del color de su deporte, de dos
 * columnas en el teléfono y de tres desde 640. Plegada muestra dos filas
 * (`torneosALaVista`), así "Amigos" sigue entrando en la pantalla (S4), y
 * "Ver los N torneos" dice cuántos hay y abre el resto ahí mismo. Lo que se
 * esconde, se esconde con CSS: el ancho lo decide la pantalla, no JS.
 *
 * Cada bloque, compacto: el deporte con su ícono, el nombre en hasta dos
 * renglones (con puntos suspensivos, nunca cortado de costado), y abajo tu
 * puesto en la cara condensada y por qué fecha va.
 *
 * `children` son las acciones de abajo ("Crear torneo", "Torneo rápido").
 */
export function TusTorneos({ torneos, children }: { torneos: readonly TorneoTile[]; children: ReactNode }) {
  const [abierta, setAbierta] = useState(false)
  const grillaId = useId()
  const { vistas, boton } = torneosALaVista(torneos.length)
  return (
    <Section
      title="Tus torneos"
      action={
        boton === 'nunca' ? undefined : (
          <button
            type="button"
            aria-expanded={abierta}
            aria-controls={grillaId}
            onClick={() => setAbierta((prev) => !prev)}
            className={`press -my-2 flex min-h-[44px] shrink-0 items-center px-1 text-[16px] font-bold text-accent-link${
              boton === 'telefono' ? ' sm:hidden' : ''
            }`}
          >
            {verTorneosTexto(torneos.length, abierta)}
          </button>
        )
      }
    >
      {torneos.length > 0 && (
        <ul id={grillaId} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {torneos.map((torneo, i) => (
            <li
              key={torneo.id}
              data-deporte={torneo.sport}
              className={`min-w-0 ${abierta ? 'flex' : DISPLAY[vistas[i] ?? 'siempre']}`}
            >
              <Bloque torneo={torneo} />
            </li>
          ))}
        </ul>
      )}
      {children}
    </Section>
  )
}

function Bloque({ torneo }: { torneo: TorneoTile }) {
  const label = [
    torneo.name,
    torneo.sports,
    ...(torneo.position === null ? [] : [`vas ${torneo.position}° de ${torneo.squadSize}`]),
    torneo.progreso,
  ].join(', ')
  return (
    <Link
      href={`/torneo/${torneo.id}`}
      aria-label={label}
      className="press flex w-full min-w-0 flex-col rounded-tile bg-sport-tint px-3 pt-2.5 pb-3 text-sport"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <IconoDeporte kind={torneo.sport} className="h-[18px] w-[18px]" />
        <span className="min-w-0 truncate text-[13px] font-bold">{torneo.sports}</span>
      </span>
      <span data-nombre className="mt-1.5 line-clamp-2 text-[16px] leading-[1.2] font-bold break-words text-text">
        {torneo.name}
      </span>
      {/* Si no entran los dos en un renglón, la fecha baja: se acomoda, no se corta. */}
      <span className="mt-auto flex flex-wrap items-baseline justify-between gap-x-2 pt-2">
        {torneo.position !== null && (
          <span className="flex shrink-0 items-baseline gap-1">
            <span className="font-cond text-[30px] leading-[.8]">
              {torneo.position}
              <span className="align-[.62em] text-[.5em]">°</span>
            </span>
            <span className="text-[14px] leading-none font-bold">de {torneo.squadSize}</span>
          </span>
        )}
        <span className="text-[13px] leading-tight text-muted">{torneo.progreso}</span>
      </span>
    </Link>
  )
}
