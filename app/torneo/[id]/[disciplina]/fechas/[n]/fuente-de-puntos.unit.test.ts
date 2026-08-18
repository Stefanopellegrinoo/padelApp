import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * W48 (verify-report ronda 15). C21 fue un CRITICAL de pantalla —promover un
 * invitado de a uno mataba la fecha con un `Error` sin mensaje— y **ningún
 * test del repo lo cazaba**. Lo encontró la auditoría levantando el server con
 * sesión real. El RED que escribí para arreglarlo (`dia-state.unit.test.ts`)
 * se borró en el GREEN porque quedó tautológico, y el test de base que dejé en
 * su lugar pasa igual contra el código roto: la auditoría lo comprobó copiando
 * `db/promote.db.test.ts` al árbol de `078d935` (22 passed).
 *
 * No hay runner E2E en el repo, así que nada automatizado mira el render. Lo
 * que sí se puede fijar es la REGLA, y es exactamente la que se violó: **una
 * fecha cerrada muestra los `awards` congelados, no un recálculo**. Los
 * congelados son lo que la fecha repartió, y una fecha cerrada no vuelve a
 * repartir.
 *
 * Es un chequeo estático y crudo a propósito — mismo criterio que
 * `db/migrations.unit.test.ts`, que ya demostró servir. No prueba que la
 * pantalla esté bien; prueba que no volvió a hacer la única cosa que la rompió.
 */

const PAGE = join(
  process.cwd(),
  'app/torneo/[id]/[disciplina]/fechas/[n]/page.tsx',
)

describe('la pantalla de una fecha no recalcula sus puntos', () => {
  const source = readFileSync(PAGE, 'utf8')

  it('el archivo existe donde este test lo busca', () => {
    expect(source.length).toBeGreaterThan(0)
  })

  it('no llama a computeAwards', () => {
    // `computeAwards` reparte según los `guestIds` de HOY. Después de promover
    // un invitado ese conjunto cambia, y el reparto deja de coincidir con lo
    // que la fecha grabó al cerrarse. Quien lo reparte es `closeMatchday`, una
    // sola vez; la pantalla lee.
    const llamadas = [...source.matchAll(/(?<![.\w])computeAwards\s*\(/g)]
    expect(llamadas).toHaveLength(0)
  })

  it('lee los puntos congelados', () => {
    // La otra mitad: que no recalcule no alcanza si tampoco lee. `frozenPointsOf`
    // es la consulta a `awards` tal cual quedaron al cerrar.
    expect(source).toMatch(/frozenPointsOf\s*\(/)
  })
})
