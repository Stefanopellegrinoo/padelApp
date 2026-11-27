'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icono } from '@/app/torneos/inicio/iconos'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'
import type { GenteDeTorneo } from '@/db/friends'
import { useGente } from '../gente'
import { cuantasPersonas, deUnTorneo, filtrosDeGente, GENTE_POR_TANDA, mostrarMas } from '../gente-texto'

/**
 * "Ver todas" de "Gente de tus torneos" (odd/tasks/amigos-faciles.md, S10,
 * `design/amigos-faciles/08-gente-de-tus-torneos-paginada.html`, láminas 2-4).
 *
 * Arriba, "Todos" y un chip por torneo con gente para sugerir; se deslizan de
 * costado. El filtro vive en `?torneo=<seasonId>`, así sobrevive a recargar:
 * la página lo lee y lo pasa en `torneo`; al tocar un chip se reemplaza en la
 * URL sin volver al servidor (`history.replaceState`, que Next escucha), y
 * Volver sigue yendo a Amigos. Abajo, las primeras 20 en el orden de Amigos
 * (más fechas juntos primero, sin mostrar el número); "Mostrar más (k)" suma
 * las siguientes 20 y lleva el foco a la primera nueva. Con todas a la vista,
 * "Son todas: N personas".
 *
 * Las filas son las de Amigos (`useGente`): la misma foto de cuando se abrió
 * la pantalla, así quien pasó a "Enviado" sigue ahí al mostrar más o al
 * cambiar de filtro, aunque el servidor ya no la sugiera.
 */
export function GenteTodas({ gente, torneo: inicial }: { gente: GenteDeTorneo[]; torneo: string | null }) {
  const { foto, filas, aviso } = useGente(gente)
  const [torneo, setTorneo] = useState(inicial)
  const [visibles, setVisibles] = useState(GENTE_POR_TANDA)
  const [enfocar, setEnfocar] = useState<number | null>(null)
  const lista = useRef<HTMLUListElement>(null)
  const chips = useRef<HTMLDivElement>(null)

  const filtros = filtrosDeGente(foto)
  const personas = deUnTorneo(foto, torneo)
  const mas = mostrarMas(personas.length, visibles)

  // La primera fila nueva toma el foco: el botón que se tocó puede desaparecer.
  useEffect(() => {
    if (enfocar !== null) (lista.current?.children[enfocar] as HTMLElement | undefined)?.focus()
  }, [enfocar])

  // Con un torneo elegido (al recargar, por ejemplo), su chip queda a la vista.
  useEffect(() => {
    const fila = chips.current
    const elegido = fila?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (fila && elegido) fila.scrollLeft = elegido.offsetLeft - fila.offsetLeft - 48
  }, [torneo])

  const elegir = (seasonId: string | null) => {
    setTorneo(seasonId)
    setVisibles(GENTE_POR_TANDA)
    setEnfocar(null)
    const url = new URL(window.location.href)
    if (seasonId === null) url.searchParams.delete('torneo')
    else url.searchParams.set('torneo', seasonId)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }

  const verMas = () => {
    setEnfocar(visibles)
    setVisibles((antes) => antes + GENTE_POR_TANDA)
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-[calc(24px+env(safe-area-inset-bottom))] text-text">
      <Hero back={{ href: '/amigos', label: 'Amigos' }} title="Gente de tus torneos" subtitle={cuantasPersonas(personas.length)} />

      <div
        ref={chips}
        role="group"
        aria-label="Filtrar por torneo"
        className="mt-2 flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ChipDeFiltro elegido={torneo === null} onClick={() => elegir(null)}>
          Todos
        </ChipDeFiltro>
        {filtros.map((filtro) => (
          <ChipDeFiltro key={filtro.seasonId} elegido={torneo === filtro.seasonId} onClick={() => elegir(filtro.seasonId)}>
            {filtro.nombre}
          </ChipDeFiltro>
        ))}
      </div>

      {personas.length === 0 ? (
        <div className="px-4 pt-4">
          {foto.length === 0 ? (
            <>
              <p className="text-[17px] font-bold">Nadie para sugerir por ahora.</p>
              <p className="mt-1 text-[15px] text-muted">Acá aparece la gente con cuenta de tus torneos.</p>
            </>
          ) : (
            <>
              <p className="text-[17px] font-bold">Nadie para sugerir en este torneo.</p>
              <button type="button" onClick={() => elegir(null)} className={`${button('ghost')} -ml-4 mt-1`}>
                Ver todos
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="px-4 pt-1">{filas(personas.slice(0, visibles), lista)}</div>
      )}

      {mas > 0 && (
        <div className="px-4 pt-4">
          <button type="button" onClick={verMas} className={button('secondary', { full: true })}>
            <Icono name="chev" className="h-5 w-5 rotate-90" />
            Mostrar más ({mas})
          </button>
        </div>
      )}
      {mas === 0 && personas.length > GENTE_POR_TANDA && (
        <p role="status" className="px-4 pt-[18px] text-center text-[14px] text-muted">
          Son todas: {cuantasPersonas(personas.length)}
        </p>
      )}
      {aviso}
    </main>
  )
}

/** Un chip del filtro: 36 a la vista y 44 para el dedo (el `::after`), tinta cuando está elegido. */
function ChipDeFiltro({ elegido, onClick, children }: { elegido: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={elegido}
      onClick={onClick}
      className={`press relative min-h-[36px] shrink-0 rounded-pill px-3.5 text-[15px] font-bold whitespace-nowrap after:absolute after:-inset-1 after:content-[''] ${
        elegido ? 'bg-cta text-on-cta' : 'bg-chip text-text'
      }`}
    >
      {children}
    </button>
  )
}
