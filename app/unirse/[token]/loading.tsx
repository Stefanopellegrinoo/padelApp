/**
 * Esqueleto de `/unirse/[token]`.
 *
 * Igual que `app/torneos/loading.tsx`: no hay layout montado acá, así que
 * este `<main>` trae su propio contenedor con el mismo padding que la
 * pantalla real, o pega un salto de ancho al llegar el contenido.
 *
 * Sólo tiene sentido AHORA que la selección de asiento es estado de cliente
 * (`picker.tsx`): antes de eso, este boundary se disparaba en cada toque de
 * un asiento (era una navegación de servidor). Ahora sólo se dispara en la
 * entrada fría desde el link de invitación, que es cuando sí hace falta.
 */
function Barra({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-field bg-chip ${className}`} />
}

export default function Loading() {
  return (
    <main
      className="flex min-h-dvh flex-col gap-5 bg-bg px-6 pt-4 pb-[26px] text-text"
      aria-busy="true"
      aria-label="Cargando"
    >
      <div className="flex flex-col gap-1">
        <Barra className="h-[14px] w-[110px]" />
        <Barra className="h-[38px] w-3/4" />
        <Barra className="h-[17px] w-1/2" />
      </div>

      <Barra className="h-[14px] w-[90px]" />

      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
          <Barra key={row} className="h-[54px]" />
        ))}
      </div>

      <div className="mt-auto">
        <Barra className="h-[54px]" />
      </div>
    </main>
  )
}
