import Link from 'next/link'
import { signOut } from '@/app/auth/actions'
import { SubmitButton } from '@/app/submit-button'
import { button } from '@/app/ui/button'
import { serverClient } from '@/db/server'

/** Lo que hace la app, en tres datos: el título dice qué, la línea gris dice cómo. */
const PUNTOS = [
  { titulo: 'Parejas solas', detalle: 'Se arman cruzando la tabla, sin discusiones.' },
  { titulo: 'Resultado en dos toques', detalle: 'Quién ganó y los games del otro. Sin teclado.' },
  { titulo: 'Tu tabla y tu historial', detalle: 'Tu puesto, tu racha y con quién te va mejor.' },
]

/**
 * La puerta de la app para quien no entró: el bloque azul con lo que es, tres
 * datos de lo que hace y los caminos para empezar.
 *
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
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-[calc(24px+env(safe-area-inset-bottom))] text-text">
      <header className="rounded-b-block bg-block px-4 pt-[calc(16px+env(safe-area-inset-top))] pb-7 text-on-block [--color-focus:var(--color-on-block)]">
        <p className="flex items-center gap-2 text-[16px] font-bold">
          <span aria-hidden="true" className="h-6 w-6 rounded-[7px] bg-on-block" />
          Padel Liga
        </p>
        <h1 className="mt-10 font-titulo text-[46px] text-balance">El campeonato del grupo, sin planillas.</h1>
        <p className="mt-3 text-[17px] text-pretty text-on-block-soft">
          Parejas nuevas cada fecha y una tabla que se actualiza sola.
        </p>
      </header>

      <ul className="flex flex-col gap-4 px-4 pt-6">
        {PUNTOS.map((punto) => (
          <li key={punto.titulo} className="border-l-4 border-sport py-0.5 pl-3.5">
            <b className="block text-[18px] leading-snug font-bold">{punto.titulo}</b>
            <span className="text-[15px] text-muted">{punto.detalle}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-col gap-2.5 px-4 pt-8">
        <Link href={user === null ? '/registro' : '/torneos'} className={button('primary', { size: 'lg', full: true })}>
          {user === null ? 'Crear mi torneo' : 'Mis torneos'}
        </Link>
        {user === null ? (
          <Link href="/login" className={button('secondary', { size: 'lg', full: true })}>
            Ya tengo cuenta
          </Link>
        ) : (
          <form action={signOut}>
            <SubmitButton className={button('secondary', { size: 'lg', full: true })}>Cerrar sesión</SubmitButton>
          </form>
        )}
        {/*
          El torneo rápido es la puerta más barata que tiene la app: no pide
          cuenta, no pide link y se entiende en una tarde. Nació como un
          renglón de 12.5px abajo de todo, debajo del párrafo gris de las
          invitaciones, y ahí no lo encontraba nadie —se probó—. Un camino que
          no pide cuenta no puede estar escondido detrás de los dos que sí la
          piden: es el único que alguien puede recorrer entero sin registrarse,
          así que es el que más barato sale mostrar.

          Queda tercero y sin caja: sigue siendo secundario contra "Crear mi
          torneo". Lo que cambió es que ahora se toca, no que grite.
        */}
        <Link
          href="/rapido"
          className="press flex min-h-[56px] flex-col items-center justify-center rounded-btn text-center active:bg-sport-tint"
        >
          <span className="text-[17px] font-bold text-accent-link">Armar un torneo rápido</span>
          <span className="text-[14px] text-muted">Una tarde, sin cuenta.</span>
        </Link>
        <p className="pt-1 text-center text-[14px] text-pretty text-muted">
          ¿Te pasaron un link de invitación? Abrilo y elegí tu nombre.
        </p>
      </div>
    </main>
  )
}
