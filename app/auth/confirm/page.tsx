import { confirmRecovery } from '@/app/auth/actions'
import LinkVencido from '@/app/login/link-vencido'
import ConfirmButton from './confirm-button'

/**
 * A dónde lleva el link del mail de recuperar contraseña
 * (`supabase/templates/recovery.html`). Muestra un botón y nada más: el token
 * se usa al tocarlo (`confirmRecovery`), no al abrir la página. Los escáneres
 * de correo (Outlook Safe Links, antivirus) abren los links antes que la
 * persona, y si abrir la página gastara el token, le llegaría ya vencido.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token_hash: tokenHash, type } = await searchParams
  // Por ahora el único mail con link es el de recuperar contraseña.
  if (typeof tokenHash !== 'string' || tokenHash === '' || type !== 'recovery') return <LinkVencido />

  return (
    <main className="flex min-h-dvh flex-col bg-bg px-6 pt-4 pb-[26px] text-text">
      <div className="flex flex-1 flex-col justify-center gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-[30px] font-extrabold tracking-[-.03em]">Recuperar contraseña</h1>
          <p className="text-[14px] font-[550] text-muted">Tocá el botón para elegir tu contraseña nueva.</p>
        </div>
        <form action={confirmRecovery} className="flex flex-col">
          <input type="hidden" name="token_hash" value={tokenHash} />
          <ConfirmButton />
        </form>
      </div>
    </main>
  )
}
