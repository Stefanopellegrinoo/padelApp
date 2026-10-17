import Link from 'next/link'

/**
 * Lo que ve quien llega a recuperar contraseña con un link que ya no sirve, o
 * sin link. Lo comparten `/auth/confirm` y `/login/nueva-clave`.
 */
export default function LinkVencido() {
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
