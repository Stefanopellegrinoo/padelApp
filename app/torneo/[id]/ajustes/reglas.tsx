'use client'

import { useState, useTransition } from 'react'
import { renderAdminMarkdown } from '@/app/torneo/[id]/reglas/markdown'
import { saveRules } from './actions'

/**
 * El texto libre del admin, con vista previa.
 *
 * La vista previa usa `renderAdminMarkdown`, la MISMA función que la pantalla
 * pública: lo que el admin ve mientras escribe es exactamente lo que va a ver
 * el grupo, escapado incluido. Una segunda forma de renderizar sería la manera
 * de que el escapado se pierda justo en la que se publica.
 *
 * Guarda al salir del campo. El plan no trae copy de "Guardar" y no se inventa.
 */
export function Reglas({ seasonId, text }: { seasonId: string; text: string }) {
  const [draft, setDraft] = useState(text)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.14em] text-muted">
        Texto de reglas
      </h2>

      <textarea
        value={draft}
        rows={8}
        disabled={pending}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft === text) return
          setError(null)
          startTransition(async () => {
            const result = await saveRules(seasonId, draft)
            if (!result.ok) setError(result.error)
          })
        }}
        className="rounded-field border border-line bg-surface p-[15px] text-[16px] font-medium leading-[1.55] outline-none"
      />

      {draft.trim().length > 0 && (
        <div
          className="rounded-[14px] border border-line bg-surface p-4 text-[14px] font-medium leading-[1.55] [&_a]:text-accent-link [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2 [&_strong]:font-extrabold"
          dangerouslySetInnerHTML={{ __html: renderAdminMarkdown(draft) }}
        />
      )}

      {error !== null && (
        <p className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">{error}</p>
      )}
    </section>
  )
}
