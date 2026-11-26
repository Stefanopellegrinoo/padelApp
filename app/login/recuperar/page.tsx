import Link from 'next/link'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'

/**
 * Recuperar la contraseña todavía no existe: la pantalla lo dice y devuelve a
 * entrar, donde está Google, que no pide contraseña.
 */
export default function RecuperarContraseñaPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-8 text-text">
      <Hero back={{ href: '/login', label: 'Entrar' }} title="Recuperar contraseña" />
      <div className="flex flex-col gap-5 px-4 pt-6">
        <p className="text-[17px]">Esto todavía no está listo. Llega pronto.</p>
        <Link href="/login" className={button('primary', { size: 'lg', full: true })}>
          Volver a entrar
        </Link>
      </div>
    </main>
  )
}
