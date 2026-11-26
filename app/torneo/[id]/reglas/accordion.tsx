'use client'

import { useState } from 'react'

export interface RuleRow {
  title: string
  value: string
  body: string
}

/** Acordeón de las seis reglas generadas. Interacción real (abrir/cerrar), por eso 'use client'. */
export function RulesAccordion({ rows }: { rows: RuleRow[] }) {
  const [openTitle, setOpenTitle] = useState<string | null>(null)

  return (
    <div className="border-t border-line">
      {rows.map((row) => {
        const isOpen = row.title === openTitle
        return (
          <div key={row.title} className="border-b border-line">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenTitle(isOpen ? null : row.title)}
              className="flex min-h-[56px] w-full items-center justify-between gap-3 py-2.5 text-left"
            >
              <span className="flex-1">
                <span className="block text-[16px] font-semibold">{row.title}</span>
                <span className="block text-[15px] text-muted">{row.value}</span>
              </span>
              <span aria-hidden="true" className="w-6 text-center text-[20px] font-semibold text-accent-link">
                {isOpen ? '−' : '+'}
              </span>
            </button>
            {isOpen && <p className="text-pretty pb-4 text-[16px] leading-[1.5] text-muted">{row.body}</p>}
          </div>
        )
      })}
    </div>
  )
}
