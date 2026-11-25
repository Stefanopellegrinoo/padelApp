'use client'

import Link from 'next/link'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'

/**
 * Lo que se ve cuando algo se rompe, en vez de la página blanca en inglés de
 * Next ("Application error: a server-side exception has occurred").
 *
 * **No muestra `error.message` y es a propósito.** En producción Next ya lo
 * redacta para los errores del servidor, y en el cliente el mensaje crudo es
 * una traza de JavaScript que no le sirve a nadie del grupo. Lo que sí se
 * muestra es el `digest`, que es lo único que permite encontrar ESTE error en
 * los logs del servidor — es lo que hacía la página que este archivo reemplaza.
 *
 * El caso real más común no es un bug: es alguien que abre el link de un torneo
 * del que no es parte. RLS no le devuelve una fila, `seasonHeader` tira, y cae
 * acá. Sin sesión ni siquiera llega: el middleware lo manda a entrar primero.
 *
 * El molde es el de `not-found.tsx`: el bloque de arriba dice qué pasó y abajo
 * va una sola acción principal (probar de nuevo), con Inicio como salida.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-[calc(32px+env(safe-area-inset-bottom))] text-text">
      <Hero title="Algo se rompió" subtitle="No pudimos cargar esta pantalla." />

      <div className="flex flex-col gap-3 px-4 pt-6">
        <p className="text-[17px] leading-[1.5] text-pretty">
          Si llegaste por el link de un torneo, puede que no tengas lugar en ése.
        </p>
        <button type="button" onClick={reset} className={`${button('primary', { size: 'lg', full: true })} mt-3`}>
          Probar de nuevo
        </button>
        <Link href="/" className={button('ghost', { full: true })}>
          Ir al inicio
        </Link>

        {error.digest !== undefined && (
          <p className="mt-2 text-center text-[14px] text-muted">Referencia: {error.digest}</p>
        )}
      </div>
    </main>
  )
}
