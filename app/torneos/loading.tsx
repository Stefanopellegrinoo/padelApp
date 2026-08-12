/**
 * El esqueleto de Mis torneos.
 *
 * Va aparte del de `/torneo/[id]` porque acá no hay layout que quede montado:
 * esta pantalla es su propio `<main>`, así que el esqueleto tiene que traer el
 * mismo contenedor o la pantalla parpadea de ancho al llegar el contenido.
 *
 * Es la pantalla que más tarda de la app: `cardFor` hace cuatro consultas por
 * torneo (está anotado en `page.tsx`), así que es justo donde peor se sentía
 * quedarse mirando la anterior.
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
      {[0, 1].map((card) => (
        <Barra key={card} className="h-[118px] rounded-card" />
      ))}
      <Barra className="h-[54px]" />
    </main>
  )
}
