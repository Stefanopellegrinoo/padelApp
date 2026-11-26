'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'
import { Sheet } from '@/app/ui/sheet'
import { Toast } from '@/app/ui/toast'
import { DEPORTE_LABEL, VOLVER_INICIO, campeon, tabla, terminado, type Armado, type TorneoRapido } from './rapido-state'
import { agruparPorRonda, esPartida, nombreLado, resumenGuardado, siguienteSinCargar } from './jugar-logic'
import { HojaPartido, TarjetaPartido } from './partido-row'
import { Tabla } from './tabla'

/** Cómo se juega, en dos palabras: va de subtítulo del encabezado. */
function formatoDe(armado: Armado): string {
  if (armado.modalidad === 'INDIVIDUAL') return 'Individual'
  if (armado.modoParejas === 'FIJAS') return 'Parejas fijas'
  if (armado.modoParejas === 'SORTEADAS') return 'Parejas sorteadas'
  return 'Parejas rotativas'
}

/** Los que faltan de una ronda, dichos: "Falta 1", "Faltan 2". */
function faltan(cuantos: number): string {
  return cuantos === 1 ? 'Falta 1' : `Faltan ${cuantos}`
}

interface JugarProps {
  torneo: TorneoRapido
  onCargarMarcador: (indice: number, a: number, b: number) => void
  onNuevoTorneo: () => void
  /** El aviso de `page.tsx` cuando el navegador no deja guardar: va debajo del encabezado. */
  aviso?: ReactNode
}

/**
 * Jugar (y, cuando `terminado(torneo)`, también la pantalla del campeón): los
 * partidos por ronda, la tabla actualizándose sola, y el campeón en el
 * encabezado en cuanto no queda ningún marcador pendiente.
 *
 * La carga (S8e): tocar el partido abre la hoja y el segundo toque guarda.
 * Después de guardar, la hoja se cierra y el aviso dice qué se guardó y ofrece
 * "Siguiente", el próximo sin cargar, a un toque. Es una acción del aviso y no
 * un salto solo: mover la pantalla sin que nadie lo pida desorienta. Con el
 * último cargado, la acción es ver al campeón. La tarjeta recién guardada
 * destella 700 ms (`destello`, `globals.css`), como en la fecha.
 *
 * "Nuevo torneo" se ve SIEMPRE, no sólo con el torneo terminado. Escondido
 * detrás de `acabo` un torneo a medio jugar era una ratonera: si te
 * equivocaste de deporte al armarlo, ir a `/` y volver te devuelve acá —hay un
 * torneo guardado— y la única salida era inventar resultados en todos los
 * partidos para que el botón apareciera. Pisar el torneo sigue preguntando,
 * en una hoja: es lo único de la ruta que no se deshace.
 */
