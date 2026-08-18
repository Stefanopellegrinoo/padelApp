import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * S45 (verify-report ronda 14). Al escribir
 * `0031_promote_guest_single_side.sql` se copió de
 * `0025_promote_guest_discipline_entries.sql` "desde `promote_guest` hasta el
 * final del archivo", y 0025 define DOS funciones: `promote_guest` y un
 * `drop`+`create` de `season_invite`. Esa segunda ya había sido reemplazada
 * por `0026_season_invite_discipline_order.sql`, así que la copia revirtió
 * 0026 EN SILENCIO.
 *
 * El typecheck, el build y 305 de 306 tests quedaron en verde. Cayó uno solo,
 * y sólo porque existía: `db/claim.db.test.ts` afirma el orden que 0026
 * introdujo. Esa cobertura es real pero INCIDENTAL — protege el orden de
 * `season_invite`, no la regla.
 *
 * Esto sí protege la regla, y es la clase de bug la que importa: `promote_guest`
 * se mantiene por restatements sucesivas (`0014` → `0023` → `0025` → `0031`) y
 * el plan tiene más por delante (PR20-PR28, `tasks`). No toca la base y corre
 * en la suite pura.
 */

const DIR = join(process.cwd(), 'supabase/migrations')

/**
 * Migraciones YA APLICADAS que definen más de una función. No se pueden
 * cambiar —están en `schema_migrations` de producción— y por eso se listan en
 * vez de arreglarse. **Esta lista es la que hay que mirar antes de copiar una
 * restatement**: son exactamente los archivos donde cortar "hasta el final"
 * arrastra una función de más.
 *
 * `0025` es la que mordió: define `promote_guest` y, 20 líneas más abajo, un
 * `drop`+`create` de `season_invite` que `0026` ya había reemplazado.
 */
const HISTORICAS_CON_VARIAS = new Set(['0025_promote_guest_discipline_entries.sql'])

/** `create function`, `create or replace function` y `drop function`, a comienzo de línea. */
const DEFINITION = /^\s*(create\s+(or\s+replace\s+)?function|drop\s+function)\s+(?:if\s+exists\s+)?([\w."]+)/gim

function definedFunctions(sql: string): string[] {
  return [...sql.matchAll(DEFINITION)].map((match) => (match[3] ?? '').replace(/"/g, ''))
}

describe('migraciones — una restatement toca una sola función', () => {
  const files = readdirSync(DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()

  it('hay migraciones que leer', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  /*
   * El nombre de una migración de restatement nombra la función que restatea.
   * Ésas son las que se escriben copiando la versión viva, y las únicas donde
   * el corte "hasta el final del archivo" es un riesgo real. Las migraciones
   * de schema (DDL, backfills, grants) pueden tocar varias y no aplican.
   */
  const RESTATEMENTS = files.filter((name) => /promote_guest|close_matchday|season_invite|create_masters/.test(name))

  it('las migraciones de restatement existen y se reconocen por nombre', () => {
    expect(RESTATEMENTS.length).toBeGreaterThan(0)
  })

  for (const name of RESTATEMENTS.filter((file) => !HISTORICAS_CON_VARIAS.has(file))) {
    it(`${name} define exactamente una función`, () => {
      const sql = readFileSync(join(DIR, name), 'utf8')
      const touched = new Set(definedFunctions(sql))
      expect([...touched]).toHaveLength(1)
    })
  }

  it('las históricas con varias funciones siguen siendo las que la lista dice', () => {
    // Si esto falla es porque una migración vieja cambió (no debería) o porque
    // se agregó una nueva con varias funciones sin pensarlo. Las dos merecen
    // una mirada antes de seguir.
    const conVarias = RESTATEMENTS.filter(
      (name) => new Set(definedFunctions(readFileSync(join(DIR, name), 'utf8'))).size > 1,
    )
    expect(conVarias).toEqual([...HISTORICAS_CON_VARIAS])
  })
})
