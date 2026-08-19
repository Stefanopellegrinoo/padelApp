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
 *
 * W58 (verify-report ronda 17): el `sinComentarios` de W52 se aplicó a un
 * assert y no al gemelo. Medido por la auditoría: borrar la llamada a
 * `frozenPointsOf` y dejar un comentario que la nombre pasaba VERDE (5 passed),
 * o sea la pantalla podía dejar de leer los puntos congelados —que es
 * literalmente C21— sin que el tripwire lo viera. Los dos asserts miran el
 * fuente sin comentarios.
 *
 * S58: el regex de W52 pasó de exigir paréntesis a `\bcomputeAwards\b`, así que
 * una MENCIÓN de la palabra en un string lo ponía rojo (medido: 1 failed con
 * `const zz = 'ver computeAwards(x) en el historial'`). El falso positivo no
 * había desaparecido, se había mudado.
 *
 * W60 (verify-report ronda 18): el arreglo de S58 fue angostar el assert a las
 * líneas `^import … from …`, y eso cambió un falso positivo ruidoso por un
 * falso negativo SILENCIOSO. Medido en los dos builds sobre el archivo real:
 * `const { computeAwards } = await import('@/core')` y
 * `const zzCore = require('@/core'); zzCore.computeAwards` se ponían ROJOS
 * antes del angostamiento y pasaban VERDES después — un import dinámico no
 * pasa por una línea `^import … from`, y una llamada suelta tampoco. La
 * detección volvió a ser ancha —todo el fuente ejecutable— sacándole los
 * literales de string, que era lo único que producía el falso positivo de S58.
 * Gana las dos, así que no hay que elegir.
 */

/** El fuente sin comentarios de línea ni de bloque: lo que de verdad se ejecuta. */
function sinComentarios(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

/**
 * El fuente sin comentarios y sin literales de string: lo que de verdad se
 * ejecuta, menos el texto que sólo se muestra.
 *
 * ponytail: es un blanqueo por regex, no un parser de TypeScript, y el techo es
 * un falso NEGATIVO acotado a una línea. Un apóstrofo suelto en texto JSX borra
 * hasta la comilla siguiente de esa línea, y `sinComentarios` ya corta en un
 * `//` que viva adentro de un string (una URL). Medido hoy sobre los dos
 * archivos cubiertos: CERO líneas con comillas simples impares, y los tokens
 * que este test mira (`frozenTableRows`, `orderMoved`, `frozenPointsOf`,
 * `computeAwards`) aparecen la misma cantidad de veces antes y después de
 * blanquear. Se acepta el techo porque esto es una RED, no una prueba: cuando
 * falla de más deja pasar algo raro, nunca afirma que la pantalla esté bien. Si
 * alguna vez hace falta precisión de verdad, el reemplazo es un parser.
 */
function sinStrings(source: string): string {
  return sinComentarios(source).replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, ' ')
}

const PAGE = join(
  process.cwd(),
  'app/torneo/[id]/[disciplina]/fechas/[n]/page.tsx',
)

/**
 * El módulo al que la ronda 17 extrajo el ORDEN de la tabla congelada. Extraer
 * un módulo es justo el hueco que este tripwire tiene declarado ("si el
 * recálculo se extrae a un módulo, no lo ve"), así que el módulo entra acá en
 * el mismo movimiento que lo creó.
 */
const TABLA = join(
  process.cwd(),
  'app/torneo/[id]/[disciplina]/fechas/[n]/tabla-congelada.ts',
)

