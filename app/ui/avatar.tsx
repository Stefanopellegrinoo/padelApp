/**
 * El círculo con las iniciales de una persona.
 *
 * El tono sale del nombre (siempre el mismo para el mismo nombre) pero hay
 * sólo dos y los dos son del sistema: el tinte del deporte y el neutro. Un
 * color por amigo fue lo que el usuario descartó en la ronda 1 del estilo
 * (`odd/tasks/rediseno-app.md`, L8); esto alcanza para que dos avatares
 * seguidos no sean idénticos. `data-deporte` alrededor lo vuelve verde en FIFA.
 *
 * Al lado del nombre es decorativo (`aria-hidden`): leerlo repetiría las
 * iniciales. Solo, con `label`, es una imagen con nombre ("Martín, tu perfil").
 */
const TONES = ['bg-sport-tint text-sport', 'bg-chip text-text'] as const

const SIZES = {
  md: 'h-11 w-11 text-[15px]',
  lg: 'h-14 w-14 text-[19px]',
}

/** "Nico Arias" → "NA"; una sola palabra, una letra; vacío, "?". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toLocaleUpperCase('es'))
    .join('')
}

/** El índice del tono: un hash chico y estable del nombre. */
export function avatarTone(name: string): number {
  let hash = 0
  for (const char of name.trim().toLocaleLowerCase('es')) hash = (hash * 31 + char.codePointAt(0)!) | 0
  return Math.abs(hash) % TONES.length
}

export function Avatar({
  name,
  label,
  size = 'md',
  className = '',
}: {
  name: string
  label?: string
  size?: keyof typeof SIZES
  className?: string
}) {
  const a11y = label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label }
  return (
    <span
      {...a11y}
      className={`grid shrink-0 place-items-center rounded-full font-[750] ${SIZES[size]} ${TONES[avatarTone(name)]} ${className}`}
    >
      {initials(name)}
    </span>
  )
}
