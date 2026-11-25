'use client'

/**
 * Un número con − y + de 44px: el wizard, la hoja "Personalizar reglas" y el resultado de un partido casual lo comparten.
 * El número va en la cara de marcador (`font-cond`), como los games del prototipo.
 */
export function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number
  min: number
  max: number
  onChange: (next: number) => void
}) {
  const button = 'h-[44px] w-[44px] shrink-0 rounded-btn bg-chip text-[18px] font-extrabold disabled:opacity-40'
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button type="button" className={button} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span className="w-9 text-center font-cond text-[28px]">{value}</span>
      <button type="button" className={button} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  )
}
