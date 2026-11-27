import { SPORTS, isSportId, type SportIcono } from '@/core'

/**
 * Los íconos de Inicio, del set del prototipo (`design/prototipo/fuente.html`):
 * trazo de 2, puntas redondas, toman el color de alrededor. Decorativos: al
 * lado siempre hay texto que dice lo mismo.
 */
const TRAZOS = {
  padel:
    'M9.2 14.8l-4.6 4.6M8.5 15.5c-1.6-1.6-1.2-5.6 1.4-8.2s6.6-3 8.2-1.4.6 5.2-2 7.8-6 3.4-7.6 1.8zM20.1 18.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z',
  pad: 'M7 8h10a4 4 0 0 1 4 4l.5 4a2.5 2.5 0 0 1-4.5 1.5L15.5 16h-7L7 17.5A2.5 2.5 0 0 1 2.5 16L3 12a4 4 0 0 1 4-4zM7.5 11v3M6 12.5h3M15.5 12h.01M17.5 13.5h.01',
  pingpong: 'M14.3 14.3l4.7 4.7M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0zM20.5 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',
  tenis: 'M12 2.5c3.2 0 5.5 2.8 5.5 6.2S15.2 15 12 15s-5.5-2.9-5.5-6.3S8.8 2.5 12 2.5zM6.7 8.7h10.6M12 2.6V15M12 15v6.5',
  futbol:
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM12 7.5l4 2.9-1.5 4.7h-5L8 10.4zM12 7.5V3M16 10.4l4.3-1.4M14.5 15.1l2.6 3.6M9.5 15.1l-2.6 3.6M8 10.4L3.7 9',
  basquet:
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM3 12h18M12 3v18M5.6 5.6c2.6 2.4 2.6 10.4 0 12.8M18.4 5.6c-2.6 2.4-2.6 10.4 0 12.8',
  futbolTenis: 'M16 6.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM9 4l3 2.5L15 4M3 21v-7h18v7M3 17.5h18M7.5 14v7M12 14v7M16.5 14v7',
  pool: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  vaso: 'M6 8h12l-1.6 13H7.6zM6.6 12.5h10.8M13.5 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z',
  peon: 'M14.5 5.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM9 10.5h6M10.5 10.5L9.5 17h5l-1-6.5M7 21v-1a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1z',
  bolo: 'M12 2c1.4 0 2 1.3 2 2.8 0 1.4-.8 2.4-.8 3.7 0 1.6 2.8 3.6 2.8 7.3 0 2.6-1.1 4.6-1.6 6.2H9.6C9.1 20.4 8 18.4 8 15.8c0-3.7 2.8-5.7 2.8-7.3 0-1.3-.8-2.3-.8-3.7C10 3.3 10.6 2 12 2zM10.8 9.5h2.4',
  plus: 'M12 5v14M5 12h14',
  bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
  chev: 'M9 5l7 7-7 7',
  check: 'M20 6 9 17l-5-5',
  sumarPersona: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM19 8v6M22 11h-6',
  amigos:
    'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.87M15.5 3.13a3.5 3.5 0 0 1 0 6.75',
} as const satisfies Record<SportIcono, string> & Record<string, string>

export function Icono({ name, className = 'h-6 w-6' }: { name: keyof typeof TRAZOS; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`shrink-0 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round] ${className}`}
    >
      <path d={TRAZOS[name]} />
    </svg>
  )
}

/** El ícono del deporte, el de su entrada del registro (`icono`). Un id que no se conoce, la paleta. */
export function IconoDeporte({ kind, className }: { kind: string; className?: string }) {
  const name = isSportId(kind) ? SPORTS[kind].icono : 'padel'
  return <Icono name={name} className={className} />
}
