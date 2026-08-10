# Estado del proyecto

**Última actualización:** 10 de agosto de 2026, al cerrar el Plan 1.

Este documento es el punto de entrada. Dice qué está hecho, qué falta, y qué hay
que decidir antes de seguir. Los detalles viven en los documentos que se enlazan.

---

## Dónde estamos

| Plan | Qué produce | Estado |
|---|---|---|
| **1. `core/`** | Toda la lógica del campeonato, funciones puras | ✅ **Terminado y en `main`** |
| **2. Datos y auth** | Schema Supabase, migraciones, RLS, login + Google | ⬜ Siguiente |
| **3. Pantallas de lectura** | Tabla, Fechas, Estadísticas, Reglas, Perfil | ⬜ |
| **4. Pantallas de escritura** | Crear torneo, abrir fecha, cargar resultados, Ajustes | ⬜ |

**`core/` en números:** 13 módulos, 145 tests, cero dependencias de producción.
Verificado de forma independiente: ningún archivo usa `Date`, `Math.random`,
`fetch` ni `process`; nada importa fuera de `core/`; el grafo de dependencias es
acíclico. Eso es lo que permite recalcular una fecha vieja y obtener exactamente
lo mismo que salió la noche que se jugó.

**La superficie pública es `core/index.ts`.** Importar de una ruta profunda
funciona igual —TypeScript no lo puede impedir— pero lo que no está en el index
es detalle de implementación y puede cambiar sin aviso. Dos cosas quedaron
adentro a propósito: `allMatchings` (sólo la usa `buildPairs`) y `orderByPoints`
(los callers quieren `computeRanking`, que ya devuelve las filas ordenadas).

---

## Los documentos

| Documento | Qué es |
|---|---|
| [`superpowers/specs/2026-08-09-padel-championship-design.md`](superpowers/specs/2026-08-09-padel-championship-design.md) | **Las reglas del juego.** Fuente de verdad de todo lo que es el campeonato: formato, puntos, armado de parejas, desempates, Masters. Ante cualquier duda de comportamiento, manda este. |
| [`ui-screens.md`](ui-screens.md) | **La app.** Las 13 pantallas con su contenido, roles y estados. La navegación y por qué es como es. |
| [`padel_design/README.md`](padel_design/README.md) | **El handoff visual** de Google Stitch, ya adaptado al formato de 8 a 12. Colores, tipografía, medidas, copys. Los `.dc.html` muestran el caso de 8 y no se pueden regenerar. |
| [`superpowers/plans/2026-08-10-core-championship-logic.md`](superpowers/plans/2026-08-10-core-championship-logic.md) | **El plan 1**, ya ejecutado. Su tabla final —"Qué queda afuera de este plan, a propósito"— es la lista de requisitos que hereda el plan 2. |
| `.superpowers/sdd/2026-08-10-core-championship-logic/progress.md` | **El ledger de ejecución.** Cada fix round, cada minor diferido, cada decisión tomada y por qué. No está versionado (es scratch), pero es donde está el detalle de cada hallazgo. |

---

## Lo que hay que DECIDIR antes de escribir el plan 2

Tres cosas. Ninguna es un bug: son decisiones de arquitectura cuyo costo sube
apenas exista el schema.

### 1. ¿Quién deriva el contexto de la fecha anterior?

El spec (§3.3) dice que quién es la pareja campeona defensora **se deriva
siempre, nunca se guarda**. Pero hoy `buildPairs` lo recibe por parámetro:
`defenders`, `defendersAlreadyRepeated` y `previousPairs`. **Nadie en `core/` los
calcula.**

`defendersAlreadyRepeated` significa "¿estos dos también jugaron juntos en la
fecha *n-2*?". Esa es la regla del campeón defensor, que es el diferencial del
formato. Si termina implementada en la capa de Supabase, queda fuera del núcleo
probado y es mucho más difícil de testear.

