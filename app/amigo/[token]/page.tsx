import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { SubmitButton } from '@/app/submit-button'
import { IconoLink } from '@/app/amigos/link-iconos'
import { Icono } from '@/app/torneos/inicio/iconos'
import { initials } from '@/app/ui/avatar'
import { button } from '@/app/ui/button'
import { Hero } from '@/app/ui/hero'
import { row, rowMeta, rowTitle } from '@/app/ui/row'
import { Section } from '@/app/ui/section'
import { friendInvitePreview } from '@/db/friends'
import { serverClient } from '@/db/server'
import { sumarmeComoAmigo } from './actions'

interface PageProps {
  params: Promise<{ token: string }>
  /** `?error=...`: "Sumarme como amigo" falló (`sumarmeComoAmigo`) y volvió acá con el motivo. */
  searchParams: Promise<{ error?: string }>
}

/**
 * El link de amistad, del lado de quien lo abre (odd/tasks/amigos-faciles.md,
 * S5): quién te invita, qué cambia siendo amigos, "Sumarme como amigo" y
 * "Ahora no". Confirmar te deja como amigo al toque y te lleva al historial
 * con esa persona.
 *
 * Sin sesión va al registro y vuelve acá solo, como `/unirse/[token]`: el
 * registro y el login respetan `next`, y el link a "Entrar" del registro lo
 * conserva. No hay nada que mostrar antes: la base no le dice a nadie sin
 * cuenta de quién es un link.
 *
 * `friendInvitePreview` decide el resto. Ya amigos: directo al historial. Tu
 * propio link: lo dice, sin botón. Un link cambiado o que no existe: "Este
 * link ya no anda, pedile uno nuevo". Con un pedido pendiente entre los dos,
 * la pantalla es la misma: sumarse lo acepta.
 */
export default async function AmigoLinkPage({ params, searchParams }: PageProps) {
  const { token } = await params
  const { error } = await searchParams
  const supabase = await serverClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user === null) {
    redirect(`/registro?next=/amigo/${encodeURIComponent(token)}`)
  }

  const invitacion = await friendInvitePreview(supabase, token)

  if (invitacion === null) {
    return (
      <Pantalla>
        <Hero back={{ href: '/torneos', label: 'Inicio' }} title="Link de amistad" />
        <div className="flex flex-col gap-5 px-4 pt-6">
          <p className="text-[17px]">Este link ya no anda, pedile uno nuevo</p>
          <Link href="/torneos" className={button('secondary', { size: 'lg', full: true })}>
            Volver al inicio
          </Link>
        </div>
      </Pantalla>
    )
  }

  if (invitacion.relation === 'friends') {
    redirect(`/amigos/${invitacion.inviterId}?desde=amigos`)
  }

  const encabezado = (subtitle: string) => (
    <Hero
      kicker="Link de amistad"
      title={invitacion.displayName}
      subtitle={subtitle}
      right={
        <span
          aria-hidden="true"
          className="grid h-[72px] w-[72px] place-items-center rounded-full bg-on-block text-[26px] font-[750] text-block"
        >
          {initials(invitacion.displayName)}
        </span>
      }
    />
  )

  if (invitacion.relation === 'self') {
    return (
      <Pantalla>
        {encabezado('Es tu propio link')}
        <div className="flex flex-col gap-5 px-4 pt-6">
          <p className="text-[17px]">Mandáselo a quien quieras sumar.</p>
          <Link href="/amigos" className={button('secondary', { size: 'lg', full: true })}>
            Ir a Amigos
          </Link>
        </div>
      </Pantalla>
    )
  }

  return (
    <Pantalla>
      {encabezado('te invita a ser amigos')}

      <Section title="Siendo amigos">
        <ul className="-mx-4">
          <Ventaja icono={<IconoLink name="reloj" className="h-[22px] w-[22px]" />} titulo="Ven el historial de lo que jueguen">
            En torneos y en partidos sueltos
          </Ventaja>
          <Ventaja icono={<Icono name="plus" />} titulo="Cargan partidos entre ustedes">
            Sin armar un torneo
          </Ventaja>
        </ul>
      </Section>

      <div className="flex flex-col gap-1 px-4 pt-4">
        {error !== undefined && (
          <p role="alert" className="mb-3 rounded-btn bg-live-bg px-3 py-2.5 text-[15px] font-semibold text-live">
            {error}
          </p>
        )}
        <form action={sumarmeComoAmigo}>
          <input type="hidden" name="token" value={token} />
          <SubmitButton className={button('primary', { size: 'lg', full: true })}>Sumarme como amigo</SubmitButton>
        </form>
        <Link href="/torneos" className={button('ghost', { full: true })}>
          Ahora no
        </Link>
      </div>
    </Pantalla>
  )
}

function Pantalla({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-[calc(24px+env(safe-area-inset-bottom))] text-text">
      {children}
    </main>
  )
}

/** Una fila de "Siendo amigos": el ícono en su baldosa, qué cambia y el detalle. */
function Ventaja({ icono, titulo, children }: { icono: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <li className={`${row} min-h-[64px]`}>
      <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-sport-tint text-sport">
        {icono}
      </span>
      <span className="min-w-0 flex-1">
        <span className={rowTitle}>{titulo}</span>
        <span className={`${rowMeta} mt-0.5`}>{children}</span>
      </span>
    </li>
  )
}
