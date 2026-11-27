import { Skeleton } from '@/app/ui/skeleton'

/**
 * Esqueleto de `/amigo/[token]`: el bloque de arriba, "Siendo amigos" con sus
 * dos filas y los botones, con el mismo contenedor que la pantalla real para
 * que no pegue un salto de ancho al llegar.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg text-text" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-[168px] rounded-t-none rounded-b-block" />
      <div className="flex flex-col gap-2 px-4 pt-5">
        <Skeleton className="mb-1 h-[28px] w-[170px] rounded-btn" />
        <Skeleton className="h-[64px] rounded-btn" />
        <Skeleton className="h-[64px] rounded-btn" />
        <Skeleton className="mt-4 h-[56px] rounded-btn" />
      </div>
    </main>
  )
}
