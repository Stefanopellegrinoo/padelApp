'use client'

import { useFormStatus } from 'react-dom'

// Deshabilitado mientras se procesa: un doble toque usaría el token dos veces,
// y el segundo intento —ya vencido— mandaría a pedir otro link.
export default function ConfirmButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-field bg-accent p-4 text-[15px] font-extrabold text-accent-text disabled:bg-chip disabled:text-muted"
    >
      Elegir contraseña nueva
    </button>
  )
}
