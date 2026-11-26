'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'
import {
  ARMADO_INICIAL,
  DEPORTE_LABEL,
  DEPORTE_OBJETIVO,
  DEPORTES,
  VOLVER_INICIO,
  armadoWarning,
  esBowling,
  type Armado,
  type Modalidad,
  type ModoParejas,
} from './rapido-state'
import { agruparChips, enterEnJugador, nombresValidos, seCaenLasParejas, tocarJugador } from './armar-state'
import { unidadDe } from './jugar-logic'

const MODALIDADES: Modalidad[] = ['INDIVIDUAL', 'PAREJAS']
const MODALIDAD_LABEL: Record<Modalidad, string> = { INDIVIDUAL: 'Individual', PAREJAS: 'Parejas' }

const MODOS_PAREJAS: ModoParejas[] = ['FIJAS', 'SORTEADAS', 'ROTATIVAS']
const MODO_PAREJAS_LABEL: Record<ModoParejas, string> = {
  FIJAS: 'Fijas',
  SORTEADAS: 'Sorteadas',
  ROTATIVAS: 'Rotativas',
}
/** La segunda línea de cada modo: qué pasa, en dos o tres palabras. */
const MODO_PAREJAS_SUB: Record<ModoParejas, string> = {
  FIJAS: 'Las armás vos',
  SORTEADAS: 'Al azar',
  ROTATIVAS: 'Cada ronda',
}

const PREGUNTA = 'font-titulo text-[22px]'
const CAMPO =
  'min-h-[56px] w-full min-w-0 rounded-btn border-[1.5px] border-line bg-surface-2 px-4 text-[16px] font-semibold text-text placeholder:font-normal placeholder:text-muted focus:border-sport'

// Arranca con 4 casilleros vacíos: es lo que pide el modo por default
// (PAREJAS + SORTEADAS), así el primer vistazo ya muestra qué falta en vez
// de una lista en blanco sin ninguna pista.
const ARMADO_SEED: Armado = { ...ARMADO_INICIAL, jugadores: ['', '', '', ''] }

/**
 * Un grupo de opciones excluyentes (Deporte, Modalidad, Parejas), con la
 * cara de las opciones de la hoja de carga: tinte sin elegir, bloque elegida.
 *
 * El título lo dibuja el propio grupo y lo ata con `aria-labelledby`: sin eso
 * el lector de pantalla anuncia "Pádel, button. Ping pong, button." y no hay
 * forma de saber de qué es la pregunta. Y `aria-pressed` es lo que dice cuál
 * está elegida — el color solo no alcanza.
 */
