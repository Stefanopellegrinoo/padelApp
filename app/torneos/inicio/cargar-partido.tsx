'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { button } from '@/app/ui/button'
import { rowPress } from '@/app/ui/row'
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

/** Un amigo de la hoja: con quién jugaste hace menos primero (`ordenarAmigos`). */
export interface AmigoParaCargar {
  playerId: string
  displayName: string
}

/**
 * "Cargar partido", fijo abajo de Inicio, como en el prototipo: abre la hoja
 * con los caminos más cortos para cargar un resultado. Primero tus amigos
 * (van primero porque con muchas fechas abiertas quedarían abajo de todo):
 * cada uno lleva a su perfil con la hoja del partido ya abierta
 * (`?cargar=1`, ver `CargarConAmigo`), así que de Inicio a cargar un partido
 * casual son dos toques (T17). Hasta seis, los que llegan; el resto, en "Ver
 * todos". Después, cada fecha en juego donde podés cargar, derecho a su
 * pantalla, que abre la hoja de carga con un toque al partido (T8).
 *
 * Es el único pedazo de cliente de Inicio: la hoja necesita estado.
 */
export function CargarPartido({
  fechas,
  amigos,
}: {
  fechas: readonly FechaParaCargar[]
  amigos: readonly AmigoParaCargar[]
}) {
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
        {amigos.length === 0 ? (
          <Link
            href="/amigos"
            className="press mt-3 flex min-h-[56px] items-center gap-3 rounded-tile border-[1.5px] border-line py-2 pr-3 pl-4"
          >
            <Icono name="amigos" />
            <span className="min-w-0 flex-1 text-[17px] font-bold">Sumá un amigo</span>
            <Icono name="chev" className="h-6 w-6 text-muted" />
          </Link>
        ) : (
          <>
            <h3 className="mt-3 mb-1 text-[15px] font-semibold text-muted">Con un amigo</h3>
            <ul className="-mx-4">
              {amigos.map((amigo) => (
                <li key={amigo.playerId}>
                  <Link href={`/amigos/${amigo.playerId}?cargar=1`} className={rowPress}>
                    <Avatar name={amigo.displayName} />
                    <span className="min-w-0 flex-1 truncate text-[17px] font-bold">{amigo.displayName}</span>
                    <Icono name="chev" className="h-6 w-6 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/amigos"
              className="press flex min-h-[44px] items-center text-[16px] font-bold text-accent-link"
            >
              Ver todos
            </Link>
          </>
        )}
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
