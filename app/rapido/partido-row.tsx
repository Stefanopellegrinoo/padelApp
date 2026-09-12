'use client'

import { useState } from 'react'
import type { Deporte, Partido } from './rapido-state'
import { marcadorDeDosToques, nombreLado, puntosDelPerdedor, type Lado } from './jugar-logic'

interface PartidoRowProps {
  partido: Partido
  jugadores: string[]
  deporte: Deporte
  onCargarMarcador: (a: number, b: number) => void
}

const TAP = 'min-h-[44px] rounded-field bg-chip px-3 text-[13.5px] font-extrabold'
const ROTULO = 'text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted'

/**
 * Una fila de partido y su carga en dos toques, el mismo patrón que ya usa la
 * carga de una fecha (`carga-state.ts`): quién ganó, y con cuántos se quedó el
 * que perdió, elegido de una lista acotada de botones. El ganador siempre se
 * lleva el objetivo entero.
 *
 * Antes eran dos `<input type="number">` libres que autoguardaban en cada
 * tecla. Con botones no hace falta parsear texto, ni poner un techo, ni pensar
 * qué pasa si alguien gira la rueda del mouse encima del input: nada de lo que
 * sale de acá puede ser rechazado por `cargarMarcador`. Es la promesa de la
 * home, textual: "Cargás el resultado en dos toques, sin teclado".
 *
 * Un partido ya cargado muestra su marcador y vuelve a abrir el panel al
 * tocarlo. Corregir es cargarlo de nuevo, así que no hace falta ningún
 * "borrar": el segundo toque pisa lo que había.
 *
 * En la pantalla no existe el empate — ni el pádel ni el ping pong empatan.
 * `cargarMarcador` lo acepta por generalidad, pero acá no hay dos toques que
 * lo produzcan.
 */
export function PartidoRow({ partido, jugadores, deporte, onCargarMarcador }: PartidoRowProps) {
  const [abierto, setAbierto] = useState(false)
  const [ganador, setGanador] = useState<Lado | null>(null)

  const nombreA = nombreLado(jugadores, partido.a)
  const nombreB = nombreLado(jugadores, partido.b)

  // El botón de la fila es su propio cancelar: volver a tocarlo cierra el
  // panel y tira el ganador a medio elegir.
  const alternar = () => {
    setGanador(null)
    setAbierto(!abierto)
  }

  const elegirPuntos = (puntosPerdedor: number) => {
    if (ganador === null) return
    const marcador = marcadorDeDosToques(ganador, puntosPerdedor, deporte)
    onCargarMarcador(marcador.a, marcador.b)
    setGanador(null)
    setAbierto(false)
  }

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-3">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={abierto}
        className="flex min-h-[44px] items-center gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-bold">{nombreA}</span>
          <span className="block truncate text-[14.5px] font-bold text-muted">{nombreB}</span>
        </span>
        {partido.marcador === null ? (
          <span className="shrink-0 rounded-full bg-chip px-3 py-1.5 text-[12.5px] font-extrabold text-muted">
            Cargar
          </span>
        ) : (
          <span className="shrink-0 text-right text-[15px] font-extrabold tabular-nums">
            <span className="block">{partido.marcador.a}</span>
            <span className="block text-muted">{partido.marcador.b}</span>
          </span>
        )}
      </button>

      {abierto && (
        <div className="flex flex-col gap-2">
          {ganador === null ? (
            <>
              <p className={ROTULO}>¿Quién ganó?</p>
              <button type="button" className={TAP} onClick={() => setGanador('a')}>
                {nombreA}
              </button>
              <button type="button" className={TAP} onClick={() => setGanador('b')}>
                {nombreB}
              </button>
            </>
          ) : (
            <>
              {/* Nombra al que perdió, no "el perdedor": es lo único que
                  confirma qué se tocó recién, y el primer toque no se ve. */}
              <p className={ROTULO}>Puntos de {ganador === 'a' ? nombreB : nombreA}</p>
              <div className="flex flex-wrap gap-2">
                {puntosDelPerdedor(deporte).map((puntos) => (
                  <button
                    key={puntos}
                    type="button"
                    className={`${TAP} min-w-[44px] text-center tabular-nums`}
                    onClick={() => elegirPuntos(puntos)}
                  >
                    {puntos}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
