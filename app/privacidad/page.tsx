import type { Metadata } from 'next'
import Link from 'next/link'
import { Hero } from '@/app/ui/hero'

export const metadata: Metadata = { title: 'Política de privacidad · Padel Liga' }

/**
 * Pública y estática (S4, `odd/tasks/borrar-cuenta.md`): App Store pide su link
 * al publicar, y el registro la enlaza. Describe lo que la app hace HOY; si se
 * suma un servicio que vea datos (analytics, push, errores), se agrega acá.
 *
 * Es texto para leer de corrido: 17 px con interlineado amplio y un ancho de
 * línea cómodo aunque se abra en la compu. `Volver` va sin destino fijo: se
 * llega desde el registro y desde el menú de la cuenta, y vuelve a donde
 * estabas (si entraste directo, a `/`).
 */
export default function PrivacidadPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg pb-[calc(40px+env(safe-area-inset-bottom))] text-text">
      <Hero back={{ href: '/' }} title="Política de privacidad" subtitle="Actualizada el 23 de octubre de 2026" />

      <div className="flex max-w-[36em] flex-col gap-7 px-4 pt-6">
        <Seccion titulo="Qué datos guardamos">
          <li>Tu mail y tu contraseña (cifrada), o tu cuenta de Google si entrás con Google.</li>
          <li>Tu nombre, como lo ven los demás en los torneos.</li>
          <li>Los torneos, fechas, parejas y resultados que cargan vos y tu grupo.</li>
          <li>Tus amistades y los partidos casuales que cargás con ellas.</li>
        </Seccion>

        <Seccion titulo="Para qué">
          <li>Sólo para que la app funcione: mostrar tablas, fechas y resultados a quienes juegan con vos.</li>
          <li>No vendemos ni compartimos tus datos, no mostramos publicidad y no usamos herramientas de seguimiento.</li>
        </Seccion>

        <Seccion titulo="Quién los ve">
          <li>Los demás jugadores de un torneo ven tu nombre y tus resultados en ese torneo.</li>
          <li>Tu mail no lo ve nadie más.</li>
          <li>
            Los datos se guardan en Supabase (base de datos) y la app corre en Vercel, los dos en San Pablo, Brasil.
          </li>
        </Seccion>

        <Seccion titulo="Borrar tu cuenta">
          <li>
            Podés borrarla cuando quieras desde el menú de tu cuenta →{' '}
            <Link href="/cuenta/borrar" className="font-bold text-accent-link underline underline-offset-2">
              Borrar cuenta
            </Link>
            . Se borran tu login y tus amistades.
          </li>
          <li>
            Tu nombre queda en los torneos donde jugaste, como jugador sin cuenta, para que los resultados del resto no
            cambien.
          </li>
        </Seccion>
      </div>
    </main>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="font-titulo text-[24px]">{titulo}</h2>
      <ul className="flex list-disc flex-col gap-2.5 pl-5 text-[17px] leading-[1.55] text-pretty marker:text-muted">
        {children}
      </ul>
    </section>
  )
}
