import type { SharedMatch } from '@/db/friends'

export interface HistorialProps {
  nombre: string
  partidos: readonly SharedMatch[]
}

/**
 * El historial de torneo con un amigo, sin leer nada -- recibe `SharedMatch[]`
 * por props. Mismo reparto que `rules-body.tsx`: la página lee, esto dibuja.
 *
 * `together` separa "jugamos de compañeros" de "jugamos enfrentados" (diseño
 * §5.3, §8.3): las dos son "partidos con {nombre}", y sumarlas en un solo
 * número no dice nada útil -- para quien mira la pantalla, ganarle a alguien y
 * hacer pareja con esa misma persona son cosas bien distintas.
 *
 * No hay lista partido por partido: `SharedMatch` no trae fecha ni marcador
 * (el diseño no los pidió acá), así que listar `matchId`/`matchdayId` crudos
 * sería mostrar un dato que no significa nada para quien juega. El total por
 * fecha sí sale de la misma data sin pedir nada más.
 */
export function Historial({ nombre, partidos }: HistorialProps) {
  return (
    <div className="flex flex-col gap-4 pt-4">
      <h1 className="text-[26px] font-extrabold tracking-[-.03em]">{nombre}</h1>

      {partidos.length === 0 ? (
        // Estado vacío: dice qué falta, no dibuja una tabla sin filas.
        <p className="text-pretty text-[13.5px] leading-[1.5] font-[550] text-muted">
          Todavía no jugaron ningún torneo juntos.
        </p>
      ) : (
        (() => {
          const juntos = partidos.filter((partido) => partido.together)
          const enContra = partidos.filter((partido) => !partido.together)
          const fechas = new Set(partidos.map((partido) => partido.matchdayId)).size

          return (
            <div className="flex flex-col gap-1.5">
              <p className="text-[13.5px] font-[550] text-muted">
                {partidos.length} partido{partidos.length === 1 ? '' : 's'} de torneo, en {fechas}{' '}
                fecha{fechas === 1 ? '' : 's'}
              </p>
              <p className="rounded-field border-[1.5px] border-line p-[14px] text-[15px] font-extrabold tracking-[-.02em]">
                Juntos {juntos.length} · En contra {enContra.length}
              </p>
            </div>
          )
        })()
      )}
    </div>
  )
}