**Recomendación:** una función pura en `core/` que reciba las dos fechas
anteriores y devuelva el contexto. Se decide al escribir el plan 2, se
implementa ahí, pero vive en `core/`.

### 2. ¿Uno o varios invitados por fecha?

`core/` toma un `guestId` único (`PairingInput.guestId`, `computeAwards`). El
schema del spec (§3.2) modela invitados como filas `entries` con
`kind = 'GUEST'` y **no limita la cantidad**.

Hoy la regla "un solo asiento extra" vive únicamente en una firma de TypeScript.
O el schema la impone con un unique, o las firmas pasan a tomar un conjunto.

**Decidirlo ahora que es un cambio de firma y no una migración.**

### 3. ¿Qué tabla arma las parejas?

El spec (§2.5 paso 4) dice "ordenar el pool por la tabla de puntos", y la tabla
aplica mejores N de M (§2.1). **Hay dos versiones de esto en el repo:**
`snapshots.ts` lo hace bien (pasa por `computeRanking`), pero el harness de
integración usa una suma cruda acumulada.

Con `countBestOf: 8` de 10 fechas, desde la fecha 9 divergen. El plan 2 va a
copiar el que lea primero.

**Es el ranking.** Hay que dejarlo escrito antes de que alguien copie el otro.

---

## Lo que falta implementar, por plan

### Plan 2 — datos y auth

De la tabla del plan 1, más lo que salió de las revisiones:

- Schema de Supabase, migraciones y RLS
- Auth: email y contraseña, más Google. **No hay magic link** (teniendo
  contraseña sería un tercer camino sin aporte)
- Reclamo de asiento por link de invitación
- Cerrar una fecha en una transacción atómica, y poder reabrirla
- **Validar resultados contra `matchFormat`** al guardar
- **Rechazar un set con games iguales** (un `4-4`). `SetScore` sólo guarda
  `gamesA`/`gamesB`, así que un set empatado no le suma a nadie: la pareja
  juega, no gana, y el head-to-head devuelve 0. Es un empate silencioso en un
  deporte que no tiene empates. `core/standings.ts` hace bien en no inventar un
  ganador; **el borde tiene que impedir que ese dato entre**
- **Llamar a `validateConfig` siempre.** Devuelve errores, no los tira, así que
  sólo protege a quien los mira. Con `tiebreakSnapshotEvery: 0` la cadena de
  snapshots entra en **loop infinito**
- Las tres decisiones de arriba

### Plan 3 — pantallas de lectura

- Tabla, Fechas, Estadísticas, Reglas, Perfil de jugador
- **Sanitizar el markdown** que escribe el admin en la página de reglas
- **Racha de defensas como estadística** (spec §2.4). Ningún módulo la calcula y
  no estaba deferida en ningún lado — salió en la revisión final

### Plan 4 — pantallas de escritura

- Crear torneo (wizard de 5 pasos), abrir fecha, cargar resultados, Ajustes
- **Decidir el tamaño de la fecha desde las asistencias** y agregar el asiento de
  invitado cuando el número da impar
- **Que el admin pueda mover al invitado** en el orden (spec §2.6). `core/` lo
  pone último y respeta el orden que le den; la UI tiene que ofrecer el arrastre

### Dos pantallas que cambiaron de layout y todavía nadie miró

Al adaptar el diseño de Stitch al formato de 8 a 12, dos pantallas necesitaron
un layout nuevo, no sólo otro copy. Están marcadas con 🔁 en el handoff:

- **Wizard paso 4:** los puntos eran 4 columnas. Con 12 jugadores son 6 valores
  y no entran a lo ancho de un teléfono. Pasaron a filas
- **Fecha en juego:** eran 3 rondas × 2 partidos fijas. Con 6 parejas son 15
  partidos, así que las rondas pasaron a acordeón, con la ronda en curso abierta
  y las completas colapsadas

**Conviene mirarlas antes de que el plan 3 las implemente.** Discutir un layout
es barato; rehacerlo después de construido, no.

