import { redirect } from 'next/navigation'
import { afterLogin } from '@/app/auth/next-path'
import { Hero } from '@/app/ui/hero'
import { serverClient } from '@/db/server'
import { firstFreeUsername, myDisplayName, myUsername } from '@/db/usuario'
import { ElegirUsuario } from './elegir'

interface PageProps {
  /** `?next=...`: a dónde ibas cuando el middleware te mandó acá. */
  searchParams: Promise<{ next?: string }>
}

/**
 * "Elegí tu @usuario", la pantalla única (odd/tasks/amigos-faciles.md, S7;
 * lámina 07): para quien ya tenía cuenta, entra con Google o se registró con
 * un @usuario que otro tomó en el mismo instante. El middleware manda acá a
 * quien tenga sesión y no lo haya elegido, desde cualquier pantalla privada.
 *
 * Es obligatoria: no tiene Volver ni "Ahora no". Viene con la primera
 * sugerencia libre sacada del nombre, que se puede cambiar. Quien ya lo
 * eligió sigue de largo a `next`.
 */
export default async function ElegirUsuarioPage({ searchParams }: PageProps) {
  const { next } = await searchParams
  const destino = afterLogin(next)
  const supabase = await serverClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user === null) redirect(`/login?next=${encodeURIComponent(destino)}`)

  if ((await myUsername(supabase)) !== null) redirect(destino)

  const nombre = await myDisplayName(supabase)
  const sugerencia = await firstFreeUsername(supabase, nombre)
  const primerNombre = nombre.trim().split(/\s+/)[0] ?? ''

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-[calc(24px+env(safe-area-inset-bottom))] text-text">
      <Hero
        kicker={primerNombre === '' ? undefined : `Hola, ${primerNombre}`}
        title="Elegí tu @usuario"
        subtitle="Es como te van a encontrar tus amigos. Lo elegís una sola vez."
      />
      <ElegirUsuario inicial={sugerencia} next={destino} />
    </main>
  )
}
