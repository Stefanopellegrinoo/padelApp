import Link from 'next/link'
import { redirect } from 'next/navigation'
import { deleteAccount } from '@/app/auth/actions'
import { SubmitButton } from '@/app/submit-button'
import { Volver } from '@/app/torneo/[id]/volver'
import { serverClient } from '@/db/server'

/**
 * Borrar la cuenta desde la app: App Store lo exige (S2-S3,
 * `odd/tasks/borrar-cuenta.md`). Dice antes qué se va y qué queda, porque lo
 * que queda —el nombre en los torneos— es lo que nadie espera.
 */
export default async function BorrarCuentaPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  const supabase = await serverClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user === null) redirect('/login?next=/cuenta/borrar')

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-4 bg-bg px-5 pb-8 pt-4 text-text">
      <Volver href="/torneos" label="Mis torneos" />
      <h1 className="text-pretty text-[26px] font-extrabold tracking-[-.03em]">Borrar tu cuenta</h1>

      <div className="flex flex-col gap-2 text-[14px] font-[550] leading-[1.5]">
        <p>
          <span className="font-extrabold">Se borra:</span> tu login ({user.email}) y tus amistades. No vas a poder
          volver a entrar con esta cuenta.
        </p>
        <p>
          <span className="font-extrabold">Queda:</span> tu nombre en los torneos donde jugaste, como un jugador sin
          cuenta, para que las tablas y los resultados del resto no cambien.
        </p>
        <p className="text-muted">
          Si organizás algún torneo, primero pasale la administración a otro jugador desde Ajustes, o borrá el torneo.
        </p>
      </div>

      {error !== undefined && (
        <p role="alert" className="rounded-field bg-live-bg px-3 py-2.5 text-[12.5px] font-bold text-live">
          {error}
        </p>
      )}

      <form action={deleteAccount} className="flex flex-col gap-3">
        <label className="flex min-h-11 items-center gap-3 text-[14px] font-[650]">
          <input type="checkbox" required className="h-5 w-5 accent-[var(--color-live)]" />
          Entiendo que no se puede deshacer
        </label>
        <SubmitButton className="rounded-field bg-live-bg p-4 text-center text-[15px] font-extrabold text-live disabled:opacity-50">
          Borrar mi cuenta
        </SubmitButton>
      </form>

      <Link href="/privacidad" className="inline-flex min-h-11 items-center text-[12.5px] font-bold text-accent-link">
        Política de privacidad
      </Link>
    </main>
  )
}
