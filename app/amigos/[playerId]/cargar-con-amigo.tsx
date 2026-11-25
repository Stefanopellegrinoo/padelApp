'use client'

import { useRef, useState } from 'react'
import { Icono } from '@/app/torneos/inicio/iconos'
import { button } from '@/app/ui/button'
import { Sheet } from '@/app/ui/sheet'
import { Toast } from '@/app/ui/toast'
import { loadCasualMatch } from '../actions'
import { CasualForm, type CasualFormFriend } from './cargar'

/**
 * "Cargar partido con Nico", fijo abajo del perfil del amigo como en el
 * prototipo: abre la hoja con el formulario (`CasualForm`) y, cuando guarda,
 * la cierra y avisa abajo qué se guardó ("Guardado: Ganaste 6-4 6-3"). El
 * partido ya está en la lista: `loadCasualMatch` revalida la pantalla.
 *
 * El formulario se monta al abrir (`vez`): cada apertura arranca de cero, con
 * la fecha de hoy y lo último que usaste, y lee `localStorage` del lado del
 * cliente sin pelear con el render del servidor. Se queda montado al cerrar
 * para que la hoja baje con su contenido.
 */
export function CargarConAmigo({
  friendPlayerId,
  nombre,
  friends,
}: {
  friendPlayerId: string
  nombre: string
  friends: readonly CasualFormFriend[]
}) {
  const [hoja, setHoja] = useState({ open: false, vez: 0 })
  const [aviso, setAviso] = useState<string | null>(null)
  const primerCampo = useRef<HTMLInputElement>(null)
  const corto = nombre.trim().split(/\s+/)[0] ?? nombre
  const cerrar = () => setHoja((prev) => ({ ...prev, open: false }))

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => {
            setAviso(null)
            setHoja((prev) => ({ open: true, vez: prev.vez + 1 }))
          }}
          className={`${button('primary', { size: 'lg', full: true })} mx-auto max-w-lg`}
        >
          <Icono name="plus" />
          Cargar partido con {corto}
        </button>
      </div>
      <Sheet open={hoja.open} onClose={cerrar} title={`Partido con ${corto}`} initialFocus={primerCampo}>
        {hoja.vez > 0 && (
          <CasualForm
            key={hoja.vez}
            friendPlayerId={friendPlayerId}
            friends={friends}
            action={loadCasualMatch}
            submitLabel="Guardar"
            primerCampo={primerCampo}
            onSaved={(resumen) => {
              cerrar()
              setAviso(resumen === '' ? 'Guardado' : `Guardado: ${resumen}`)
            }}
          />
        )}
      </Sheet>
      <Toast
        message={aviso}
        onDismiss={() => setAviso(null)}
        // Arriba del botón de abajo, para no taparlo.
        className="bottom-[calc(96px+env(safe-area-inset-bottom))]"
      />
    </>
  )
}
