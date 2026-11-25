import type { ReglamentoKey, ReglamentoLine } from '@/core'

/** Qué es cada línea, en una o dos palabras: el rótulo que va arriba de la regla. */
const ROTULOS: Record<ReglamentoKey, string> = {
  modalidad: 'Modalidad',
  partido: 'Partido',
  fecha: 'Formato',
  puntos: 'Puntos por puesto',
  temporada: 'Temporada',
  desempate: 'Empate en puntos',
  masters: 'Masters',
}

/**
 * El reglamento de un deporte (`reglamento`, `core/reglamento.ts`) como lo
 * dibuja el prototipo en Reglas: una regla debajo de otra, con el borde del
 * color del deporte (`data-deporte` de alrededor), el rótulo chico y la regla
 * en grande. Lo usan la pantalla de Reglas y la tarjeta de reglas de Ajustes,
 * así las dos dicen lo mismo de la misma manera.
 *
 * Los puntos no van en la frase ("Gana 10, segundo 8, tercero 6…") sino como
 * dato: un casillero por puesto con el número condensado, y los que no suman
 * en una línea al final. Es lo que se mira para saber cuánto vale salir 3°.
 */
export function Reglamento({ lines, points }: { lines: readonly ReglamentoLine[]; points: readonly number[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {lines.map((line) => (
        <li key={line.key} className="border-l-4 border-sport py-0.5 pl-3.5">
          <span className="block text-[14px] font-semibold text-sport">{ROTULOS[line.key]}</span>
          {line.key === 'puntos' ? (
            <Puntos points={points} />
          ) : (
            <span className="block text-pretty text-[17px] leading-snug">{line.text}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function Puntos({ points }: { points: readonly number[] }) {
  const firstZero = points.findIndex((value) => value <= 0)
  const paying = firstZero === -1 ? points : points.slice(0, firstZero)
  return (
    <>
      <ol className="mt-1.5 grid grid-cols-4 gap-1.5">
        {paying.map((value, index) => (
          <li key={index} className="rounded-btn bg-sport-tint px-2.5 pt-1.5 pb-2">
            <span className="block text-[13px] font-semibold text-muted">{index + 1}°</span>
            <span className="font-cond block text-[30px] text-sport">{value}</span>
          </li>
        ))}
      </ol>
      {firstZero !== -1 && (
        <span className="mt-1.5 block text-[15px] text-muted">Del {firstZero + 1}° para abajo no suman</span>
      )}
    </>
  )
}
