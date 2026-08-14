'use client'

import { useState } from 'react'
import { initials } from '@/app/format'
import { SubmitButton } from '@/app/submit-button'
import type { Database } from '@/db/database.types'
import { claimSeat } from './actions'

type Seat = Database['public']['Functions']['season_invite']['Returns'][number]

interface PickerProps {
  token: string
  seats: Seat[]
  initialSelected: string | null
  claimError: string | undefined
  adminName: string
}

/**
 * Which seat is "you" is pure UI state — nothing server-side depends on it
 * until the CTA is submitted. Kept local instead of round-tripping through
 * `?selected=` so a tap is instant instead of a ~300ms navigation.
 *
 * `initialSelected` seeds this from the seat the server already resolved out
 * of the query param (see `page.tsx`), so a failed `claimSeat` — which still
 * redirects to `?selected=` on error, unchanged — keeps the same seat picked.
 */
export function Picker({ token, seats, initialSelected, claimError, adminName }: PickerProps) {
  const [selected, setSelected] = useState(initialSelected)
  const selectedSeat = seats.find((seat) => seat.entry_id === selected && !seat.claimed) ?? null

  return (
    <>
      <p className="text-[11.5px] font-extrabold text-muted">¿Cuál sos vos?</p>

      <div className="flex flex-col gap-2">
        {seats.map((seat) => {
          if (seat.claimed) {
            return (
              <button
                key={seat.entry_id}
                type="button"
                disabled
                className="flex items-center gap-3 rounded-field border border-line bg-surface p-3"
              >
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-chip text-[11px] font-extrabold">
                  {initials(seat.display_name)}
                </span>
                <span className="flex-1 text-[15px] font-[650]">{seat.display_name}</span>
                <span className="text-[11.5px] font-extrabold text-muted">Ya entró</span>
              </button>
            )
          }

          const isSelected = seat.entry_id === selected
          return (
            <button
              key={seat.entry_id}
              type="button"
              onClick={() => setSelected((prev) => (prev === seat.entry_id ? null : seat.entry_id))}
              className={`flex items-center gap-3 rounded-field border p-3 ${
                isSelected ? 'border-[1.5px] border-accent bg-ok-bg' : 'border-line bg-surface'
              }`}
            >
              <span
                className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${
                  isSelected ? 'bg-accent text-accent-text' : 'bg-chip text-text'
                }`}
              >
                {initials(seat.display_name)}
              </span>
              <span className={`flex-1 text-[15px] ${isSelected ? 'font-extrabold' : 'font-[650]'}`}>
                {seat.display_name}
              </span>
              {isSelected && <span className="text-[11.5px] font-extrabold text-up">Sos vos</span>}
            </button>
          )
        })}
      </div>

      {claimError !== undefined && <p className="text-[12px] font-bold text-live">{claimError}</p>}

      <div className="mt-auto flex flex-col gap-3">
        {selectedSeat !== null ? (
          <form action={claimSeat}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="entryId" value={selectedSeat.entry_id} />
            <SubmitButton className="w-full rounded-field bg-accent p-4 text-center text-[15px] font-extrabold text-accent-text">
              Entrar como {selectedSeat.display_name}
            </SubmitButton>
          </form>
        ) : (
          <button
            type="button"
            disabled
            className="w-full rounded-field bg-chip p-4 text-center text-[15px] font-extrabold text-muted"
          >
            Elegí tu nombre
          </button>
        )}
        <p className="text-center text-[12px] font-[550] text-muted">
          Si tu nombre no está o ya lo tomó otro, avisale a {adminName}.
        </p>
      </div>
    </>
  )
}
