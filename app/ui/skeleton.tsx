/**
 * El lugar de algo que todavía no llegó (los `loading.tsx`): un bloque `chip`
 * que late. Mudo para el lector de pantalla; el tamaño y la forma los pone
 * quien lo usa (`className="h-[72px] rounded-block"`). Con movimiento
 * reducido deja de latir (regla global de `globals.css`).
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-tile bg-chip ${className}`} />
}
