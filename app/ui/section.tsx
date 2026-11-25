import type { ReactNode } from 'react'

/**
 * Una sección de pantalla ("Tus torneos", "Amigos"): el título en la cara de
 * títulos (26 px, ancho 75 %) y, si hace falta, una acción a la derecha
 * ("Ver todos"). Márgenes de 16 a los costados, como todo el prototipo.
 */
export function Section({
  title,
  action,
  children,
  className = '',
}: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`px-4 pt-5 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-titulo text-[26px]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
