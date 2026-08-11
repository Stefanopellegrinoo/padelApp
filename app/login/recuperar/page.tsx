import Link from 'next/link'

export default function RecuperarContraseñaPage() {
  return (
    // Esta pantalla no está en el handoff —no es una de las 13—, así que toma
    // la escala de las demás: título de pantalla 26/800/−.03em, cuerpo 14/550
    // `muted`, link 12.5/750 `accent-link`.
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-6 text-center text-text">
      <h1 className="text-[26px] font-extrabold tracking-[-.03em]">Recuperar contraseña</h1>
      <p className="text-[14px] font-[550] text-muted">Esto todavía no está listo. Llega pronto.</p>
      <Link href="/login" className="text-[12.5px] font-[750] text-accent-link">
        ← Volver a entrar
      </Link>
    </main>
  )
}
