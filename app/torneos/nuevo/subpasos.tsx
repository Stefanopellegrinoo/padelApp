'use client'

import { useRef, useState, type PointerEvent } from 'react'
import { modalityShape, sportLabel } from '@/core'
import { initials } from '@/app/format'
import { agruparChips } from '@/app/rapido/armar-state'
import { filaDestino, moverEnOrden, ordenInicial, type DeporteElegido } from './crear-state'

const AYUDA = 'text-pretty text-[13.5px] font-[550] leading-[1.5] text-muted'
const FILA = 'rounded-field border border-line bg-surface'
const CHIP = 'flex min-h-[44px] items-center justify-center rounded-field px-3 text-[13.5px] font-extrabold'
const FLECHA =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] text-[17px] font-extrabold text-muted disabled:opacity-30'

/**
 * "Armá las parejas" de UN deporte con parejas fijas (docs/torneos-deportes.md §4, mockup 3c). Como en
 * /rapido: tocás a dos y quedan juntas, tocar una pareja la deshace (`tocarJugador`, en quien la usa).
 * Controlada: cada toque llama a su `on…`.
 */
export function ArmarParejas({
  card,
  names,
  pendiente,
  onTocar,
  onSortear,
}: {
  card: DeporteElegido
  names: readonly string[]
  pendiente: number | null
  onTocar: (i: number) => void
  onSortear: () => void
}) {
  const deporte = sportLabel(card.kind)
  const { parejas, sueltos } = agruparChips(names, card.pairs)
  return (
    <section aria-label={`Parejas de ${deporte}`} className="flex flex-col gap-2">
      <p className={AYUDA}>{`${deporte} · Juegan juntas todo el torneo. La tabla de ${deporte} va a ser por pareja.`}</p>
      {parejas.map(({ numero, jugadores }) => {
        const pareja = jugadores.map((jugador) => jugador.nombre).join(' & ')
        return (
          <button
            key={numero}
            type="button"
            aria-label={`${pareja}, pareja ${numero}. Tocá para separarlas.`}
            onClick={() => onTocar(jugadores[0]!.indice)}
            className={`${FILA} flex min-h-[52px] items-center justify-between gap-3 px-4 py-3 text-left`}
          >
            <span className="min-w-0 break-words text-[15px] font-extrabold leading-tight">{pareja}</span>
            <span className="shrink-0 rounded-full bg-chip px-2 py-[3px] text-[12px] font-extrabold text-muted">
              {`pareja ${numero}`}
            </span>
          </button>
        )
      })}
      {sueltos.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {sueltos.map(({ indice, nombre }) => {
              const esperando = pendiente === indice
              return (
                <button
                  key={indice}
                  type="button"
                  aria-pressed={esperando}
                  aria-label={esperando ? `${nombre}, esperando pareja` : `${nombre}, sin pareja`}
                  onClick={() => onTocar(indice)}
                  className={`${CHIP} border-[1.5px] bg-surface ${
                    esperando ? 'border-accent text-accent-link' : 'border-line text-text'
                  }`}
                >
                  {esperando ? `${nombre} · esperando` : nombre}
                </button>
              )
            })}
          </div>
          <p className="text-pretty text-[12.5px] font-bold text-muted">
            {`Faltan emparejar ${sueltos.length}. Tocá a dos para juntarlas; tocá una pareja para separarla.`}
          </p>
        </>
      )}
      <button
        type="button"
        onClick={onSortear}
        className="min-h-[44px] text-center text-[14px] font-extrabold text-accent-link"
      >
        Sortear parejas
      </button>
    </section>
  )
}

interface Arrastre {
  from: number
  to: number
  startY: number
  dy: number
  /** Las filas medidas al agarrar: de acá sale `to` (`filaDestino`) y cuánto se corren las otras. */
  rows: Array<{ top: number; height: number }>
}

/**
 * "Ordená por nivel" de UN deporte (docs/torneos-deportes.md §4, mockup 3b): se arrastra del asa `⋮⋮`
 * (pointer events: mouse, touch y lápiz) y también con ↑/↓, la alternativa sin arrastre y la única con
 * teclado (WCAG 2.5.7). Con parejas fijas cada fila es una pareja. Controlada: `onMover(from, to)`.
 */
