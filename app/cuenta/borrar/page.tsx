import Link from 'next/link'
import { redirect } from 'next/navigation'
import { deleteAccount } from '@/app/auth/actions'
import { SubmitButton } from '@/app/submit-button'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'
import { serverClient } from '@/db/server'

/**
 * Borrar la cuenta desde la app: App Store lo exige (S2-S3,
 * `odd/tasks/borrar-cuenta.md`). Dice antes qué se va y qué queda, porque lo
 * que queda —el nombre en los torneos— es lo que nadie espera.
 *
 * Lo que se lee va en dos bloques ("Se borra", "Queda"); lo que se hace va
 * aparte, abajo de una línea, para que el botón rojo no quede al alcance de un
 * toque distraído: primero la casilla, después el botón.
 */
export default async function BorrarCuentaPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  const supabase = await serverClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user === null) redirect('/login?next=/cuenta/borrar')

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-[calc(32px+env(safe-area-inset-bottom))] text-text">
      <Hero back={{ href: '/torneos', label: 'Inicio' }} title="Borrar tu cuenta" />

      <div className="flex flex-col gap-3 px-4 pt-5">
        <Bloque titulo="Se borra">
          <li>
            Tu login: <span className="font-semibold break-all">{user.email}</span>
          </li>
          <li>Tus amistades</li>
          <li>No vas a poder volver a entrar con esta cuenta.</li>
        </Bloque>
        <Bloque titulo="Queda">
          <li>
            Tu nombre en los torneos donde jugaste, como jugador sin cuenta, para que las tablas y los resultados del
            resto no cambien.
          </li>
        </Bloque>
        <p className="px-1 text-[15px] leading-[1.5] text-pretty text-muted">
          Si organizás algún torneo, primero pasale la administración a otro jugador desde Ajustes, o borrá el torneo.
        </p>
      </div>

      <div className="mx-4 mt-6 flex flex-col gap-4 border-t border-line pt-6">
        {error !== undefined && (
          <p role="alert" className="rounded-tile bg-live-bg px-4 py-3 text-[16px] font-semibold text-live">
            {error}
          </p>
        )}

        <form action={deleteAccount} className="flex flex-col gap-4">
          <label className="flex min-h-[48px] items-center gap-3 text-[17px] font-semibold">
            <input type="checkbox" required className="h-6 w-6 shrink-0 accent-[var(--color-live)]" />
            Entiendo que no se puede deshacer
          </label>
          <SubmitButton className={button('danger', { size: 'lg', full: true })}>Borrar mi cuenta</SubmitButton>
        </form>

        <Link href="/privacidad" className={`${button('ghost')} -mx-4 self-start`}>
          Política de privacidad
        </Link>
      </div>
    </main>
  )
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-tile bg-surface p-4">
      <h2 className="font-titulo text-[22px]">{titulo}</h2>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[17px] leading-[1.5] text-pretty marker:text-muted">
        {children}
      </ul>
    </section>
  )
}
