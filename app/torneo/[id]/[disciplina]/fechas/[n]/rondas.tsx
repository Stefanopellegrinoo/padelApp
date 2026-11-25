'use client'

import { CargaDeLaFecha, TarjetaPartido, type CargaContext, type PartidoVM } from './carga'

export type RoundMatchVM = PartidoVM

export interface RoundVM {
  number: number
  totalCount: number
  loadedCount: number
  complete: boolean
  matches: RoundMatchVM[]
  /** Nombre de la pareja libre esta ronda (5 parejas), `null` si no aplica. */
  restingPairName: string | null
}

/**
 * Con más partidos que esto, las rondas terminadas se pliegan: con 66
 * partidos (12 de a uno) la que está en juego queda a varias pantallas.
 */
const PLIEGA_DESDE = 20

/**
 * Las rondas de la fecha, todas a la vista: una ronda terminada no esconde
 * los partidos que puede hacer falta corregir (S8e). Sólo una fecha larga
 * pliega las terminadas, y lo dice ("Ver los 4 partidos").
 *
 * El estado de cada ronda es un dato y no una frase: "Terminada", "En juego"
 * (la primera que falta, en el color del deporte) o "Pendiente". La carga
 * —la hoja, el aviso, "Siguiente"— es de `CargaDeLaFecha`; con `carga` en
 * `null` (quien no carga, o la fecha cerrada) las tarjetas son de lectura.
 */
export function Rondas({
  rounds,
  carga = null,
}: {
  rounds: RoundVM[]
  carga?: CargaContext | null
}) {
  const partidos = rounds.flatMap((round) => round.matches)
  const enJuego = rounds.findIndex((round) => !round.complete)
  const pliega = partidos.length > PLIEGA_DESDE

  return (
    <CargaDeLaFecha context={carga} partidos={partidos}>
      <div className="flex flex-col gap-5">
        {rounds.map((round, index) => {
          const estado = round.complete ? 'Terminada' : index === enJuego ? 'En juego' : 'Pendiente'
          const encabezado = (
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-titulo text-[24px]">{`Ronda ${round.number}`}</h2>
              <span className={`text-[14px] font-[650] ${estado === 'En juego' ? 'text-sport' : 'text-muted'}`}>
                {estado}
              </span>
            </div>
          )
          const lista = (
            <div className="flex flex-col gap-2.5">
              {round.matches.map((match) => (
                <TarjetaPartido key={match.key} partido={match} />
              ))}
              {round.restingPairName !== null && (
                <p className="text-[15px] text-muted">{`Descansa: ${round.restingPairName}`}</p>
              )}
            </div>
          )

          if (pliega && round.complete) {
            return (
              <details key={round.number} className="group">
                <summary className="flex min-h-[44px] cursor-pointer list-none flex-col justify-center gap-1 [&::-webkit-details-marker]:hidden">
                  {encabezado}
                  <span className="text-[15px] font-semibold text-accent-link group-open:hidden">
                    {`Ver los ${round.totalCount} partidos`}
                  </span>
                </summary>
                <div className="mt-2.5">{lista}</div>
              </details>
            )
          }
          return (
            <section key={round.number} className="flex flex-col gap-2.5">
              {encabezado}
              {lista}
            </section>
          )
        })}
      </div>
    </CargaDeLaFecha>
  )
}
