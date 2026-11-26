import Link from 'next/link'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'

/**
 * El 404 de la app, hermano de `error.tsx`: mismo molde, en castellano, en vez
 * de la página por defecto de Next ("This page could not be found.").
 *
 * Cae acá cualquier ruta que no existe y cualquier `notFound()` que tire una
 * página. Para los 500 está `error.tsx`.
 *
 * El "404" va de kicker, no de título: el número no le dice nada a nadie del
 * grupo, el título sí. La salida es una sola, Inicio; Mis torneos queda como
 * atajo para quien ya tiene cuenta.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-[calc(32px+env(safe-area-inset-bottom))] text-text">
      <Hero
        kicker={<span className="font-cond text-[20px] text-on-block-soft">404</span>}
        title="Esta página no existe"
        subtitle="El link está mal escrito o lo que buscabas ya no está."
      />

      <div className="flex flex-col gap-3 px-4 pt-6">
        <Link href="/" className={button('primary', { size: 'lg', full: true })}>
          Ir al inicio
        </Link>
        <Link href="/torneos" className={button('ghost', { full: true })}>
          Ver mis torneos
        </Link>
      </div>
    </main>
  )
}
