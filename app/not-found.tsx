import Link from 'next/link'

/**
 * El 404 de la app, hermano de `error.tsx`: mismo molde, en castellano, en vez
 * de la página por defecto de Next ("This page could not be found.").
 *
 * Cae acá cualquier ruta que no existe y cualquier `notFound()` que tire una
 * página. Para los 500 está `error.tsx`.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-3 bg-bg px-6 text-text">
      <p className="text-[48px] font-extrabold leading-none tracking-[-.04em] text-muted tabular-nums">404</p>
      <h1 className="text-pretty text-[22px] font-extrabold tracking-[-.02em]">Esta página no existe</h1>
      <p className="text-pretty text-[14px] font-[550] leading-[1.5] text-muted">
        Puede que el link esté mal escrito o que lo que buscabas ya no esté.
      </p>

      <Link
        href="/"
        className="mt-2 rounded-field bg-accent p-4 text-center text-[15px] font-extrabold text-accent-text"
      >
        Ir al inicio
      </Link>
      <Link href="/torneos" className="text-center text-[12.5px] font-bold text-accent-link">
        Ver mis torneos
      </Link>
    </main>
  )
}
