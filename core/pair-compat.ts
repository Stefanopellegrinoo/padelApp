import { sideOfRow } from './side'
import type { EntryId, Pair, Side, SideSize } from './types'

/**
 * Adaptador TEMPORAL, nacido junto con `Side` (PR14) y BORRADO en PR19, junto
 * con `Pair`, `sideOf` y `pairOf` mismos (design #3801, tabla PUNTO 4, fila
 * "18 | fechas/page.tsx, stats/page.tsx + BORRAR Pair, sideOf, pairOf").
 *
 * Nada afuera de `core/` debería importar este archivo directo: existe sólo
 * para que PR15-PR18 migren un productor/consumidor de `Pair` a la vez, no
 * todos juntos.
 */
export function sideOf(pairValue: Pair): Side {
  return { size: 2, a: pairValue.a, b: pairValue.b }
}

/**
 * Tira con un lado de uno, y está bien: mientras este adaptador exista,
 * ningún camino PRODUCE uno (`pair_size = 2` en todas las disciplinas hasta
 * PR15). Llegar acá es un productor migrado sin su consumidor — el
 * equivalente en TypeScript del tripwire `disciplines_one_per_season`.
 */
export function pairOf(side: Side): Pair {
  if (side.size === 1) {
    throw new Error('Un lado de a uno no se lee como pareja. Falta migrar este consumidor a Side.')
  }
  return { a: side.a, b: side.b }
}

/**
 * S38 (verify-report ronda 12): el hogar único de `pairOf ∘ sideOfRow` — la
 * ÚNICA excepción exportada de este archivo, por `db/`: `db/read.ts`,
 * `db/matchday.ts` y `db/season.ts` reescribían esto a mano, byte por byte
 * (mismo mensaje incluido), en vez de importar `sideOfRow` (ya exportado) y
 * narrowear con `pairOf` (no exportado — límite real, `db/` no debe construir
 * un `Side` a mano). `pairFromRow` es la respuesta a "¿cómo lee `db/` una
 * fila cruda como `Pair`?" sin perforar ese límite: nace y muere con el
 * mismo `pairOf` (BORRADO en PR19, ver el comentario de arriba).
 */
export function pairFromRow(size: SideSize, a: EntryId, b: EntryId | null): Pair {
  return pairOf(sideOfRow(size, a, b))
}
