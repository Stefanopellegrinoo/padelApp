'use client'

import { useRef, useState } from 'react'
import { SubmitButton } from '@/app/submit-button'
import { button } from '@/app/ui/button'
import { Sheet } from '@/app/ui/sheet'
import { renameTournament } from './actions'
import { Aviso, CAMPO, FilaHoja, ROTULO } from './piezas'

/**
 * La fila "Nombre" y su hoja. El guardado sigue siendo un `<form>` con la
 * server action de siempre (`renameTournament`): un campo y un Enter. Si
 * sale bien, la acción vuelve a Ajustes y la hoja queda cerrada; si no,
 * vuelve con `?error=` y la página monta esto de nuevo (`key`) con el error,
 * así la hoja arranca abierta y dice qué pasó.
 */
export function NombreTorneo({ seasonId, name, error }: { seasonId: string; name: string; error: string | undefined }) {
  const [open, setOpen] = useState(error !== undefined)
  const campo = useRef<HTMLInputElement>(null)

  return (
    <>
      <FilaHoja label="Nombre" value={name} onClick={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} title="Nombre del torneo" initialFocus={campo}>
        <form action={renameTournament} onSubmit={() => setOpen(false)} className="flex flex-col gap-4 pt-4">
          <input type="hidden" name="seasonId" value={seasonId} />
          <label>
            <span className={ROTULO}>Nombre</span>
            <input
              ref={campo}
              name="name"
              defaultValue={name}
              required
              autoComplete="off"
              aria-invalid={error !== undefined}
              className={`${CAMPO}${error !== undefined ? ' border-live' : ''}`}
            />
          </label>
          {error !== undefined && <Aviso alerta>{error}</Aviso>}
          <SubmitButton className={button('primary', { size: 'lg', full: true })}>Guardar</SubmitButton>
        </form>
      </Sheet>
    </>
  )
}
