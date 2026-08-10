'use server'

import { redirect } from 'next/navigation'
import { serverClient } from '@/db/client'

// Server Action llana, sin useActionState: la pantalla entera es un Server
// Component (Step 3), así que no hay estado de cliente donde volcar un error.
// Si el reclamo falla, se vuelve a la misma pantalla con el motivo en la URL.
export async function claimSeat(form: FormData): Promise<void> {
  const token = String(form.get('token') ?? '')
  const entryId = String(form.get('entryId') ?? '')

  const supabase = await serverClient()
  const { error } = await supabase.rpc('claim_seat', { p_token: token, p_entry: entryId })
  if (error !== null) {
    redirect(`/unirse/${token}?selected=${entryId}&error=${encodeURIComponent(error.message)}`)
  }

  // "Mis torneos" es del Plan 3: por ahora, a la landing.
  redirect('/')
}