---

## Deuda conocida en `core/`

Nada de esto rompe nada hoy. Está todo verificado y triageado; queda anotado para
que sea una decisión y no un olvido.

**Un test que no protege lo que dice.** `core/standings.test.ts`, el test
"does not mutate the pairs it receives": el fixture que usa tiene un orden
correcto que coincide con el orden en que están declaradas las parejas, así que
un `sort` en el lugar lo dejaría igual y el test pasaría lo mismo.
`computeStandings` hoy **no** muta nada —verificado, construye un array nuevo con
`map`—, o sea que es deuda de test, no un defecto.
*El arreglo es una línea:* usar el fixture de head-to-head de ese mismo archivo,
donde el orden correcto pone `b1` antes que `a1`, invertido respecto del
declarado.

**Cosméticos, del ledger:**

- `samePair` vive en `pairing.ts`, pero es una propiedad de `Pair`. Como
  `standings.ts` lo importa de ahí, arrastra `allMatchings` y `orderByPoints` sin
  necesitarlos. Moverlo a `types.ts` aplana el grafo
- `buildFixture` y `mastersFixture` comparten la palabra "fixture" y no comparten
  forma: uno devuelve rondas de índices, el otro una lista de parejas
- `standings.ts` descarta en silencio un partido cuyas parejas no están en la
  lista. El spec (§4.5) dice que una violación de invariante en `core/` debe
  fallar ruidosamente
- `pairing.ts` acota el *pool*, no los *presentes*: 14 presentes con defensores
  fijos dejan un pool de 12 y pasan. Falla después, con un mensaje sobre la lista
  de puntos en vez de sobre el tamaño de la fecha
- Faltan fixtures para dos de los cuatro repartos posibles de una fecha de 4
  parejas: `3-1-1-1` y `2-2-1-1`

**El harness de integración es deliberadamente disparejo.** Como el fixture deja
siempre a la pareja 0 de local y el local siempre gana, **la pareja 0 gana todos
los partidos de todas las fechas**. Está documentado en el propio archivo. No
invalida ninguna aserción, pero significa que las pruebas de temporada nunca
ejercitan una tabla que se mueve ni un campeón que rota. Un segundo harness con
otra regla determinista —por ejemplo, que gane la pareja peor rankeada en las
rondas impares— costaría unas quince líneas y ejercitaría la cadena de snapshots
bajo movimiento real. Es la mejor mejora de test disponible.

---

## Cómo se trabaja acá

Lo que funcionó en el plan 1 y conviene repetir:

**Los bloques de código del plan son código.** El plan 1 llevaba la
implementación completa de cada módulo, y los implementadores la transcribían.
Eso salió bien —cero deriva— pero significa que **un defecto en el plan se
propaga intacto a la rama**. Cuatro de los seis hallazgos importantes de la
revisión final venían del plan o del spec, no de nadie que implementara. Para los
planes 2 a 4: los bloques de código del plan merecen la misma revisión que las
implementaciones, *antes* de despacharlos.

**Pedir cuentas a mano, no confianza en los tests.** Los revisores rindieron
muchísimo más cuando se les pidió *calcular*: enumerar los ocho resultados
posibles del Masters, trazar la rotación del round robin para 4 parejas, computar
`floor((f-1)/k)` en los bordes. Un test y un código pueden estar equivocados de
acuerdo, y eso ninguna suite lo detecta.

**Tres lecciones sobre tests, que costaron rondas:**

- `toContain` responde *"¿está?"*, nunca *"¿dónde?"*. Cuando el contrato es el
  **orden**, hay que asertar posiciones
- Un `not.toContain` en verde no prueba nada si la frase que nombra no es una que
  el código pueda producir. Un cambio de string dejó un test pasando por vacuidad
- La prosa se despega del comportamiento sin que ningún test lo note. La página
  de reglas describía un desempate distinto al que el código hacía
