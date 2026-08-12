import Link from 'next/link'
import { signOut } from '@/app/auth/actions'
import { serverClient } from '@/db/server'

const BULLETS = [
  'Las parejas se arman solas cruzando la tabla, sin discusiones.',
  'Cargás el resultado en dos toques, sin teclado.',
  'Cada uno ve su posición, su racha y con quién le va mejor.',
]

/**
 * Quien cae acá logueado ya tiene a dónde ir —Mis torneos—, así que el CTA
 * principal deja de ser "Crear mi torneo" y pasa a llevarlo ahí: crear uno es
 * un botón de esa pantalla. Lo único que se vuelve falso es "Ya tengo cuenta":
 * ya entró. Se cambia por "Cerrar sesión", la única copy del handoff para esa
 * acción.
 */
export default async function HomePage() {
  const supabase = await serverClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <main className="flex min-h-dvh flex-col bg-bg px-6 pb-[26px] text-text">
      <div className="flex items-center gap-[9px] pt-4">
        <span className="h-[26px] w-[26px] rounded-[7px] bg-accent" />
        <span className="text-[14.5px] font-extrabold tracking-[-.01em]">Padel Liga</span>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-4">
        <h1 className="text-pretty text-[40px] leading-[1.02] font-extrabold tracking-[-.035em]">
          El campeonato del grupo, sin planillas.
        </h1>
        <p className="text-pretty text-[15.5px] leading-[1.5] font-medium text-muted">
          Parejas nuevas cada fecha y una tabla que se actualiza sola. Vos cargás quién ganó, la app
          hace el resto.
        </p>

        <div className="flex flex-col gap-[9px] pt-[10px]">
          {BULLETS.map((bullet) => (
            <div key={bullet} className="flex items-start gap-[11px]">
              <span className="mt-[1px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-ok-bg text-[11px] font-extrabold text-up">
                ✓
              </span>
              <span className="text-pretty text-[14px] leading-[1.45] font-semibold">{bullet}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-[10px]">
        <Link
          href={user === null ? '/registro' : '/torneos'}
          className="rounded-field bg-accent p-4 text-center font-extrabold text-accent-text"
        >
          {user === null ? 'Crear mi torneo' : 'Mis torneos'}
        </Link>
        {user === null ? (
          <Link
            href="/login"
            className="rounded-field border border-line p-4 text-center font-extrabold text-text"
          >
            Ya tengo cuenta
          </Link>
        ) : (
          <form action={signOut}>
            <button
              type="submit"
              className="w-full rounded-field border border-line p-4 text-center font-extrabold text-text"
            >
              Cerrar sesión
            </button>
          </form>
        )}
        <p className="text-pretty pt-[2px] text-center text-[12.5px] font-medium text-muted">
          ¿Te pasaron un link de invitación? Abrilo y elegí tu nombre.
        </p>
      </div>
    </main>
  )
}
