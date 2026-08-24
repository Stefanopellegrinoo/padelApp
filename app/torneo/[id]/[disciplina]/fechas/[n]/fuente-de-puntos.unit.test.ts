import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * W48. C21 fue un CRITICAL de pantalla —promover un
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
 * W52: la primera versión miraba el texto crudo y era
 * frágil por los dos lados — un COMENTARIO que mencionara `computeAwards(` la
 * rompía (y este archivo y `page.tsx` lo mencionan mucho), y un recálculo por
 * ALIAS (`import { computeAwards as repartir }`) se le escapaba. Ahora corre
 * sobre el archivo SIN comentarios y mira el IMPORT, que es por donde tiene que
 * entrar cualquier forma de llamarla.
 *
 * W58: el `sinComentarios` de W52 se aplicó a un
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
 * W60: el arreglo de S58 fue angostar el assert a las
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

/**
 * Corta un `condición ? (rama A) : (rama B)` en sus dos mitades de TEXTO,
 * partiendo por el `) : (` literal que separa el `?` del `:` — no por
 * distancia de caracteres (S88: un regex laxo del tipo `? (…{0,N}…rama` puede
 * "atravesar" el `) : (` y leer contenido de la OTRA rama como si fuera
 * propio, porque el regex no entiende balanceo de JSX). `partida` corta
 * desde el `?` hasta el `) : (`; `sinPartir` sigue desde ahí hasta el techo
 * fijo `limite` — no hasta el cierre real del ternario (encontrarlo pediría
 * balancear paréntesis, que es exactamente lo que este helper evita), así
 * que sólo sirve para mirar el PRINCIPIO de la rama sin partir, que es todo
 * lo que este archivo necesita.
 */
