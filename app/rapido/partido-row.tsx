'use client'

import { useState } from 'react'
import type { Deporte, Partido } from './rapido-state'
import { BotonesDelPerdedor } from '@/app/torneo/[id]/[disciplina]/fechas/[n]/botones-del-perdedor'
import {
  esPartida,
  formatoRapido,
  marcadorDeDosToques,
  marcadorDePartida,
  marcadorDeVentaja,
  nombreLado,
  partidaDelMarcador,
  toqueDelMarcador,
  unidadDe,
  type Lado,
  type ToquePartida,
} from './jugar-logic'

const PREGUNTA = 'mt-3.5 mb-2.5 text-[17px] font-bold'

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
  deporte,
  destella = false,
  onAbrir,
}: {
  indice: number
  partido: Partido
  jugadores: string[]
  /** El ajedrez anota las tablas como ½ y ½. */
  deporte: Deporte
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

  // Una partida en tablas se anota ½ y ½, como en ajedrez; el resto, el número.
  const tablas = esPartida(deporte) && partidaDelMarcador(marcador) === 'tablas'
  const texto = (n: number) => (tablas ? '½' : String(n))
  const fila = (lado: Lado) => {
    const propio = lado === 'a' ? marcador.a : marcador.b
    const ajeno = lado === 'a' ? marcador.b : marcador.a
    const perdio = propio < ajeno
    return (
      <span className="flex items-center justify-between gap-2">
        <span className={`min-w-0 text-[17px] ${perdio ? 'font-medium text-muted' : 'font-bold text-text'}`}>
          {lado === 'a' ? nombreA : nombreB}
        </span>
        <span className={`font-cond shrink-0 text-[32px] ${perdio ? 'text-muted' : 'text-text'}`}>{texto(propio)}</span>
      </span>
    )
  }

  return (
    <button
      id={`partido-${indice}`}
      type="button"
      aria-label={`Corregir ${nombreA} ${texto(marcador.a)}, ${nombreB} ${texto(marcador.b)}`}
      onClick={onAbrir}
      className={`press-fila flex min-h-[76px] w-full flex-col gap-1.5 rounded-tile border-[1.5px] border-line px-4 py-3 text-left${destello}`}
    >
      {fila('a')}
      {fila('b')}
    </button>
  )
}

/**
 * El contenido de la hoja de un partido: la carga en dos toques, con los
 * mismos botones que la carga de una fecha (`BotonesDelPerdedor`). Quién ganó,
 * y con cuántos se quedó el que perdió; el segundo toque guarda. El ganador
 * se lleva el objetivo entero, o lo de un botón de ventaja (7-5, 7-6, 12-10,
 * 16-14) donde el deporte lo deja (`formatoRapido`), así que nada de lo que
 * sale de acá lo puede rechazar `cargarMarcador`, y en la pantalla no existe
 * el empate: ninguno de estos deportes empata.
 *
 * Un partido cargado abre con lo que tiene (`toqueDelMarcador`): el ganador
 * elegido y su botón marcado, así corregir es un toque. Cambiar de ganador
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
  if (esPartida(deporte)) return <HojaPartida partido={partido} jugadores={jugadores} onGuardar={onGuardar} />
  return <HojaDosToques partido={partido} jugadores={jugadores} deporte={deporte} onGuardar={onGuardar} />
}

/**
 * La partida de ajedrez (odd/tasks/mas-deportes.md S3): "Ganó Ana", "Tablas",
 * "Ganó Beto", como la hoja de una fecha, y el toque guarda (1-0, 0-1 o 0-0).
 * Una partida cargada abre con su toque marcado.
 */
function HojaPartida({
  partido,
  jugadores,
  onGuardar,
}: {
  partido: Partido
  jugadores: string[]
  onGuardar: (a: number, b: number) => void
}) {
  const [elegido, setElegido] = useState<ToquePartida | null>(() => partidaDelMarcador(partido.marcador))
  const opciones: { toque: ToquePartida; texto: string }[] = [
    { toque: 'a', texto: `Ganó ${nombreLado(jugadores, partido.a)}` },
    { toque: 'tablas', texto: 'Tablas' },
    { toque: 'b', texto: `Ganó ${nombreLado(jugadores, partido.b)}` },
  ]
  return (
    <div>
      <p className={PREGUNTA}>¿Cómo terminó?</p>
      <div className="flex flex-col gap-2.5">
        {opciones.map(({ toque, texto }) => (
          <button
            key={toque}
            type="button"
            aria-pressed={elegido === toque}
            onClick={() => {
              setElegido(toque)
              const { a, b } = marcadorDePartida(toque)
              onGuardar(a, b)
            }}
            className={`flex min-h-[64px] items-center justify-between gap-3 rounded-btn px-[18px] text-left text-[19px] font-bold ${
              elegido === toque
                ? 'bg-block text-on-block'
                : 'bg-opcion text-text shadow-[inset_0_0_0_1.5px_var(--color-opcion-borde)]'
            }`}
          >
            <span className="min-w-0">{texto}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className={`h-6 w-6 shrink-0 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round] ${
                elegido === toque ? '' : 'invisible'
              }`}
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </button>
        ))}
      </div>
      <p aria-live="polite" className="mt-2.5 min-h-5 text-[15px] text-muted">
        Con un toque se guarda.
      </p>
    </div>
  )
}

function HojaDosToques({
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
  const [elegido, setElegido] = useState<{ loser: number; deuce: boolean } | null>(
    previo.perdedor === null ? null : { loser: previo.perdedor, deuce: previo.ventaja },
  )

  const nombreDe = (lado: Lado) => nombreLado(jugadores, lado === 'a' ? partido.a : partido.b)
  const perdedor = ganador === null ? null : nombreDe(ganador === 'a' ? 'b' : 'a')

  const guardar = (puntos: number, deuce: boolean) => {
    if (ganador === null) return
    setElegido({ loser: puntos, deuce })
    const marcador = deuce ? marcadorDeVentaja(ganador, puntos, deporte) : marcadorDeDosToques(ganador, puntos, deporte)
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
      <BotonesDelPerdedor
        format={formatoRapido(deporte)}
        unit={unidadDe(deporte)}
        loserName={perdedor}
        pending={false}
        elegido={elegido}
        onLoser={(puntos) => guardar(puntos, false)}
        onDeuce={(puntos) => guardar(puntos, true)}
      />
      <p aria-live="polite" className="mt-2.5 min-h-5 text-[15px] text-muted">
        {ganador === null ? 'Tocá primero quién ganó.' : 'Con este toque se guarda.'}
      </p>
    </div>
  )
}
