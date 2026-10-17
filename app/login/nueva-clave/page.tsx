import LinkVencido from '@/app/login/link-vencido'
import { serverClient } from '@/db/server'
import NuevaClaveForm from './nueva-clave-form'

/**
 * A dónde lleva el link del mail de recuperar contraseña, ya con la sesión
 * que dejó `confirmRecovery`. Sin sesión —el link venció, o alguien
 * llegó acá a mano— no hay contraseña que cambiar: se manda a pedir otro.
 */
export default async function NuevaClavePage() {
  const supabase = await serverClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user === null) return <LinkVencido />

  return <NuevaClaveForm email={user.email ?? ''} />
}
