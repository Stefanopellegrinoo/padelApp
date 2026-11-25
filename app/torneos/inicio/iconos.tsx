/**
 * Los íconos de Inicio, del set del prototipo (`design/prototipo/fuente.html`):
 * trazo de 2, puntas redondas, toman el color de alrededor. Decorativos: al
 * lado siempre hay texto que dice lo mismo.
 */
const TRAZOS = {
  padel:
    'M9.2 14.8l-4.6 4.6M8.5 15.5c-1.6-1.6-1.2-5.6 1.4-8.2s6.6-3 8.2-1.4.6 5.2-2 7.8-6 3.4-7.6 1.8zM20.1 18.5a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0z',
  pad: 'M7 8h10a4 4 0 0 1 4 4l.5 4a2.5 2.5 0 0 1-4.5 1.5L15.5 16h-7L7 17.5A2.5 2.5 0 0 1 2.5 16L3 12a4 4 0 0 1 4-4zM7.5 11v3M6 12.5h3M15.5 12h.01M17.5 13.5h.01',
  plus: 'M12 5v14M5 12h14',
  bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6z',
  chev: 'M9 5l7 7-7 7',
  amigos:
    'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19v-1a4 4 0 0 0-3-3.87M15.5 3.13a3.5 3.5 0 0 1 0 6.75',
} as const

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

/** El ícono del deporte: el joystick para los de goles con equipo, la paleta para el resto. */
export function IconoDeporte({ kind, className }: { kind: string; className?: string }) {
  return <Icono name={kind === 'FIFA' || kind === 'FUTBOL' ? 'pad' : 'padel'} className={className} />
}
