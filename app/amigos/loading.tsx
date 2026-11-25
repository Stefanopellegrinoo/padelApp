import { Skeleton } from '@/app/ui/skeleton'

/**
 * El esqueleto de Amigos, y de `/amigos/[playerId]` que cuelga de esta carpeta.
 *
 * Mismo criterio que `app/torneos/loading.tsx`: la pantalla es su propio
 * `<main>`, así que el esqueleto trae el mismo contenedor y el bloque de
 * arriba (el `Hero`), o parpadea de ancho y de alto al llegar el contenido.
 */
export default function Loading() {
  return (
    <main
      className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg text-text"
      aria-busy="true"
      aria-label="Cargando"
    >
      <Skeleton className="h-[180px] rounded-t-none rounded-b-block" />
      <div className="flex flex-col gap-3 px-4 pt-5">
        <Skeleton className="h-[26px] w-[150px]" />
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex items-center gap-3 py-3">
            <Skeleton className="h-11 w-11 shrink-0 rounded-full!" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-[60%]" />
              <Skeleton className="h-3.5 w-[40%]" />
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}