export function Jugar({ torneo, onCargarMarcador, onNuevoTorneo, aviso }: JugarProps) {
  // `vez` cambia en cada apertura: la hoja arranca de cero aunque se reabra el
  // mismo partido. `indice` se queda al cerrar para que baje con su contenido.
  const [hoja, setHoja] = useState<{ indice: number; open: boolean; vez: number } | null>(null)
  const [guardado, setGuardado] = useState<{ texto: string; indice: number } | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  // La tarjeta que destella; `vez` hace un objeto nuevo en cada guardado, que reinicia el reloj.
  const [destello, setDestello] = useState<{ indice: number; vez: number } | null>(null)
  const campeonRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (destello === null) return
    const timer = setTimeout(() => setDestello(null), 700)
    return () => clearTimeout(timer)
  }, [destello])

  const { armado, jugadores, partidos } = torneo
  const grupos = agruparPorRonda(partidos)
  const filas = tabla(torneo)
  const acabo = terminado(torneo)
  const ganador = campeon(torneo)
  const jugados = partidos.filter((partido) => partido.marcador !== null).length

  const abrir = (indice: number) => setHoja((prev) => ({ indice, open: true, vez: (prev?.vez ?? 0) + 1 }))
  const cerrar = () => setHoja((prev) => (prev === null ? null : { ...prev, open: false }))
  const partido = hoja === null ? undefined : partidos[hoja.indice]

  // Con la lista de AHORA: cuando se toca "Siguiente" el guardado ya está.
  const siguiente = guardado === null ? null : siguienteSinCargar(partidos, guardado.indice)

  const irA = (indice: number) => {
    // El foco va a la tarjeta antes de abrir: la hoja vuelve ahí al cerrarse,
    // y el aviso que tenía el botón ya no existe.
    const tarjeta = document.getElementById(`partido-${indice}`)
    tarjeta?.focus({ preventScroll: true })
    tarjeta?.scrollIntoView?.({ block: 'center' })
    abrir(indice)
  }

  const verCampeon = () => {
    campeonRef.current?.focus({ preventScroll: true })
    window.scrollTo?.({ top: 0 })
  }

  const accion =
    siguiente !== null
      ? { label: 'Siguiente', onClick: () => irA(siguiente) }
      : acabo && guardado !== null
        ? { label: 'Ver campeón', onClick: verCampeon }
        : undefined

  const esPareja = (ganador?.jugadores.length ?? 0) > 1

  return (
    <div data-deporte={armado.deporte} className="flex flex-1 flex-col pb-[calc(24px+env(safe-area-inset-bottom))]">
      <Hero
        back={VOLVER_INICIO}
        kicker={DEPORTE_LABEL[armado.deporte]}
        title={armado.nombre.trim() || 'Torneo rápido'}
        subtitle={formatoDe(armado)}
        sport={armado.deporte}
        right={
          acabo ? undefined : (
            <p>
              <span className="font-cond block text-[56px]">{jugados}</span>
              <span className="text-[14px] text-on-block-soft">
                de {partidos.length} jugados
              </span>
            </p>
          )
        }
      >
        {acabo && ganador !== null && (
          <div
            ref={campeonRef}
            tabIndex={-1}
            className="mt-4 flex items-center gap-3 rounded-tile bg-on-block px-4 py-3 text-block"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-9 w-9 shrink-0 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
            >
              <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
              <path d="M7 6H4.5v1.5A3 3 0 0 0 7.5 10.5M17 6h2.5v1.5a3 3 0 0 1-3 3" />
              <path d="M12 14v3.5M8.5 20.5h7M9.5 17.5h5v3h-5z" />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold">{esPareja ? 'Campeones' : 'Campeón'}</p>
              <p className="font-titulo text-[28px] [overflow-wrap:anywhere]">{ganador.jugadores.join(' y ')}</p>
            </div>
            <p className="shrink-0 text-right">
              <span className="font-cond block text-[40px]">{esPartida(armado.deporte) ? ganador.puntos : ganador.ganados}</span>
              <span className="text-[14px] font-semibold">{esPartida(armado.deporte) ? 'puntos' : 'ganados'}</span>
            </p>
          </div>
        )}
      </Hero>
      {aviso}

      {grupos.map((grupo) => {
        const pendientes = grupo.items.filter(({ partido: p }) => p.marcador === null).length
        return (
          <section key={grupo.ronda} className="px-4 pt-5">
            <div className="mb-2.5 flex items-baseline justify-between gap-3">
              <h2 className="font-titulo text-[24px]">Ronda {grupo.ronda}</h2>
              {pendientes > 0 && <span className="text-[14px] font-semibold text-sport">{faltan(pendientes)}</span>}
            </div>
            <div className="flex flex-col gap-2.5">
              {grupo.items.map(({ indice, partido: p }) => (
                <TarjetaPartido
                  key={indice}
                  indice={indice}
                  partido={p}
                  jugadores={jugadores}
                  deporte={armado.deporte}
                  destella={destello?.indice === indice}
                  onAbrir={() => abrir(indice)}
                />
              ))}
            </div>
          </section>
        )
      })}

      <section className="pt-6">
        <h2 className="px-4 font-titulo text-[24px]">Tabla</h2>
        <Tabla filas={filas} partidas={esPartida(armado.deporte)} />
      </section>

      <div className="px-4 pt-6">
        {/* Con el torneo terminado empezar otro es el paso que sigue, así que
            va de primario. Mientras se juega es la salida de emergencia y no
            compite con los partidos. */}
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          className={acabo ? button('primary', { size: 'lg', full: true }) : button('secondary', { full: true })}
        >
          Nuevo torneo
        </button>
      </div>

      <Sheet open={hoja?.open ?? false} onClose={cerrar} title={partido === undefined ? '' : `Ronda ${partido.ronda}`}>
        {partido !== undefined && hoja !== null && (
          <HojaPartido
            key={hoja.vez}
            partido={partido}
            jugadores={jugadores}
            deporte={armado.deporte}
            onGuardar={(a, b) => {
              onCargarMarcador(hoja.indice, a, b)
              cerrar()
              const texto = resumenGuardado(
                nombreLado(jugadores, partido.a),
                nombreLado(jugadores, partido.b),
                { a, b },
                armado.deporte,
              )
              setGuardado({ texto: `Guardado: ${texto}`, indice: hoja.indice })
              setDestello((prev) => ({ indice: hoja.indice, vez: (prev?.vez ?? 0) + 1 }))
            }}
          />
        )}
      </Sheet>

      <Sheet open={confirmando} onClose={() => setConfirmando(false)} title="¿Arrancar un torneo nuevo?">
        <p className="mt-2 text-[16px] text-muted">Se borra este torneo del teléfono y no se recupera.</p>
        <button
          type="button"
          onClick={() => {
            setConfirmando(false)
            onNuevoTorneo()
          }}
          className={`${button('danger', { size: 'lg', full: true })} mt-4`}
        >
          Sí, empezar de nuevo
        </button>
      </Sheet>

      <Toast message={guardado?.texto ?? null} action={accion} onDismiss={() => setGuardado(null)} />
    </div>
  )
}
