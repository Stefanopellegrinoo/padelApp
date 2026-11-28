import Link from 'next/link'
import type { ReactNode } from 'react'
import { initials } from '@/app/ui/avatar'
import { rowPress } from '@/app/ui/row'

/**
 * Lo que comparten los dos perfiles (odd/tasks/amigos-faciles.md, S9;
 * `design/amigos-faciles/06-perfil.html`): el avatar grande del encabezado,
 * los trazos de la maqueta y la fila con mosaico que lleva a otro lado.
 */

/** Trazos de Lucide (ISC), los mismos de la maqueta. */
const TRAZOS = {
  candado: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  check: ['M20 6 9 17l-5-5'],
  chev: ['m9 18 6-6-6-6'],
  reloj: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z', 'M12 6v6l4 2'],
  escudo: [
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
  ],
  tacho: ['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'],
  sumarPersona: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z', 'M19 8v6', 'M22 11h-6'],
} as const

export type TrazoName = keyof typeof TRAZOS

export function Trazo({ name, className = 'h-[22px] w-[22px]' }: { name: TrazoName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      data-icono={name}
      viewBox="0 0 24 24"
      className={`shrink-0 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round] ${className}`}
    >
      {TRAZOS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/** El círculo de 88 con las iniciales, blanco sobre el bloque. Decorativo: el nombre está al lado. */
export function AvatarGrande({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-[88px] w-[88px] shrink-0 place-items-center rounded-full bg-on-block text-[30px] font-[750] text-block"
    >
      {initials(name)}
    </span>
  )
}

/**
 * Una fila que lleva a otro lado: el mosaico de 44, el nombre, la línea gris
 * si hay, y la flecha. `tono`: `deporte` (el tinte del deporte de alrededor),
 * `gris` o `peligro` (Borrar cuenta).
 */
export function FilaLink({
  href,
  icono,
  nombre,
  meta,
  tono = 'deporte',
  alta = false,
}: {
  href: string
  icono: ReactNode
  nombre: string
  meta?: string | null
  tono?: 'deporte' | 'gris' | 'peligro'
  /** 72 de alto, para las filas con dos renglones. Si no, 60. */
  alta?: boolean
}) {
  const mosaico =
    tono === 'gris' ? 'bg-chip text-text' : tono === 'peligro' ? 'bg-live-bg text-live' : 'bg-sport-tint text-sport'
  return (
    <Link href={href} className={`${rowPress} ${alta ? 'min-h-[72px]' : 'min-h-[60px]'}`}>
      <span aria-hidden="true" className={`grid h-11 w-11 shrink-0 place-items-center rounded-[14px] ${mosaico}`}>
        {icono}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`line-clamp-2 block text-[17px] leading-tight font-bold break-words ${tono === 'peligro' ? 'text-live' : ''}`}>
          {nombre}
        </span>
        {meta !== undefined && meta !== null && (
          <span className="mt-0.5 block text-[14px] leading-snug text-muted">{meta}</span>
        )}
      </span>
      <Trazo name="chev" className="h-5 w-5 text-muted" />
    </Link>
  )
}
