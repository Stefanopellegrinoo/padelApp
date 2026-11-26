import { Skeleton } from '@/app/ui/skeleton'

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
 *
 * La forma es la de las pantallas del prototipo: el encabezado en bloque de
 * borde a borde (en `chip`, no en azul: un bloque de color vacío se leería
 * como una pantalla que llegó rota) y las filas de 48 de la tabla.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-[164px] rounded-t-none rounded-b-block" />
      <Skeleton className="mx-4 mt-4 h-[64px]" />
      <ol className="mt-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
          <li key={row} className="flex min-h-[48px] items-center gap-4 border-t border-line px-4 first:border-t-0">
            <Skeleton className="h-6 w-5 rounded-[6px]" />
            <Skeleton className="h-4 flex-1 rounded-[6px]" />
            <Skeleton className="h-6 w-8 rounded-[6px]" />
          </li>
        ))}
      </ol>
    </div>
  )
}
