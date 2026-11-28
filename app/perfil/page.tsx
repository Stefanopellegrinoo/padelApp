import { CompartirMiLink } from '@/app/amigos/link'
import { Hero } from '@/app/ui/hero'
import { myDiscoverable } from '@/db/buscar'
import { myFriendInvite } from '@/db/friends'
import { serverClient } from '@/db/server'
import { myDisplayName, myUsername } from '@/db/usuario'
import { QueMeEncuentren } from './interruptor'
import { AvatarGrande, FilaLink, Trazo } from './piezas'

/**
 * Tu perfil (odd/tasks/amigos-faciles.md, S8, S9; lámina 3 de
 * `design/amigos-faciles/06-perfil.html`): tu nombre, tu @usuario con el
 * candado (no se puede cambiar, S7), "Compartir mi link", el interruptor
 * "Que me encuentren por mi usuario" y, a mano, Privacidad y Borrar cuenta.
 *
 * Sólo lee: tu nombre no se edita acá (`players` está cerrada a escrituras,
 * 0002/0118; abrirla es otra decisión). Se llega desde "Tu perfil" en el menú
 * de la cuenta de Inicio, y `/perfil/<tu id>` también trae acá.
 */
export default async function MiPerfil() {
  const supabase = await serverClient()
  const [nombre, username, encontrable, token] = await Promise.all([
    myDisplayName(supabase),
    myUsername(supabase),
    myDiscoverable(supabase),
    myFriendInvite(supabase),
  ])

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-[calc(32px+env(safe-area-inset-bottom))] text-text">
      <Hero
        back={{ href: '/torneos', label: 'Inicio' }}
        kicker={
          <span className="flex flex-col items-start gap-3">
            Tu perfil
            <AvatarGrande name={nombre} />
          </span>
        }
        title={nombre}
        subtitle={
          username === null ? undefined : (
            <>
              <span className="flex items-center gap-1.5 text-[16px] font-semibold">
                @{username}
                <Trazo name="candado" className="h-4 w-4" />
              </span>
              <span className="mt-0.5 block text-[14px]">Tu @usuario no se puede cambiar</span>
            </>
          )
        }
      >
        <div className="mt-4">
          <CompartirMiLink token={token} />
        </div>
      </Hero>

      <section className="px-4 pt-6">
        <QueMeEncuentren inicial={encontrable} />
      </section>

      <section className="px-4 pt-6">
        <ul className="-mx-4">
          <li>
            <FilaLink href="/privacidad" icono={<Trazo name="escudo" />} nombre="Privacidad" tono="gris" />
          </li>
          <li className="border-t border-line">
            <FilaLink href="/cuenta/borrar" icono={<Trazo name="tacho" />} nombre="Borrar cuenta" tono="peligro" />
          </li>
        </ul>
      </section>
    </main>
  )
}