export function OrdenarPorNivel({
  card,
  names,
  onMover,
}: {
  card: DeporteElegido
  names: readonly string[]
  onMover: (from: number, to: number) => void
}) {
  const deporte = sportLabel(card.kind)
  const { pairSize, fixedTeams } = modalityShape(card.modality)
  const filas = ordenInicial(card, names.length).map((unit) => ({
    unit,
    jugadores: (fixedTeams ? (card.pairs[unit] ?? []) : [unit]).map((at) => names[at] ?? ''),
  }))
  const refs = useRef<Array<HTMLLIElement | null>>([])
  const [arrastre, setArrastre] = useState<Arrastre | null>(null)

  const agarrar = (from: number) => (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    // ponytail: medidas de cuando se agarra; un scroll a mitad del arrastre las corre (6-20 filas entran sin scrollear).
    const rows = filas.map((_, at) => {
      const rect = refs.current[at]?.getBoundingClientRect()
      return { top: rect?.top ?? 0, height: rect?.height ?? 0 }
    })
    setArrastre({ from, to: from, startY: event.clientY, dy: 0, rows })
  }
  const mover = (event: PointerEvent<HTMLSpanElement>) => {
    if (arrastre === null) return
    setArrastre({ ...arrastre, dy: event.clientY - arrastre.startY, to: filaDestino(arrastre.rows, arrastre.from, event.clientY) })
  }
  const soltar = (event: PointerEvent<HTMLSpanElement>) => {
    if (arrastre === null) return
    const to = filaDestino(arrastre.rows, arrastre.from, event.clientY)
    setArrastre(null)
    if (to !== arrastre.from) onMover(arrastre.from, to)
  }

  // La fila agarrada sigue al dedo; las que están entre `from` y `to` se corren un lugar para hacerle hueco.
  const corrimiento = (at: number): number => {
    if (arrastre === null) return 0
    const { from, to, dy, rows } = arrastre
    if (at === from) return dy
    const gap = rows.length > 1 ? rows[1]!.top - rows[0]!.top - rows[0]!.height : 0
    const lugar = rows[from]!.height + gap
    if (from < at && at <= to) return -lugar
    if (to <= at && at < from) return lugar
    return 0
  }
  // Y los números ya dicen cómo queda si se suelta acá.
  const lugares = arrastre === null ? null : moverEnOrden(filas.map((_, at) => at), arrastre.from, arrastre.to)

  return (
    <section aria-label={`Orden de ${deporte}`} className="flex flex-col gap-2">
      <p className={AYUDA}>
        {`${deporte} · Arriba el que mejor juega. Sólo arma ${pairSize === 2 && !fixedTeams ? 'las parejas de ' : ''}la primera fecha: después manda la tabla.`}
      </p>
      <ol className="flex select-none flex-col gap-2">
        {filas.map(({ unit, jugadores }, position) => {
          const nombre = jugadores.join(' & ')
          const agarrada = arrastre?.from === position
          const offset = corrimiento(position)
          return (
            <li
              key={unit}
              ref={(row) => {
                refs.current[position] = row
              }}
              style={offset === 0 ? undefined : { transform: `translateY(${offset}px)` }}
              className={`${FILA} flex items-center gap-2 py-1 pl-3 pr-1 ${
                agarrada
                  ? 'relative z-10 border-accent shadow-[0_10px_24px_var(--color-scrim)]'
                  : arrastre !== null
                    ? 'transition-transform duration-150'
                    : ''
              }`}
            >
              <span className="w-4 shrink-0 text-center text-[13px] font-extrabold text-muted">{(lugares?.indexOf(position) ?? position) + 1}</span>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-chip text-[12px] font-extrabold text-muted">
                {jugadores.length === 1 ? initials(nombre) : jugadores.map((jugador) => initials(jugador)[0] ?? '').join('')}
              </span>
              <span className="min-w-0 flex-1 break-words text-[15px] font-extrabold leading-tight">{nombre}</span>
              <button
                type="button"
                aria-label={`Subir a ${nombre}`}
                disabled={position === 0}
                onClick={() => onMover(position, position - 1)}
                className={FLECHA}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Bajar a ${nombre}`}
                disabled={position === filas.length - 1}
                onClick={() => onMover(position, position + 1)}
                className={FLECHA}
              >
                ↓
              </button>
              {/* Sólo el asa frena el scroll táctil: el resto de la fila deja scrollear la página. */}
              <span
                aria-hidden="true"
                onPointerDown={agarrar(position)}
                onPointerMove={mover}
                onPointerUp={soltar}
                onPointerCancel={() => setArrastre(null)}
                className="flex h-11 w-11 shrink-0 cursor-grab touch-none items-center justify-center text-[17px] font-extrabold tracking-[-.2em] text-muted"
              >
                ⋮⋮
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
