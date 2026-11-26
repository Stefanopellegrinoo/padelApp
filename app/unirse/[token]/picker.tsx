'use client'

import { useState } from 'react'
import { SubmitButton } from '@/app/submit-button'
import { Avatar } from '@/app/ui/avatar'
import { button } from '@/app/ui/button'
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
      <section className="flex-1 px-4 pt-5 pb-4">
        <h2 className="mb-3 font-titulo text-[26px]">¿Cuál sos vos?</h2>
        <ul className="flex flex-col gap-2">
          {seats.map((seat) => {
            if (seat.claimed) {
              return (
                <li key={seat.entry_id}>
                  <button
                    type="button"
                    disabled
                    className="flex min-h-[56px] w-full items-center gap-3 rounded-btn border-[1.5px] border-dashed border-line px-3 text-left disabled:opacity-100"
                  >
                    <Avatar name={seat.display_name} />
                    <span className="flex-1 text-[17px] font-semibold text-muted">{seat.display_name}</span>
                    <span className="text-[14px] font-semibold text-muted">Ya entró</span>
                  </button>
                </li>
              )
            }

            // El asiento elegido es "vos": el amarillo del sistema, que en
            // toda la app marca sólo lo tuyo (en oscuro, la fila elevada con
            // el borde amarillo). Los demás, sin relleno: en oscuro un
            // relleno de opción quedaba más claro que la fila elegida.
            const isSelected = seat.entry_id === selected
            return (
              <li key={seat.entry_id}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelected((prev) => (prev === seat.entry_id ? null : seat.entry_id))}
                  className={`flex min-h-[56px] w-full items-center gap-3 rounded-btn px-3 text-left ${
                    isSelected
                      ? 'bg-vos-fila shadow-[inset_4px_0_0_var(--color-vos-borde),inset_0_0_0_2px_var(--color-vos-borde)]'
                      : 'bg-bg shadow-[inset_0_0_0_1.5px_var(--color-line)]'
                  }`}
                >
                  <Avatar name={seat.display_name} />
                  <span className="flex-1 text-[17px] font-bold">{seat.display_name}</span>
                  {isSelected && (
                    <span className="flex items-center gap-1 text-[15px] font-bold">
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        className="h-5 w-5 fill-none stroke-current stroke-[2.5] [stroke-linecap:round] [stroke-linejoin:round]"
                      >
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                      Sos vos
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        {claimError !== undefined && <p className="mt-3 text-[14px] font-semibold text-live">{claimError}</p>}
      </section>

      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        {selectedSeat !== null ? (
          <form action={claimSeat}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="entryId" value={selectedSeat.entry_id} />
            <SubmitButton className={button('primary', { size: 'lg', full: true })}>
              Entrar como {selectedSeat.display_name}
            </SubmitButton>
          </form>
        ) : (
          <button
            type="button"
            disabled
            className="flex min-h-[56px] w-full items-center justify-center rounded-btn bg-chip px-5 text-[17px] font-bold text-muted disabled:opacity-100"
          >
            Elegí tu nombre
          </button>
        )}
        <p className="text-center text-[14px] text-muted">Si tu nombre no está o ya lo tomó otro, avisale a {adminName}.</p>
      </div>
    </>
  )
}
