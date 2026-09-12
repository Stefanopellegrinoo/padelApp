'use client'

import { useEffect, useState } from 'react'
import {
  STORAGE_KEY,
  armar,
  cargarMarcador,
  escribirTorneo,
  leerTorneo,
  type Armado,
  type TorneoRapido,
} from './rapido-state'
import { guardarEn, leerGuardado } from './storage'
import { Armar } from './armar'
import { Jugar } from './jugar'

/**
 * `/rapido`: armar y jugar un torneo de una tarde, sin login y sin Supabase.
 * Todo vive en un único torneo en localStorage (`STORAGE_KEY`) — nada de
 * server actions ni base, esta ruta es pública a propósito.
 *
 * La lectura de localStorage va SIEMPRE en un `useEffect`, nunca durante el
 * render: si se leyera en el render, el primer render del cliente (que sí ve
 * localStorage) no coincidiría con el del servidor (que nunca lo ve), y React
 * tira un error de hidratación. Por eso hay un estado `cargado` que arranca
 * en `false` y dibuja el mismo árbol vacío en las dos puntas hasta que el
 * efecto corre.
 *
 * Y todo acceso al storage pasa por `storage.ts`, que nunca tira: si el
 * navegador no deja guardar, el torneo vive en memoria y se avisa una sola
 * vez. Perder el torneo al recargar es malo; caerse a `app/error.tsx` sin
 * poder volver a entrar nunca más es peor.
 */
export default function RapidoPage() {
  const [torneo, setTorneo] = useState<TorneoRapido | null>(null)
  const [cargado, setCargado] = useState(false)
  const [sinStorage, setSinStorage] = useState(false)

  useEffect(() => {
    const { valor, disponible } = leerGuardado(STORAGE_KEY)
    setTorneo(leerTorneo(valor))
    setSinStorage(!disponible)
    setCargado(true)
  }, [])

  const guardar = (siguiente: TorneoRapido | null) => {
    // El estado se actualiza siempre: que el navegador no deje persistir no es
    // razón para que la pantalla deje de funcionar en esta sesión.
    setTorneo(siguiente)
    const pudo = guardarEn(STORAGE_KEY, siguiente === null ? null : escribirTorneo(siguiente))
    if (!pudo) setSinStorage(true)
  }

  const empezar = (armado: Armado) => {
    // `random` se inyecta con `Math.random` real acá y en ningún otro lado:
    // `rapido-state.ts` lo pide justamente para poder testear el sorteo sin
    // azar de verdad.
    guardar(armar(armado, Math.random))
  }

  const cargarUnMarcador = (indice: number, a: number, b: number) => {
    if (torneo === null) return
    guardar(cargarMarcador(torneo, indice, a, b))
  }

  if (!cargado) return <main className="min-h-dvh bg-bg" />

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg text-text">
      {sinStorage && (
        <p className="mx-6 mt-4 rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          Este navegador no deja guardar. Podés jugar igual, pero si recargás se pierde.
        </p>
      )}
      {torneo === null ? (
        <Armar onEmpezar={empezar} />
      ) : (
        <Jugar
          torneo={torneo}
          onCargarMarcador={cargarUnMarcador}
          onNuevoTorneo={() => guardar(null)}
        />
      )}
    </main>
  )
}
