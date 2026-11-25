'use client'

import { useRef, useState, useTransition } from 'react'
import type { DisciplineId } from '@/core'
import { button } from '@/app/ui/button'
import { Section } from '@/app/ui/section'
import { Sheet } from '@/app/ui/sheet'
import { TEXTO_DE_LA_CASA, renderAdminMarkdown } from '@/app/torneo/[id]/reglas/markdown'
import { saveRules } from './actions'
import { Aviso, CAMPO, GRUPO } from './piezas'

/**
 * "Reglas de la casa": el texto libre del admin (`rules_text`). Las reglas del juego en sí son de
 * `ReglasDeporte`.
 *
 * En la pantalla se ve como lo va a ver el grupo; se escribe en una hoja con "Guardar". Antes era
 * un campo de ocho líneas en el medio del scroll que guardaba al salir: ocupaba media pantalla
 * aunque nadie lo tocara, y no había cómo arrepentirse. Ahora "Cancelar" (o bajar la hoja) tira lo
 * escrito, y si no se pudo guardar la hoja sigue abierta con el texto y el error.
 *
 * Se muestra con `renderAdminMarkdown`, la MISMA función que la pantalla pública: lo que el admin
 * ve es exactamente lo que va a ver el grupo, escapado incluido. Una segunda forma de renderizar
 * sería la manera de que el escapado se pierda justo en la que se publica.
 */
export function Reglas({
  seasonId,
  disciplineId,
  text,
  disciplineLabel,
}: {
  seasonId: string
  disciplineId: DisciplineId
  text: string
  /** `null` con una sola disciplina: no hay nada que desambiguar. */
  disciplineLabel: string | null
}) {
  // Lo guardado: arranca en lo que trajo la página y pasa a lo nuevo apenas se guarda, sin
  // esperar a que el servidor vuelva a dibujar.
  const [saved, setSaved] = useState(text)
  const [draft, setDraft] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const campo = useRef<HTMLTextAreaElement>(null)

  const close = () => {
    setDraft(null)
    setError(null)
  }
  const save = () => {
    if (draft === null) return
    if (draft === saved) return close()
    setError(null)
    startTransition(async () => {
      const result = await saveRules(seasonId, disciplineId, draft)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSaved(draft)
      close()
    })
  }

  const title = disciplineLabel === null ? 'Reglas de la casa' : `Reglas de la casa de ${disciplineLabel}`
  return (
    <Section
      title="Reglas de la casa"
      action={
        <button
          type="button"
          onClick={() => {
            setError(null)
            setDraft(saved)
          }}
          className="-my-2 min-h-[44px] rounded-btn px-2 text-[16px] font-semibold text-accent-link"
        >
          Editar
        </button>
      }
    >
      <div className={`${GRUPO} px-4 py-3.5`}>
        {saved.trim().length > 0 ? (
          <div className={TEXTO_DE_LA_CASA} dangerouslySetInnerHTML={{ __html: renderAdminMarkdown(saved) }} />
        ) : (
          <p className="text-[16px] text-muted">Sin reglas de la casa</p>
        )}
      </div>

      <Sheet open={draft !== null} onClose={close} title={title} initialFocus={campo}>
        <div className="flex flex-col gap-3 pt-4">
          <textarea
            ref={campo}
            aria-label={title}
            value={draft ?? ''}
            rows={9}
            disabled={pending}
            onChange={(event) => setDraft(event.target.value)}
            className={`${CAMPO} leading-[1.5] font-normal`}
          />
          <p className="text-[14px] text-muted">**negrita** para resaltar; «- » al principio de cada línea para una lista</p>
          {error !== null && <Aviso alerta>{error}</Aviso>}
          <button type="button" disabled={pending} onClick={save} className={button('primary', { size: 'lg', full: true })}>
            Guardar
          </button>
        </div>
      </Sheet>
    </Section>
  )
}
