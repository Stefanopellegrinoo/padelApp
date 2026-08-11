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
    <div>
      {rows.map((row) => {
        const isOpen = row.title === openTitle
        return (
          <div key={row.title} className="border-b border-line">
            <button
              type="button"
              onClick={() => setOpenTitle(isOpen ? null : row.title)}
              className="flex w-full items-center justify-between gap-3 py-[15px] text-left"
            >
              <span className="flex-1">
                <span className="block text-[14.5px] font-[750]">{row.title}</span>
                <span className="block text-[12.5px] font-bold text-accent-link">{row.value}</span>
              </span>
              <span className="text-[13px] font-extrabold text-muted">{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && (
              <p className="text-pretty px-[15px] pt-0 pb-[15px] text-[13px] leading-[1.5] font-[550] text-muted">
                {row.body}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
