import Link from 'next/link'
import { serverClient } from '@/db/server'
import NuevaClaveForm from './nueva-clave-form'

/**
 * A dónde lleva el link del mail de recuperar contraseña, ya con la sesión
 * que dejó `app/auth/confirm/route.ts`. Sin sesión —el link venció, o alguien
 * llegó acá a mano— no hay contraseña que cambiar: se manda a pedir otro.
 */
export default async function NuevaClavePage() {
  const supabase = await serverClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user === null) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-text">
        <h1 className="text-[26px] font-extrabold tracking-[-.03em]">El link venció</h1>
        <p className="text-[14px] font-[550] text-muted">Pedí uno nuevo para elegir tu contraseña.</p>
        <Link href="/login/recuperar" className="text-[12.5px] font-[750] text-accent-link">
          Pedir otro link
        </Link>
      </main>
    )
  }

  return <NuevaClaveForm email={user.email ?? ''} />
}
