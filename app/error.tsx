'use client'

import Link from 'next/link'

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
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-3 bg-bg px-6 text-text">
      <h1 className="text-pretty text-[22px] font-extrabold tracking-[-.02em]">Algo se rompió</h1>
      <p className="text-pretty text-[14px] font-[550] leading-[1.5] text-muted">
        No pudimos cargar esta pantalla. Si llegaste por el link de un torneo, puede que no tengas
        lugar en ése.
      </p>

      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-field bg-accent p-4 text-center text-[15px] font-extrabold text-accent-text"
      >
        Probar de nuevo
      </button>
      <Link href="/" className="text-center text-[12.5px] font-bold text-accent-link">
        Ir al inicio
      </Link>

      {error.digest !== undefined && (
        <p className="mt-2 text-center text-[10.5px] font-[600] text-muted">
          Referencia: {error.digest}
        </p>
      )}
    </main>
  )
}
