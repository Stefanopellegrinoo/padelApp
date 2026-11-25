import { Skeleton } from '@/app/ui/skeleton'

/**
 * El esqueleto de Inicio: el bloque de la fecha, dos torneos y tres amigos,
 * en el mismo contenedor que la pantalla (acá no hay layout que quede
 * montado; sin él la pantalla salta de ancho al llegar).
 *
 * Es la pantalla que más tarda de la app: `cardFor` hace cinco consultas por
 * torneo y cada amigo trae su historial (`db/inicio.ts`), así que es justo
 * donde peor se sentía quedarse mirando la anterior.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg text-text" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-[236px] rounded-t-none rounded-b-block" />
      <div className="px-4 pt-5">
        <Skeleton className="mb-3 h-[28px] w-[150px] rounded-btn" />
        <div className="grid grid-cols-2 gap-2.5">
          <Skeleton className="h-[164px]" />
          <Skeleton className="h-[164px]" />
        </div>
      </div>
      <div className="px-4 pt-7">
        <Skeleton className="mb-3 h-[28px] w-[110px] rounded-btn" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-3 py-3.5">
            <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
            <Skeleton className="h-[38px] flex-1 rounded-btn" />
          </div>
        ))}
      </div>
    </main>
  )
}
