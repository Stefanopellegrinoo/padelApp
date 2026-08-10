import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-text">
      <h1 className="text-center text-3xl font-bold">El campeonato del grupo, sin planillas.</h1>
      <p className="text-muted">La app del campeonato de pádel.</p>
      <div className="mt-4 flex w-full max-w-xs flex-col gap-3">
        <Link
          href="/registro"
          className="rounded-field bg-accent p-4 text-center font-extrabold text-accent-text"
        >
          Crear mi torneo
        </Link>
        <Link
          href="/login"
          className="rounded-field border border-line p-4 text-center font-extrabold text-text"
        >
          Ya tengo cuenta
        </Link>
      </div>
    </main>
  )
}
