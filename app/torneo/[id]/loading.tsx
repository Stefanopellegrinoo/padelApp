/**
 * Lo que se ve mientras la pantalla nueva viene del servidor.
 *
 * Sin este archivo, Next deja la pantalla ANTERIOR puesta hasta que la nueva
 * está entera: tocás una pestaña y no pasa absolutamente nada durante todo lo
 * que tarden las consultas, y después salta de golpe. Es la razón por la que se
 * siente que el toque no se registró — no es que la app sea lenta, es que no
 * contesta. Medido en el build de producción contra la base local: ~160ms por
 * navegación, que ya se nota, y en el celular hay que sumarle la red y que la
 * base está en San Pablo.
 *
 * Cubre las cuatro pestañas y todo lo que cuelga de `/torneo/[id]`, porque el
 * layout —con su nav— queda montado y sólo se reemplaza el contenido. Eso hace
 * que la pestaña tocada se marque como activa al instante, que es la mitad de
 * la respuesta que faltaba.
 */
function Barra({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-field bg-chip ${className}`} />
}

export default function Loading() {
  return (
    <div className="flex flex-col gap-3 pt-4" aria-busy="true" aria-label="Cargando">
      <Barra className="h-[26px] w-[110px] rounded-full" />
      <Barra className="h-[30px] w-2/3" />
      <Barra className="h-[86px] rounded-card" />
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <Barra key={row} className="h-[56px]" />
      ))}
    </div>
  )
}
