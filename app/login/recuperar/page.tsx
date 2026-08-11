import Link from 'next/link'

export default function RecuperarContraseñaPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-text">
      <h1 className="text-2xl font-extrabold">Recuperar contraseña</h1>
      <p className="text-muted">Esto todavía no está listo. Llega pronto.</p>
      <Link href="/login" className="font-semibold text-accent-link">
        ← Volver a entrar
      </Link>
    </main>
  )
}
