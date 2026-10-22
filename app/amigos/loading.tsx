/**
 * El esqueleto de Amigos, y de `/amigos/[playerId]` que cuelga de esta carpeta.
 *
 * Mismo criterio que `app/torneos/loading.tsx`: la pantalla es su propio
 * `<main>`, así que el esqueleto trae el mismo contenedor o parpadea de ancho
 * al llegar el contenido.
 */
function Barra({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-field bg-chip ${className}`} />
}

export default function Loading() {
  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-3 bg-bg px-5 pb-6 text-text"
      aria-busy="true"
      aria-label="Cargando"
    >
      <div className="flex items-center justify-between gap-3 pt-4">
        <Barra className="h-[30px] w-[150px]" />
        <Barra className="h-11 w-11 shrink-0 rounded-full" />
      </div>
      <Barra className="h-[54px]" />
      <Barra className="h-[200px] rounded-card" />
    </main>
  )
}
