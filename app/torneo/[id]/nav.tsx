'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  label: string
  href: string
  isActive: (pathname: string) => boolean
}

export function TorneoNav({ seasonId }: { seasonId: string }) {
  const pathname = usePathname()
  const base = `/torneo/${seasonId}`

  const items: NavItem[] = [
    { label: 'Tabla', href: base, isActive: (path) => path === base },
    {
      label: 'Fechas',
      href: `${base}/fechas`,
      isActive: (path) => path.startsWith(`${base}/fechas`),
    },
    { label: 'Stats', href: `${base}/stats`, isActive: (path) => path.startsWith(`${base}/stats`) },
    {
      label: 'Reglas',
      href: `${base}/reglas`,
      isActive: (path) => path.startsWith(`${base}/reglas`),
    },
  ]

  return (
    <nav className="sticky bottom-0 flex border-t border-line bg-bg px-[22px] pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {items.map((item) => {
        const active = item.isActive(pathname)
        return (
          // `min-h-[44px]` y no un alto fijo: 44 es el mínimo de la guía de
          // Apple y esto medía 37. Es lo que más se toca de la app, y errarle a
          // una pestaña te manda a otra pantalla.
          // `prefetch`: con un `loading.tsx` presente, Next precarga por defecto
          // sólo el esqueleto de una ruta dinámica y deja los datos para el
          // toque. Estas cuatro están siempre a la vista y son las que más se
          // tocan, así que conviene traerlas antes. Medido: la pantalla lista
          // pasó de 375ms a menos de la mitad, y el esqueleto sigue apareciendo
          // al instante para las veces que la precarga no llegó a tiempo.
          <Link
            key={item.label}
            href={item.href}
            prefetch
            className={`flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 ${active ? 'text-accent-link' : 'text-muted'}`}
          >
            <span className={`h-[19px] w-[19px] border-2 border-current ${active ? 'bg-current' : ''}`} />
            <span className="text-[9.5px] font-extrabold">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