function ramasDelSplit(fuente: string, limite = 400): { partida: string; sinPartir: string } {
  const inicio = fuente.indexOf('groupedStandings.length > 0 ?')
  if (inicio === -1) return { partida: '', sinPartir: '' }
  const separador = fuente.indexOf(') : (', inicio)
  if (separador === -1) return { partida: '', sinPartir: '' }
  return {
    partida: fuente.slice(inicio, separador),
    sinPartir: fuente.slice(separador, separador + limite),
  }
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
      // NO se mira sólo la línea de `import`. Se probó y perdía los dos
      // últimos casos en silencio; el detalle está en el bloque de arriba.
      //
      // `computeAwards` reparte según los `guestIds` de HOY, y después de
      // promover un invitado ese conjunto cambia. Quien reparte es
      // `closeMatchday`, una sola vez; la pantalla lee.
      expect(sinStrings(readFileSync(archivo, 'utf8'))).not.toMatch(/\bcomputeAwards\b/)
    })
  }

  it('el chequeo hace trabajo real sobre page.tsx, que la nombra en prosa', () => {
    // La versión anterior afirmaba esto sobre un string sintético que ella
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
    // Éste es sintético por necesidad —`page.tsx` no puede a la vez
    // nombrarla y no nombrarla— pero ya no es una tautología. Cada mitad falla
    // contra una versión anterior del chequeo:
    // · el alias, contra el regex de llamada de antes de W52
    // · el dinámico, contra el `soloImports` de S58
    // · el string, contra el `\bcomputeAwards\b` sobre todo el fuente
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
    // Esto miraba el fuente CRUDO, así que borrar la llamada y dejar un
    // comentario que la nombre pasaba verde — el defecto exacto que W52 arregló
    // cinco líneas más arriba, del lado que protege contra C21.
    expect(sinComentarios(source)).toMatch(/frozenPointsOf\s*\(/)
  })

  it('usa el orden congelado y gatea el pie con las MISMAS filas', () => {
    // La ronda 17 extrajo el criterio de orden a
    // `tabla-congelada.ts` y le puso 6 tests buenos, pero extraer mueve el
    // riesgo al PUNTO DE UNIÓN, y ahí no había nada. Medido sobre el
    // archivo real, suite entera: tres ediciones de UNA línea en
    //`page.tsx` reabren W55, W56 y W57 EN PANTALLA y pasaban 459/459.
    // · `const tableRows = standings` → W55 y W57
    // · `const note = status === 'CLOSED' ? tiebreakNote(…)` → W56
    // · `orderMoved(standings.map((r) => ({...r })), …)` → W56
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

  // PR20 rebanada B. `MatchdaySummary.allowsDraw` tiene UN SOLO consumidor en
  // todo el repo —esta línea— y nada lo miraba: la cuarta vez que extraer o
  // generalizar deja el punto de unión sin red (W59, el aviso de D1, W66, y
  // ahora esto).
  //
  // Lo que se pierde si se mis-wirea es exactamente el bug que la rebanada vino
  // a cerrar: con un `false` fijo, la tabla del día de una liga de FIFA vuelve
  // a pagar lo mismo por un empate que por una derrota, y `npm test` no se
  // entera porque `computeStandings` y `tiebreakNote` siguen bien testeados
  // cada uno por su lado.
  //
  // Va por FUENTE y no renderizando porque `page.tsx` es un server component
  // `async` de ~700 líneas que abre el cliente de Supabase y ramifica en cuatro
  // estados de fecha: montarlo pediría mockear ocho lectores para pinchar un
  // argumento. El techo, declarado: falso POSITIVO si alguien renombra
  // `detail`, `config` o `snapshot` — el lado correcto del que equivocarse.
  //
  // W71 (verify-report-pr21 #4004): el segundo argumento dejó de ser
  // `detail.matches` a secas — la restricción de pureza del design (#3801,
  // PUNTO 6) obliga a filtrar por fase antes de tabular, y ese filtro vive en
  // `standingsMatches`. Pinchar el nombre nuevo, no `detail.matches`, es lo
  // que hace que este test note si alguien vuelve a pasar el array crudo.
  it('le pasa a la tabla el allows_draw CONGELADO de la fecha, no un booleano fijo', () => {
    expect(sinComentarios(source)).toMatch(
      /computeStandings\s*\(\s*detail\.sides\s*,\s*standingsMatches\s*,\s*config\s*,\s*snapshot\s*,\s*matchday\.allowsDraw\s*,?\s*\)/,
    )
  })

  // PR20 rebanada B, segunda parte. La tabla del día salió a `TablaDelDia` para
  // poder renderizarla, y eso mueve el riesgo acá: el componente tiene 10 tests
  // y el CABLEADO no tenía ninguno. Los tres argumentos son load-bearing y
  // fallan en silencio:
  //
  // · `filas={tableRows...}` — con `standings` en su lugar se reabren W55 y W57
  //   EN PANTALLA (la tabla de una fecha cerrada deja de usar el orden
  //   congelado). Es el mismo contrato que los dos asserts de arriba, pero del
  //   lado de quien DIBUJA; antes lo cubría el `tableRows.map` del JSX, que ya
  //   no vive en este archivo.
  // · `muestraEmpates={matchday.allowsDraw}` — con un `true` fijo el pádel gana
  //   una columna de ceros que Stefano decidió que NO va; con `false` fijo, la
  //   tabla de FIFA vuelve a no poder explicar su propio orden.
  // · `drawn: row.drawn` — un `row.won` ahí dibuja una columna que miente, y
  //   miente con un número plausible, que es la peor clase.
  it('le pasa a la tabla las filas congeladas, los empates de la fecha y el drawn real', () => {
    const fuente = sinComentarios(source)
    // S88 (verify-report-pr21-cierre #4016): antes esto pinchaba
    // `filas={tableRows.map` SUELTO, en cualquier parte del archivo. Desde
    // S82, `tableRows.map` sólo vive en la rama SIN partir — la que
    // `page.tsx` usa cuando NO se separa por grupo (CLOSED, ROUND_ROBIN, o
    // ahora también el OPEN con un lado sin partido de GRUPO, W82) — y la
    // rama partida (OPEN + GROUPS_KNOCKOUT completo) usa `rows.map`. Un
    // chequeo que sólo busca "el archivo menciona esa forma en algún lado"
    // seguiría verde aunque las dos ramas se intercambiaran: pasó de probar
    // "la pantalla usa las filas congeladas" a probar que el string existe.
    //
    // `ramasDelSplit` (abajo) aísla las dos mitades del ternario
    // `groupedStandings.length > 0 ? (rama A) : (rama B)` CORTANDO el texto
    // en el `) : (` literal — no con un regex laxo de distancia, que ya se
    // probó que puede "atravesar" el `) : (` y leer la rama de al lado como
    // si fuera la propia (medido en el test de mutación de abajo).
    const { partida, sinPartir } = ramasDelSplit(fuente)
    expect(partida).toMatch(/filas=\{\s*rows\s*\.\s*map\b/)
    expect(sinPartir).toMatch(/filas=\{\s*tableRows\s*\.\s*map\b/)
    expect(fuente).toMatch(/muestraEmpates=\{\s*matchday\.allowsDraw\s*\}/)
    expect(fuente).toMatch(/\bdrawn:\s*row\.drawn\b/)
  })

  // S88, mutación: si alguien intercambiara las dos ramas —la partida (OPEN,
  // `GROUPS_KNOCKOUT` completo) pasa a usar `tableRows.map` y la sin partir
  // pasa a usar `rows.map`—, el chequeo VIEJO (sólo el nombre, sin anclar al
  // ternario) seguía viendo `tableRows.map` en el archivo y pasaba igual,
  // aunque la rama que de verdad protege W55/W57 (la que corre en CLOSED) ya
  // no fuera esa. `ramasDelSplit` sí lo nota: cada mitad queda con el `.map`
  // que no le corresponde. Sintético, mismo idioma que el resto del archivo
  // (`misWire` más abajo) — no se muta `page.tsx` de verdad para no dejar
  // una mutación mal revertida en un archivo de producción.
  it('y con las ramas intercambiadas: el chequeo viejo no se daba cuenta, el nuevo sí', () => {
    const intercambiado = `
      {groupedStandings.length > 0 ? (
        <div>
          <TablaDelDia filas={tableRows.map((row) => ({ key: row.side }))} />
        </div>
      ) : (
        <TablaDelDia filas={rows.map((row) => ({ key: row.side }))} />
      )}
    `
    const checkViejo = /filas=\{\s*tableRows\s*\.\s*map\b/
    expect(intercambiado).toMatch(checkViejo) // el viejo no se entera: sigue viendo el string

    const { partida, sinPartir } = ramasDelSplit(intercambiado)
    expect(partida).not.toMatch(/filas=\{\s*rows\s*\.\s*map\b/) // la partida quedó con tableRows.map
    expect(sinPartir).not.toMatch(/filas=\{\s*tableRows\s*\.\s*map\b/) // la sin partir quedó con rows.map
  })

  // El error de la ronda 18, que la 22 ya tuvo que corregir una vez: pinchar el
  // NOMBRE no alcanza, porque un mis-wire lo conserva intacto. Queda escrito
  // como test y no como comentario.
  it('y pinchar sólo el nombre no serviría: el mis-wire lo conserva', () => {
    const misWire = 'const standings = computeStandings(detail.sides, detail.matches, config, snapshot, false)'
    expect(misWire).toMatch(/computeStandings\s*\(/)
    expect(misWire).not.toMatch(/,\s*matchday\.allowsDraw\s*,?\s*\)/)
  })
})
