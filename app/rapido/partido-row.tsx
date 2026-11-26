'use client'

import { useState } from 'react'
import type { Deporte, Partido } from './rapido-state'
import {
  marcadorDeDosToques,
  nombreLado,
  puntosDelPerdedor,
  toqueDelMarcador,
  unidadDe,
  type Lado,
} from './jugar-logic'

const PREGUNTA = 'mt-3.5 mb-2.5 text-[17px] font-bold'
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * Un partido de la lista, con la cara de la carga de una fecha
 * (`TarjetaPartido`): sin marcador es el bloque tintado con "Cargar"; con
 * marcador, las dos filas con el ganador en tinta y el perdedor apagado. Las
 * dos son un botón entero que abre la hoja (`HojaPartido`): sin el toque
 * extra de abrir un panel, y lo cargado se corrige tocándolo.
 *
 * El `id` es para "Siguiente": el foco va a la tarjeta antes de abrir la
 * hoja, así al cerrarla vuelve ahí. `destella`: es la recién guardada.
 */
export function TarjetaPartido({
  indice,
  partido,
  jugadores,
  destella = false,
  onAbrir,
}: {
  indice: number
  partido: Partido
  jugadores: string[]
  destella?: boolean
  onAbrir: () => void
}) {
  const destello = destella ? ' destello' : ''
  const nombreA = nombreLado(jugadores, partido.a)
  const nombreB = nombreLado(jugadores, partido.b)
  const marcador = partido.marcador

  if (marcador === null) {
    return (
      <button
        id={`partido-${indice}`}
        type="button"
        aria-label={`Cargar ${nombreA} contra ${nombreB}`}
        onClick={onAbrir}
        className={`flex min-h-[84px] w-full items-center gap-3 rounded-tile bg-sport-tint py-3 pr-3.5 pl-4 text-left active:bg-opcion${destello}`}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-[17px] font-semibold text-text">{nombreA}</span>
          <span className="text-[13px] leading-none font-semibold text-muted">contra</span>
          <span className="text-[17px] font-semibold text-text">{nombreB}</span>
        </span>
        <span className="flex h-10 shrink-0 items-center rounded-pill bg-block px-3.5 text-[15px] font-bold text-on-block">
          Cargar
        </span>
      </button>
    )
  }

  const fila = (lado: Lado) => {
    const propio = lado === 'a' ? marcador.a : marcador.b
    const ajeno = lado === 'a' ? marcador.b : marcador.a
    const perdio = propio < ajeno
    return (
      <span className="flex items-center justify-between gap-2">
        <span className={`min-w-0 text-[17px] ${perdio ? 'font-medium text-muted' : 'font-bold text-text'}`}>
          {lado === 'a' ? nombreA : nombreB}
        </span>
        <span className={`font-cond shrink-0 text-[32px] ${perdio ? 'text-muted' : 'text-text'}`}>{propio}</span>
      </span>
    )
  }

  return (
    <button
      id={`partido-${indice}`}
      type="button"
      aria-label={`Corregir ${nombreA} ${marcador.a}, ${nombreB} ${marcador.b}`}
      onClick={onAbrir}
      className={`press-fila flex min-h-[76px] w-full flex-col gap-1.5 rounded-tile border-[1.5px] border-line px-4 py-3 text-left${destello}`}
    >
      {fila('a')}
      {fila('b')}
    </button>
  )
}

/**
 * El contenido de la hoja de un partido: la carga en dos toques, el mismo
 * patrón que la carga de una fecha. Quién ganó, y con cuántos se quedó el que
 * perdió, de una lista acotada de botones; el segundo toque guarda. El
 * ganador siempre se lleva el objetivo entero (`marcadorDeDosToques`), así que
 * nada de lo que sale de acá lo puede rechazar `cargarMarcador`, y en la
 * pantalla no existe el empate: ni el pádel ni el ping pong empatan.
 *
 * Un partido cargado abre con lo que tiene (`toqueDelMarcador`): el ganador
 * elegido y su número marcado, así corregir es un toque. Cambiar de ganador
 * suelta el número. Va montada con `key` por apertura: cada vez arranca de lo
 * que dice el partido, no de un intento anterior.
 */
export function HojaPartido({
  partido,
  jugadores,
  deporte,
  onGuardar,
}: {
  partido: Partido
  jugadores: string[]
  deporte: Deporte
  onGuardar: (a: number, b: number) => void
}) {
  const previo = toqueDelMarcador(partido.marcador, deporte)
  const [ganador, setGanador] = useState<Lado | null>(previo.ganador)
  const [elegido, setElegido] = useState<number | null>(previo.perdedor)

  const nombreDe = (lado: Lado) => nombreLado(jugadores, lado === 'a' ? partido.a : partido.b)
  const perdedor = ganador === null ? null : nombreDe(ganador === 'a' ? 'b' : 'a')
  const opciones = puntosDelPerdedor(deporte)
  const unidad = unidadDe(deporte)

  const elegirPuntos = (puntos: number) => {
    if (ganador === null) return
    setElegido(puntos)
    const marcador = marcadorDeDosToques(ganador, puntos, deporte)
    onGuardar(marcador.a, marcador.b)
  }

  return (
    <div>
      <p className={PREGUNTA}>Ganó</p>
      <div className="flex flex-col gap-2.5">
        {(['a', 'b'] as const).map((lado) => (
          <button
            key={lado}
            type="button"
            aria-pressed={ganador === lado}
            onClick={() => {
              if (ganador !== lado) setElegido(null)
              setGanador(lado)
            }}
            className={`flex min-h-[64px] items-center justify-between gap-3 rounded-btn px-[18px] text-left text-[19px] font-bold ${
              ganador === lado
                ? 'bg-block text-on-block'
                : 'bg-opcion text-text shadow-[inset_0_0_0_1.5px_var(--color-opcion-borde)]'
            }`}
          >
            <span className="min-w-0">{nombreDe(lado)}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className={`h-6 w-6 shrink-0 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round] ${
                ganador === lado ? '' : 'invisible'
              }`}
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </button>
        ))}
      </div>
      {/* Nombra al que perdió, no "el perdedor": es lo que confirma qué se
          tocó recién. Sin ganador los números se ven pero no se tocan: la
          hoja no salta de alto entre un toque y otro. */}
      <p className={PREGUNTA}>{perdedor === null ? `${cap(unidad)} del que perdió` : `${cap(unidad)} de ${perdedor}`}</p>
      <div className={`grid gap-2 ${opciones.length <= 4 ? 'grid-cols-4' : 'grid-cols-6'}`}>
        {opciones.map((puntos) => {
          const activo = elegido === puntos
          return (
            <button
              key={puntos}
              type="button"
              disabled={ganador === null}
              aria-pressed={activo}
              onClick={() => elegirPuntos(puntos)}
              className={`font-cond flex min-h-[60px] items-center justify-center rounded-btn border-[1.5px] text-[30px] ${
                activo ? 'border-block bg-block text-on-block' : 'border-line text-text active:bg-sport-tint'
              }`}
            >
              {puntos}
            </button>
          )
        })}
      </div>
      <p aria-live="polite" className="mt-2.5 min-h-5 text-[15px] text-muted">
        {ganador === null ? 'Tocá primero quién ganó.' : 'Con este toque se guarda.'}
      </p>
    </div>
  )
}