describe('la pantalla de una fecha no recalcula sus puntos', () => {
  const source = readFileSync(PAGE, 'utf8')

  it('el archivo existe donde este test lo busca', () => {
    expect(source.length).toBeGreaterThan(0)
  })

  for (const [nombre, archivo] of [
    ['page.tsx', PAGE],
    ['tabla-congelada.ts', TABLA],
  ] as const) {
    it(`${nombre} no nombra computeAwards en código, ni con alias ni por import dinámico`, () => {
      // Lo que se mira es la MENCIÓN de la palabra fuera de un string, en todo
      // el fuente ejecutable. Cualquier forma de llegar a ella la nombra al
      // menos una vez: el import directo, el renombrado (`as repartir`), el
      // dinámico (`await import('@/core')`), el `require` con acceso por
      // propiedad, y hasta una llamada suelta sin import.
      //
      // W60: NO se mira sólo la línea de `import`. Se probó y perdía los dos
      // últimos casos en silencio; el detalle está en el bloque de arriba.
      //
      // `computeAwards` reparte según los `guestIds` de HOY, y después de
      // promover un invitado ese conjunto cambia. Quien reparte es
      // `closeMatchday`, una sola vez; la pantalla lee.
      expect(sinStrings(readFileSync(archivo, 'utf8'))).not.toMatch(/\bcomputeAwards\b/)
    })
  }

  it('el chequeo hace trabajo real sobre page.tsx, que la nombra en prosa', () => {
    // S59: la versión anterior afirmaba esto sobre un string sintético que ella
    // misma escribía, así que se podía romper el assert de arriba y ésta seguía
    // verde. `page.tsx` menciona `computeAwards` EN PROSA (`:360`, `:365`,
    // `:582`), así que las dos mitades juntas —el fuente crudo SÍ la menciona,
    // el predicado NO— prueban sobre el archivo REAL que el filtro está
    // haciendo trabajo y no es decorativo.
    //
    // Sí, la primera mitad se cae si alguien borra esos comentarios. Es
    // deliberado: sin una mención real en el archivo, el assert de arriba pasa
    // por vacío y nadie se entera.
    expect(source).toMatch(/\bcomputeAwards\b/)
    expect(sinStrings(source)).not.toMatch(/\bcomputeAwards\b/)
  })

  it('caza el alias y el import dinámico, y no se rompe con un string ni con un import comentado', () => {
    // S59: éste es sintético por necesidad —`page.tsx` no puede a la vez
    // nombrarla y no nombrarla— pero ya no es una tautología. Cada mitad falla
    // contra una versión anterior del chequeo:
    //   · el alias, contra el regex de llamada de antes de W52
    //   · el dinámico, contra el `soloImports` de S58 (W60)
    //   · el string, contra el `\bcomputeAwards\b` sobre todo el fuente (S58)
    //   · el import comentado adentro del bloque, si se saca `sinComentarios`
    const conAlias = `import { computeAwards as repartir } from '@/core'\nconst p = repartir(a, b, c)\n`
    expect(sinStrings(conAlias)).toMatch(/\bcomputeAwards\b/)

    const dinamico = `const { computeAwards } = await import('@/core')\n`
    expect(sinStrings(dinamico)).toMatch(/\bcomputeAwards\b/)

    const enUnString = `import { members } from '@/core'\nconst zz = 'ver computeAwards(x) en el historial'\n`
    expect(sinStrings(enUnString)).not.toMatch(/\bcomputeAwards\b/)

    const comentadoAdentro = `import {\n  /* computeAwards, */\n  members,\n} from '@/core'\n`
    expect(sinStrings(comentadoAdentro)).not.toMatch(/\bcomputeAwards\b/)
  })

  it('lee los puntos congelados', () => {
    // La otra mitad: que no recalcule no alcanza si tampoco lee. `frozenPointsOf`
    // es la consulta a `awards` tal cual quedaron al cerrar.
    //
    // W58: esto miraba el fuente CRUDO, así que borrar la llamada y dejar un
    // comentario que la nombre pasaba verde — el defecto exacto que W52 arregló
    // cinco líneas más arriba, del lado que protege contra C21.
    expect(sinComentarios(source)).toMatch(/frozenPointsOf\s*\(/)
  })

  it('usa el orden congelado y gatea el pie con las MISMAS filas', () => {
    // W59 (verify-report ronda 18): la ronda 17 extrajo el criterio de orden a
    // `tabla-congelada.ts` y le puso 6 tests buenos, pero extraer mueve el
    // riesgo al PUNTO DE UNIÓN, y ahí no había nada. Medido por la auditoría
    // sobre el archivo real, suite entera: tres ediciones de UNA línea en
    // `page.tsx` reabren W55, W56 y W57 EN PANTALLA y pasaban 459/459.
    //   · `const tableRows = standings`                        → W55 y W57
    //   · `const note = status === 'CLOSED' ? tiebreakNote(…)` → W56
    //   · `orderMoved(standings.map((r) => ({ ...r })), …)`    → W56
    //
    // Mismo defecto que W58 —cubrir un lado y no el gemelo— y mismo remedio que
    // el assert de `frozenPointsOf` de acá arriba: no prueban que la pantalla
    // esté bien, prueban que no dejó de hacer las dos cosas que la arreglaron.
    //
    // Los ARGUMENTOS van pinchados, no sólo el nombre, porque los dos contratos
    // son de IDENTIDAD DE FILA: `frozenTableRows` devuelve los mismos objetos y
    // `orderMoved` es `drawn[index] !== row`. Colar un `.map((r) => ({ ...r }))`
    // en cualquiera de los dos lados deja el nombre intacto, da "se movió"
    // siempre, y el pie desaparece de TODA fecha cerrada. Ésa es la sonda L, y
    // contra un regex de sólo el nombre pasa verde.
    //
    // ponytail: pinchar los nombres de las variables se rompe si alguien las
    // renombra. El error posible es un falso POSITIVO ruidoso —el test se pone
    // rojo y se lee este comentario—, que es el lado correcto del que
    // equivocarse para un chequeo estático.
    expect(sinComentarios(source)).toMatch(
      /frozenTableRows\s*\(\s*standings\s*,\s*frozenPoints\s*\)/,
    )
    expect(sinComentarios(source)).toMatch(/orderMoved\s*\(\s*standings\s*,\s*tableRows\s*\)/)
  })
})
