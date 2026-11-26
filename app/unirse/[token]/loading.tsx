import { Skeleton } from '@/app/ui/skeleton'

/**
 * Esqueleto de `/unirse/[token]`: el bloque de arriba, el título y los
 * asientos, con el mismo contenedor que la pantalla real para que no pegue un
 * salto de ancho al llegar.
 *
 * Sólo se dispara en la entrada fría desde el link de invitación: elegir un
 * asiento es estado de cliente (`picker.tsx`), no una navegación.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg text-text" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-[168px] rounded-t-none rounded-b-block" />
      <div className="flex flex-col gap-2 px-4 pt-5">
        <Skeleton className="mb-1 h-[28px] w-[170px] rounded-btn" />
        {[0, 1, 2, 3, 4, 5, 6].map((row) => (
          <Skeleton key={row} className="h-[56px] rounded-btn" />
        ))}
      </div>
    </main>
  )
}
