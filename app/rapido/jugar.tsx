'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { campeon, tabla, terminado, type TorneoRapido } from './rapido-state'
import { agruparPorRonda } from './jugar-logic'
import { PartidoRow } from './partido-row'
import { Tabla } from './tabla'

/**
 * La única confirmación de la ruta: "Nuevo torneo rápido" pisa el único
 * torneo guardado, y eso no se deshace. El resto de las acciones (cargar un
 * marcador) son inofensivas y no la necesitan.
 *
 * Es un `<dialog>` nativo abierto con `showModal()` y no un `fixed inset-0`:
 * así el modal, el foco al abrir, el trap de foco y el Escape los pone la
 * plataforma. Escribir un trap de foco a mano para dos botones sería mucho más
 * código y peor. `onClose` cubre las dos salidas —el Escape y el botón— porque
 * el `<dialog>` dispara `close` en las dos.
 */
function ConfirmarNuevo({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const dialogo = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    dialogo.current?.showModal()
  }, [])

  return (
    <dialog
      ref={dialogo}
      onClose={onCancel}
      aria-labelledby="confirmar-nuevo-titulo"
      className="mx-auto mb-0 mt-auto w-full max-w-lg border-0 bg-transparent p-6 pb-[26px] text-text backdrop:bg-scrim"
    >
      <div className="rounded-card border border-line bg-surface p-5">
        <h2 id="confirmar-nuevo-titulo" className="text-[19px] font-extrabold tracking-[-.02em]">
          ¿Arrancar un torneo nuevo?
        </h2>
        <p className="mt-2 text-pretty text-[13.5px] font-[550] leading-[1.5] text-muted">
          Se borra este torneo de este teléfono. No hay forma de recuperarlo después.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-field bg-chip p-3.5 text-center text-[14.5px] font-extrabold"
          >
            Sí, empezar de nuevo
          </button>
          <button
            type="button"
            onClick={() => dialogo.current?.close()}
            className="rounded-field bg-accent p-3.5 text-center text-[14.5px] font-extrabold text-accent-text"
          >
            Seguir con este
          </button>
        </div>
      </div>
    </dialog>
  )
}

interface JugarProps {
  torneo: TorneoRapido
  onCargarMarcador: (indice: number, a: number, b: number) => void
  onNuevoTorneo: () => void
}

/**
 * Jugar (y, cuando `terminado(torneo)`, también hace de pantalla Terminado):
 * los partidos por ronda, la tabla actualizándose sola, y el campeón arriba
 * en cuanto no queda ningún marcador pendiente.
 *
 * "Nuevo torneo rápido" se ve SIEMPRE, no sólo con el torneo terminado.
 * Escondido detrás de `acabo` un torneo a medio jugar era una ratonera: si te
 * equivocaste de deporte al armarlo, ir a `/` y volver te devuelve acá —hay un
 * torneo guardado— y la única salida era inventar resultados en todos los
 * partidos para que el botón apareciera. Pisar el torneo sigue preguntando.
 */
export function Jugar({ torneo, onCargarMarcador, onNuevoTorneo }: JugarProps) {
  const [confirmando, setConfirmando] = useState(false)

  const grupos = agruparPorRonda(torneo.partidos)
  const filas = tabla(torneo)
  const acabo = terminado(torneo)
  const ganador = campeon(torneo)

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 pt-4 pb-[26px]">
      <div className="flex items-center justify-between">
        <Link href="/" className="rounded-full bg-chip px-[14px] py-2 text-[12.5px] font-bold">
          ← Inicio
        </Link>
      </div>

      {acabo && ganador !== null && (
        <div className="rounded-card bg-accent p-4 text-accent-text">
          <p className="text-[10.5px] font-extrabold uppercase tracking-[.14em] opacity-75">Campeón</p>
          <p className="mt-1 text-[19px] font-extrabold">{ganador.jugadores.join(' y ')}</p>
        </div>
      )}

      <h1 className="text-[22px] font-extrabold tracking-[-.03em]">
        {torneo.armado.nombre.trim() || 'Torneo rápido'}
      </h1>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {grupos.map((grupo) => (
          <section key={grupo.ronda} className="flex flex-col gap-2">
            <p className="text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted">
              Ronda {grupo.ronda}
            </p>
            <div className="flex flex-col gap-2">
              {grupo.items.map(({ indice, partido }) => (
                <PartidoRow
                  key={indice}
                  partido={partido}
                  jugadores={torneo.jugadores}
                  deporte={torneo.armado.deporte}
                  onCargarMarcador={(a, b) => onCargarMarcador(indice, a, b)}
                />
              ))}
            </div>
          </section>
        ))}

        <section className="flex flex-col gap-2">
          <p className="text-[11.5px] font-extrabold uppercase tracking-[.14em] text-muted">Tabla</p>
          <Tabla filas={filas} />
        </section>
      </div>

      {/* Con el torneo terminado empezar otro es el paso que sigue, así que va
          de primario. Mientras se está jugando es apenas la salida de
          emergencia y no tiene que competir con los partidos. */}
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className={`rounded-field p-4 text-center text-[15px] font-extrabold ${
          acabo ? 'bg-accent text-accent-text' : 'border-[1.5px] border-line text-muted'
        }`}
      >
        Nuevo torneo rápido
      </button>

      {confirmando && <ConfirmarNuevo onCancel={() => setConfirmando(false)} onConfirm={onNuevoTorneo} />}
    </div>
  )
}