function Opciones<T extends string>({
  titulo,
  opciones,
  etiqueta,
  sub,
  valor,
  onChange,
}: {
  titulo: string
  opciones: readonly T[]
  etiqueta: (opcion: T) => string
  sub?: (opcion: T) => string
  valor: T
  onChange: (opcion: T) => void
}) {
  const idTitulo = useId()
  return (
    <div className="px-4 pt-6">
      <h2 id={idTitulo} className={PREGUNTA}>
        {titulo}
      </h2>
      <div role="group" aria-labelledby={idTitulo} className="mt-3 flex gap-2">
        {opciones.map((opcion) => {
          const elegida = opcion === valor
          return (
            <button
              key={opcion}
              type="button"
              aria-pressed={elegida}
              onClick={() => onChange(opcion)}
              className={`flex min-h-[56px] min-w-0 flex-1 flex-col items-center justify-center rounded-btn px-2 py-2 text-center ${
                elegida
                  ? 'bg-block text-on-block'
                  : 'bg-opcion text-text shadow-[inset_0_0_0_1.5px_var(--color-opcion-borde)]'
              }`}
            >
              <span className="text-[17px] font-bold">{etiqueta(opcion)}</span>
              {sub !== undefined && (
                <span className={`text-[14px] leading-tight ${elegida ? 'text-on-block-soft' : 'text-muted'}`}>
                  {sub(opcion)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StepperRondas({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const boton =
    'flex h-12 w-12 shrink-0 items-center justify-center rounded-btn bg-opcion text-[24px] font-bold text-text shadow-[inset_0_0_0_1.5px_var(--color-opcion-borde)]'
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Una ronda menos"
        className={boton}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span aria-live="polite" className="font-cond w-12 text-center text-[40px]">
        {value}
      </span>
      <button
        type="button"
        aria-label="Una ronda más"
        className={boton}
        disabled={value >= 12}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  )
}

/**
 * Armado del torneo, la primera pantalla de `/rapido`: deporte, cómo se
 * juega, los nombres y "Empezar", la única acción principal, abajo y siempre
 * a la vista. Apagada, dice arriba qué falta (`armadoWarning`).
 *
 * Los nombres se cargan sin soltar el teclado: Enter pasa al siguiente y, en
 * el último, agrega otro (`enterEnJugador`).
 *
 * Guarda el `Armado` completo en un solo `useState` local: no hace falta
 * levantarlo a `page.tsx` porque nada afuera de esta pantalla lo necesita
 * hasta que se aprieta "Empezar". `aviso` es el de `page.tsx` cuando el
 * navegador no deja guardar: va debajo del encabezado.
 */
export function Armar({ onEmpezar, aviso }: { onEmpezar: (armado: Armado) => void; aviso?: ReactNode }) {
  const [armado, setArmado] = useState<Armado>(ARMADO_SEED)
  // Sólo importa para FIJAS: el jugador tocado que espera su pareja. No es
  // parte de `Armado` porque no significa nada una vez armado el torneo.
  const [pendiente, setPendiente] = useState<number | null>(null)
  const campos = useRef<Array<HTMLInputElement | null>>([])
  // El casillero que tiene que quedar enfocado cuando la lista termine de
  // dibujarse (el que agregó Enter o "Agregar jugador" todavía no existe).
  const enfocar = useRef<number | null>(null)
  const faltaId = useId()

  useEffect(() => {
    if (enfocar.current === null) return
    campos.current[enfocar.current]?.focus()
    enfocar.current = null
  })

  /**
   * El único camino por el que cambia la lista de nombres, y por eso el único
   * que decide si las parejas fijas sobreviven. La regla es `seCaenLasParejas`
   * y vive en `armar-state.ts`, donde un test la mira: acá adentro se resetaba
   * de más —agregar un casillero VACÍO borraba las cuatro parejas ya armadas,
   * sin avisar y sin poder deshacerlo— y ningún test podía verlo.
   */
  const cambiarJugadores = (siguientes: string[]) => {
    const seCaen = seCaenLasParejas(armado.jugadores, siguientes)
    setArmado({
      ...armado,
      jugadores: siguientes,
      parejasManuales: seCaen ? [] : armado.parejasManuales,
    })
    if (seCaen) setPendiente(null)
  }

  const alEnter = (indice: number) => {
    const { jugadores, foco } = enterEnJugador(armado.jugadores, indice)
    if (foco === null) {
      // No hay adónde ir: se cierra el teclado y queda a la vista "Empezar".
      campos.current[indice]?.blur()
      return
    }
    if (jugadores.length !== armado.jugadores.length) {
      enfocar.current = foco
      cambiarJugadores(jugadores)
    } else {
      campos.current[foco]?.focus()
    }
  }

  const agregar = () => {
    enfocar.current = armado.jugadores.length
    cambiarJugadores([...armado.jugadores, ''])
  }

  const elegirModoParejas = (modoParejas: ModoParejas) => {
    setArmado({ ...armado, modoParejas, parejasManuales: [] })
    setPendiente(null)
  }

  const tocar = (indice: number) => {
    const resultado = tocarJugador(armado.parejasManuales, pendiente, indice)
    setArmado({ ...armado, parejasManuales: resultado.pares })
    setPendiente(resultado.pendiente)
  }

  const jugadoresFiltrados = nombresValidos(armado.jugadores)
  const chips = agruparChips(jugadoresFiltrados, armado.parejasManuales)
  const warning = armadoWarning(armado)
  const bowling = esBowling(armado)
  const listo = warning === null

  return (
    <div data-deporte={armado.deporte} className="flex flex-1 flex-col">
      <Hero
        back={VOLVER_INICIO}
        title="Torneo rápido"
        subtitle="Sin cuenta. Queda guardado en este teléfono."
        sport={armado.deporte}
      />
      {aviso}

      <Opciones
        titulo="Deporte"
        opciones={DEPORTES}
        etiqueta={(deporte) => DEPORTE_LABEL[deporte]}
        // Bowling no se juega "a" nada: cada uno carga su total (S4).
        sub={(deporte) => (deporte === 'BOWLING' ? 'Cada uno su total' : `A ${DEPORTE_OBJETIVO[deporte]} ${unidadDe(deporte)}`)}
        valor={armado.deporte}
        onChange={(deporte) => setArmado({ ...armado, deporte })}
      />

      {/* Bowling se juega de a uno: no hay modalidad ni parejas que elegir. */}
      {!bowling && (
        <Opciones
          titulo="Cómo se juega"
          opciones={MODALIDADES}
          etiqueta={(modalidad) => MODALIDAD_LABEL[modalidad]}
          valor={armado.modalidad}
          onChange={(modalidad) => setArmado({ ...armado, modalidad })}
        />
      )}

      {!bowling && armado.modalidad === 'PAREJAS' && (
        <Opciones
          titulo="Parejas"
          opciones={MODOS_PAREJAS}
          etiqueta={(modo) => MODO_PAREJAS_LABEL[modo]}
          sub={(modo) => MODO_PAREJAS_SUB[modo]}
          valor={armado.modoParejas}
          onChange={elegirModoParejas}
        />
      )}

      {!bowling && armado.modalidad === 'PAREJAS' && armado.modoParejas === 'ROTATIVAS' && (
        <div className="mx-4 mt-3 flex min-h-[64px] items-center justify-between gap-3 rounded-tile bg-surface py-2 pr-2 pl-4">
          <span className="text-[17px] font-bold">Rondas</span>
          <StepperRondas value={armado.rondas} onChange={(rondas) => setArmado({ ...armado, rondas })} />
        </div>
      )}

      <section className="px-4 pt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={PREGUNTA}>Jugadores</h2>
          <span className="font-cond text-[32px] text-sport">
            {jugadoresFiltrados.length}
            <span className="sr-only"> con nombre</span>
          </span>
        </div>
        <ol className="mt-3 flex flex-col gap-2">
          {armado.jugadores.map((nombre, indice) => (
            <li key={indice} className="flex items-center gap-1">
              <span aria-hidden="true" className="font-cond w-7 shrink-0 text-[22px] text-muted">
                {indice + 1}
              </span>
              <input
                ref={(el) => {
                  campos.current[indice] = el
                }}
                value={nombre}
                aria-label={`Jugador ${indice + 1}`}
                enterKeyHint="next"
                autoCapitalize="words"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) =>
                  cambiarJugadores(armado.jugadores.map((actual, i) => (i === indice ? event.target.value : actual)))
                }
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  alEnter(indice)
                }}
                placeholder="Nombre"
                className={CAMPO}
              />
              <button
                type="button"
                // Por nombre y no por posición: al sacar una fila del medio las
                // etiquetas se corren y el lector termina anunciando a otro.
                aria-label={nombre.trim() ? `Sacar a ${nombre.trim()}` : `Sacar al jugador ${indice + 1}`}
                onClick={() => cambiarJugadores(armado.jugadores.filter((_, i) => i !== indice))}
                className="flex h-12 w-11 shrink-0 items-center justify-center rounded-btn text-muted active:bg-sport-tint"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-5 w-5 fill-none stroke-current stroke-2 [stroke-linecap:round]"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ol>
        <button type="button" onClick={agregar} className={`${button('ghost')} mt-1 -ml-2`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-2 [stroke-linecap:round]">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Agregar jugador
        </button>
      </section>

      {!bowling && armado.modalidad === 'PAREJAS' && armado.modoParejas === 'FIJAS' && (
        <section className="px-4 pt-6">
          <h2 className={PREGUNTA}>Armá las parejas</h2>
          <p className="mt-1 text-[15px] text-muted">Tocá dos nombres para juntarlos. Otro toque los separa.</p>
          {/* Cada pareja en su propia fila y con su número. Todos los chips
              pintados del mismo color no decían quién quedó con quién. El
              número también es lo que hace que el estado no dependa sólo del
              color, ni para un daltónico ni para un lector de pantalla. */}
          <div className="mt-3 flex flex-col gap-2">
            {chips.parejas.map(({ numero, jugadores }) => (
              <div key={numero} className="flex items-center gap-2">
                <span className="font-cond w-7 shrink-0 text-[26px] text-sport">
                  <span className="sr-only">Pareja </span>
                  {numero}
                </span>
                {jugadores.map(({ indice, nombre }) => (
                  <button
                    key={indice}
                    type="button"
                    aria-pressed={true}
                    aria-label={`${nombre}, pareja ${numero}`}
                    onClick={() => tocar(indice)}
                    className="flex min-h-[48px] min-w-0 flex-1 items-center justify-center rounded-btn bg-block px-3 text-[16px] font-bold text-on-block"
                  >
                    <span className="truncate">{nombre}</span>
                  </button>
                ))}
              </div>
            ))}

            {chips.sueltos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {chips.sueltos.map(({ indice, nombre }) => {
                  const esperando = pendiente === indice
                  return (
                    <button
                      key={indice}
                      type="button"
                      aria-pressed={esperando}
                      aria-label={esperando ? `${nombre}, esperando pareja` : `${nombre}, sin pareja`}
                      onClick={() => tocar(indice)}
                      className={`flex min-h-[48px] items-center justify-center rounded-btn px-4 text-[16px] font-bold ${
                        esperando
                          ? 'bg-surface-2 text-sport shadow-[inset_0_0_0_2.5px_var(--color-sport)]'
                          : 'bg-opcion text-text shadow-[inset_0_0_0_1.5px_var(--color-opcion-borde)]'
                      }`}
                    >
                      {nombre}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      )}

      <label className="block px-4 pt-6 pb-6">
        <span className={`${PREGUNTA} block`}>
          Nombre <span className="font-sans text-[15px] font-normal text-muted">opcional</span>
        </span>
        <input
          value={armado.nombre}
          onChange={(event) => setArmado({ ...armado, nombre: event.target.value })}
          placeholder="Torneo del jueves"
          enterKeyHint="done"
          autoComplete="off"
          className={`${CAMPO} mt-3`}
        />
      </label>

      {/* La barra de abajo: "Empezar" siempre a la vista. Incompleto no se
          atenúa (la opacidad de `:disabled` es "el sistema está trabajando"):
          se apaga con color, legible, con la razón arriba. */}
      <div className="sticky bottom-0 mt-auto border-t border-line bg-bg px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        {!listo && (
          <p id={faltaId} className="mb-2.5 text-[15px] font-semibold text-muted">
            {warning}
          </p>
        )}
        <button
          type="button"
          disabled={!listo}
          aria-describedby={listo ? undefined : faltaId}
          onClick={() => onEmpezar(armado)}
          className={
            listo
              ? button('primary', { size: 'lg', full: true })
              : 'flex min-h-[56px] w-full items-center justify-center rounded-btn bg-chip px-5 text-[17px] font-bold text-muted disabled:opacity-100'
          }
        >
          Empezar
        </button>
      </div>
    </div>
  )
}
