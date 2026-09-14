'use client'

import Link from 'next/link'
import { useId, useState } from 'react'
import {
  ARMADO_INICIAL,
  DEPORTE_LABEL,
  DEPORTES,
  armadoWarning,
  type Armado,
  type Modalidad,
  type ModoParejas,
} from './rapido-state'
import { agruparChips, nombresValidos, seCaenLasParejas, tocarJugador } from './armar-state'

const MODALIDADES: Modalidad[] = ['INDIVIDUAL', 'PAREJAS']
const MODALIDAD_LABEL: Record<Modalidad, string> = { INDIVIDUAL: 'Individual', PAREJAS: 'Parejas' }

const MODOS_PAREJAS: ModoParejas[] = ['FIJAS', 'SORTEADAS', 'ROTATIVAS']
const MODO_PAREJAS_LABEL: Record<ModoParejas, string> = {
  FIJAS: 'Fijas',
  SORTEADAS: 'Sorteadas',
  ROTATIVAS: 'Rotativas',
}

const ROTULO = 'text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted'
const CHIP =
  'flex min-h-[44px] items-center justify-center rounded-field px-3 text-[13.5px] font-extrabold'

// Arranca con 4 casilleros vacíos: es lo que pide el modo por default
// (PAREJAS + SORTEADAS), así el primer vistazo ya muestra qué falta en vez
// de una lista en blanco sin ninguna pista.
const ARMADO_SEED: Armado = { ...ARMADO_INICIAL, jugadores: ['', '', '', ''] }

function Aviso({ children }: { children: string }) {
  return (
    <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
      {children}
    </p>
  )
}

/**
 * Un grupo de opciones excluyentes (Deporte, Modalidad, Parejas).
 *
 * El título lo dibuja el propio grupo y lo ata con `aria-labelledby`: sin eso
 * el lector de pantalla anuncia "Pádel, button. Ping pong, button." y no hay
 * forma de saber de qué es la pregunta. Y `aria-pressed` es lo que dice cuál
 * está elegida — antes eso lo comunicaba SÓLO el color de fondo.
 */
function Opciones<T extends string>({
  titulo,
  opciones,
  etiqueta,
  valor,
  onChange,
}: {
  titulo: string
  opciones: readonly T[]
  etiqueta: (opcion: T) => string
  valor: T
  onChange: (opcion: T) => void
}) {
  const idTitulo = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <span id={idTitulo} className={ROTULO}>
        {titulo}
      </span>
      <div role="group" aria-labelledby={idTitulo} className="flex gap-2">
        {opciones.map((opcion) => (
          <button
            key={opcion}
            type="button"
            aria-pressed={opcion === valor}
            onClick={() => onChange(opcion)}
            className={`min-h-[44px] flex-1 rounded-field p-3 text-center text-[14px] font-extrabold ${
              opcion === valor ? 'bg-accent text-accent-text' : 'bg-chip text-text'
            }`}
          >
            {etiqueta(opcion)}
          </button>
        ))}
      </div>
    </div>
  )
}

