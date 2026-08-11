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
    <nav className="sticky bottom-0 flex border-t border-line bg-bg px-[22px] pt-3 pb-6">
      {items.map((item) => {
        const active = item.isActive(pathname)
        return (
          <Link
            key={item.label}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-1 ${active ? 'text-accent-link' : 'text-muted'}`}
          >
            <span className={`h-[19px] w-[19px] border-2 border-current ${active ? 'bg-current' : ''}`} />
            <span className="text-[9.5px] font-extrabold">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
