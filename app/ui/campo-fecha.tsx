'use client'

import { useRef } from 'react'
import { diaLargo } from '@/app/format'

/**
 * Elegir un día: una fila a lo ancho con el día escrito ("Jueves 26 nov") que
 * abre el selector nativo del teléfono.
 *
 * El `<input type="date">` pelado se veía distinto en cada navegador (en iOS,
 * una pastilla gris con el texto centrado que no respeta el ancho) y no entraba
 * al lado de otra cosa en 320 px. Acá el campo de verdad sigue estando, pero
 * transparente y estirado sobre toda la fila: el toque cae en él (iOS abre la
 * rueda sin intermediarios), el formulario lo manda con su `name` y el lector
 * de pantalla lo nombra con `label`. En los navegadores que al tocar el texto
 * sólo enfocan el campo (Chrome de escritorio), `showPicker()` abre el
 * calendario; si no existe o lo rechaza, queda el comportamiento nativo.
 *
 * 16 px en el campo: con menos, Safari agranda la pantalla al enfocarlo.
 */
export function CampoFecha({
  id,
  name,
  value,
  onChange,
  label,
  kicker,
  disabled = false,
  pending = false,
  required = false,
}: {
  id?: string
  name?: string
  /** `YYYY-MM-DD`, o vacío. */
  value: string
  onChange: (value: string) => void
  /** El nombre del campo para el lector de pantalla. */
  label: string
  /** El renglón chico de arriba ("Se juega el"). Sin él, la fila muestra sólo el día. */
  kicker?: string
  disabled?: boolean
  /** Guardando: en vez de "Cambiar" dice "Guardando…". */
  pending?: boolean
  required?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)

  const abrir = () => {
    try {
      ref.current?.showPicker?.()
    } catch {
      // Sin gesto válido o sin soporte: el toque nativo ya hace lo suyo.
    }
  }

  return (
    <div
      className={`relative flex min-h-[56px] w-full min-w-0 items-center overflow-hidden gap-3 rounded-btn border-[1.5px] border-line bg-surface-2 py-2 pr-3.5 pl-3 text-text has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus ${
        disabled ? 'opacity-60' : ''
      }`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-6 w-6 shrink-0 fill-none stroke-sport stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
      >
        <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </svg>
      <span aria-hidden="true" className="flex min-w-0 flex-1 flex-col leading-tight">
        {kicker !== undefined && <span className="text-[14px] font-semibold text-muted">{kicker}</span>}
        <span className={`text-[17px] font-bold [overflow-wrap:anywhere] ${value === '' ? 'text-muted' : ''}`}>
          {value === '' ? 'Elegí el día' : diaLargo(value)}
        </span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-[15px] font-semibold text-accent-link">
        {pending ? 'Guardando…' : 'Cambiar'}
      </span>
      <input
        ref={ref}
        id={id}
        name={name}
        type="date"
        value={value}
        required={required}
        disabled={disabled}
        aria-label={label}
        onClick={abrir}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 h-full w-full min-w-0 cursor-pointer appearance-none rounded-btn text-[16px] opacity-0 disabled:cursor-default"
      />
    </div>
  )
}