function StepperRondas({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const boton = 'h-11 w-11 shrink-0 rounded-[9px] bg-chip text-[16px] font-extrabold disabled:opacity-40'
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Una ronda menos"
        className={boton}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span className="w-9 text-center text-[20px] font-extrabold tracking-[-.02em]">{value}</span>
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
 * Armado del torneo — la primera de las tres pantallas de `/rapido`.
 *
 * Guarda el `Armado` completo en un solo `useState` local: no hace falta
 * levantarlo a `page.tsx` porque nada afuera de esta pantalla lo necesita
 * hasta que se aprieta "Empezar".
 */
export function Armar({ onEmpezar }: { onEmpezar: (armado: Armado) => void }) {
  const [armado, setArmado] = useState<Armado>(ARMADO_SEED)
  // Sólo importa para FIJAS: el jugador tocado que espera su pareja. No es
  // parte de `Armado` porque no significa nada una vez armado el torneo.
  const [pendiente, setPendiente] = useState<number | null>(null)

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

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 pt-4 pb-[26px]">
      <div className="flex items-center justify-between">
        <Link href="/" className="rounded-full bg-chip px-[14px] py-2 text-[12.5px] font-bold">
          ← Inicio
        </Link>
      </div>

      <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Torneo rápido</h1>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
        <label className="flex flex-col gap-1.5">
          <span className={ROTULO}>Nombre (opcional)</span>
          <input
            value={armado.nombre}
            onChange={(event) => setArmado({ ...armado, nombre: event.target.value })}
            placeholder="Torneo del jueves"
            className="rounded-field border-[1.5px] border-line bg-surface p-[15px] text-[16px] font-[700] outline-none placeholder:font-medium placeholder:text-muted focus:border-accent"
          />
        </label>

        <Opciones
          titulo="Deporte"
          opciones={DEPORTES}
          etiqueta={(deporte) => DEPORTE_LABEL[deporte]}
          valor={armado.deporte}
          onChange={(deporte) => setArmado({ ...armado, deporte })}
        />

        <Opciones
          titulo="Modalidad"
          opciones={MODALIDADES}
          etiqueta={(modalidad) => MODALIDAD_LABEL[modalidad]}
          valor={armado.modalidad}
          onChange={(modalidad) => setArmado({ ...armado, modalidad })}
        />

        {armado.modalidad === 'PAREJAS' && (
          <Opciones
            titulo="Parejas"
            opciones={MODOS_PAREJAS}
            etiqueta={(modo) => MODO_PAREJAS_LABEL[modo]}
            valor={armado.modoParejas}
            onChange={elegirModoParejas}
          />
        )}

        {armado.modalidad === 'PAREJAS' && armado.modoParejas === 'ROTATIVAS' && (
          <div className="flex items-center justify-between rounded-field border border-line px-3 py-2.5">
            <div>
              <p className="text-[14px] font-bold">Rondas</p>
              <p className="text-[11.5px] font-semibold text-muted">Cuántas fechas se juegan.</p>
            </div>
            <StepperRondas value={armado.rondas} onChange={(rondas) => setArmado({ ...armado, rondas })} />
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className={ROTULO}>Jugadores</span>
          <span className="text-[11.5px] font-extrabold text-muted">{jugadoresFiltrados.length}</span>
        </div>
        {armado.jugadores.map((nombre, indice) => (
          <div key={indice} className="flex items-center gap-2">
            <input
              value={nombre}
              aria-label={`Jugador ${indice + 1}`}
              onChange={(event) =>
                cambiarJugadores(armado.jugadores.map((actual, i) => (i === indice ? event.target.value : actual)))
              }
              placeholder="Nombre"
              className="min-w-0 flex-1 rounded-field border-[1.5px] border-line bg-surface p-[15px] text-[16px] font-[700] outline-none placeholder:font-medium placeholder:text-muted focus:border-accent"
            />
            <button
              type="button"
              // Por nombre y no por posición: al sacar una fila del medio las
              // etiquetas se corren y el lector termina anunciando a otro.
              aria-label={nombre.trim() ? `Sacar a ${nombre.trim()}` : `Sacar al jugador ${indice + 1}`}
              onClick={() => cambiarJugadores(armado.jugadores.filter((_, i) => i !== indice))}
              className="flex h-11 w-11 shrink-0 items-center justify-center"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-chip text-[13px] font-extrabold text-muted">
                ✕
              </span>
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => cambiarJugadores([...armado.jugadores, ''])}
          className="rounded-field border-[1.5px] border-line p-[13px] text-[14px] font-[750] text-muted"
        >
          + Agregar jugador
        </button>

        {armado.modalidad === 'PAREJAS' && armado.modoParejas === 'FIJAS' && (
          <div className="flex flex-col gap-1.5">
            <span className={ROTULO}>Armá las parejas</span>
            <p className="text-[12.5px] font-semibold text-muted">
              Tocá a dos jugadores para emparejarlos. Tocá de nuevo para separarlos.
            </p>
            {/* Cada pareja en su propia fila y con su número. Todos los chips
                pintados del mismo verde no decían quién quedó con quién:
                confirmar que Ana está con Beto obligaba a desarmar todo. El
                número también es lo que hace que el estado no dependa sólo del
                color, ni para un daltónico ni para un lector de pantalla. */}
            <div className="flex flex-col gap-2">
              {chips.parejas.map(({ numero, jugadores }) => (
                <div key={numero} className="flex items-center gap-2">
                  <span className="w-[68px] shrink-0 text-[10.5px] font-extrabold uppercase tracking-[.04em] text-muted">
                    Pareja {numero}
                  </span>
                  {jugadores.map(({ indice, nombre }) => (
                    <button
                      key={indice}
                      type="button"
                      aria-pressed={true}
                      aria-label={`${nombre}, pareja ${numero}`}
                      onClick={() => tocar(indice)}
                      className={`${CHIP} min-w-0 flex-1 bg-accent text-accent-text`}
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
                        className={`${CHIP} border-[1.5px] bg-surface ${
                          esperando ? 'border-accent text-accent-link' : 'border-line text-text'
                        }`}
                      >
                        {esperando ? `${nombre} · esperando` : nombre}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {warning !== null && <Aviso>{warning}</Aviso>}

      <button
        type="button"
        disabled={warning !== null}
        onClick={() => onEmpezar(armado)}
        className={`rounded-field p-4 text-center text-[15px] font-extrabold ${
          warning !== null ? 'bg-chip text-muted' : 'bg-accent text-accent-text'
        }`}
      >
        Empezar
      </button>
    </div>
  )
}
