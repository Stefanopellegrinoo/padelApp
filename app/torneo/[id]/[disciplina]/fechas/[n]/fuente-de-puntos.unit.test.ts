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
 *
 * W52 (verify-report ronda 16): la primera versión miraba el texto crudo y era
 * frágil por los dos lados — un COMENTARIO que mencionara `computeAwards(` la
 * rompía (y este archivo y `page.tsx` lo mencionan mucho), y un recálculo por
 * ALIAS (`import { computeAwards as repartir }`) se le escapaba. Ahora corre
 * sobre el archivo SIN comentarios y mira el IMPORT, que es por donde tiene que
 * entrar cualquier forma de llamarla.
 */

/** El fuente sin comentarios de línea ni de bloque: lo que de verdad se ejecuta. */
function sinComentarios(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

const PAGE = join(
  process.cwd(),
  'app/torneo/[id]/[disciplina]/fechas/[n]/page.tsx',
)

describe('la pantalla de una fecha no recalcula sus puntos', () => {
  const source = readFileSync(PAGE, 'utf8')

  it('el archivo existe donde este test lo busca', () => {
    expect(source.length).toBeGreaterThan(0)
  })

  it('no importa computeAwards, ni con alias', () => {
    // El import es el cuello de botella: cualquier forma de llamarla —directa,
    // renombrada, o guardada en una variable— tiene que pasar por acá.
    // `computeAwards` reparte según los `guestIds` de HOY, y después de
    // promover un invitado ese conjunto cambia. Quien reparte es
    // `closeMatchday`, una sola vez; la pantalla lee.
    expect(sinComentarios(source)).not.toMatch(/\bcomputeAwards\b/)
  })

  it('el chequeo no se rompe por un comentario que la nombre', () => {
    // W52: la versión anterior miraba el texto crudo, así que un comentario
    // como este —`computeAwards(standings, ...)`— la ponía en rojo. El fuente
    // de este mismo archivo la menciona varias veces y sigue en verde.
    const conComentario = `// computeAwards(standings, config, guestIds)\nconst x = 1\n`
    expect(sinComentarios(conComentario)).not.toMatch(/\bcomputeAwards\b/)
  })

  it('caza un recálculo escondido detrás de un alias', () => {
    // W52, la otra mitad: `import { computeAwards as repartir }` se le escapaba
    // al regex de llamada. Mirando el import, no.
    const conAlias = `import { computeAwards as repartir } from '@/core'\nconst p = repartir(a, b, c)\n`
    expect(sinComentarios(conAlias)).toMatch(/\bcomputeAwards\b/)
  })

  it('lee los puntos congelados', () => {
    // La otra mitad: que no recalcule no alcanza si tampoco lee. `frozenPointsOf`
    // es la consulta a `awards` tal cual quedaron al cerrar.
    expect(source).toMatch(/frozenPointsOf\s*\(/)
  })
})
