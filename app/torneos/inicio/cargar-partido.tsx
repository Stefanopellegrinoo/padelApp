'use client'

import Link from 'next/link'
import { useState } from 'react'
import { button } from '@/app/ui/button'
import { Sheet } from '@/app/ui/sheet'
import { Icono } from './iconos'

/** Una fecha en juego donde podés cargar, ya nombrada por el servidor (`estado.ts`). */
export interface FechaParaCargar {
  id: string
  href: string
  /** "Fecha 8" o "Masters". */
  titulo: string
  torneo: string
  /** `"mar 24 nov"`, o `null` si la fecha no tiene día. */
  dia: string | null
  /** El `kind` del deporte, para `data-deporte`. */
  sport: string
}

/**
 * "Cargar partido", fijo abajo de Inicio, como en el prototipo: abre la hoja
 * con los caminos más cortos para cargar un resultado. "Partido con un amigo"
 * va primero (es corto y con muchas fechas abiertas quedaría abajo de todo) y
 * lleva a Amigos, donde se elige con quién. Después, cada fecha en juego donde
 * podés cargar, derecho a su pantalla, que abre la hoja de carga con un toque
 * al partido (T8).
 *
 * Es el único pedazo de cliente de Inicio: la hoja necesita estado.
 */
export function CargarPartido({ fechas }: { fechas: readonly FechaParaCargar[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`${button('primary', { size: 'lg', full: true })} mx-auto max-w-lg`}
        >
          <Icono name="plus" />
          Cargar partido
        </button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Cargar partido">
        <Link
          href="/amigos"
          className="press mt-3 flex min-h-[56px] items-center gap-3 rounded-tile border-[1.5px] border-line py-2 pr-3 pl-4"
        >
          <Icono name="amigos" />
          <span className="min-w-0 flex-1 text-[17px] font-bold">Partido con un amigo</span>
          <Icono name="chev" className="h-6 w-6 text-muted" />
        </Link>
        {fechas.length > 0 && (
          <>
            <h3 className="mt-5 mb-2 text-[15px] font-semibold text-muted">Fechas en juego</h3>
            <ul className="flex flex-col gap-2">
              {fechas.map((fecha) => (
                // En oscuro el tinte del deporte casi no se separa de la hoja:
                // el borde de opción (transparente en claro) lo recorta.
                <li key={fecha.id} data-deporte={fecha.sport}>
                  <Link
                    href={fecha.href}
                    className="press flex min-h-[64px] items-center gap-3 rounded-tile bg-sport-tint py-2.5 pr-3 pl-4 shadow-[inset_0_0_0_1.5px_var(--color-opcion-borde)]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="font-cond text-[28px] text-sport">{fecha.titulo}</span>
                        {fecha.dia !== null && <span className="text-[14px] text-muted">{fecha.dia}</span>}
                      </span>
                      <span className="mt-1 block truncate text-[16px] font-bold">{fecha.torneo}</span>
                    </span>
                    <Icono name="chev" className="h-6 w-6 text-sport" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Sheet>
    </>
  )
}
