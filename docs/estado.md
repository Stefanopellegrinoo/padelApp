# Estado del proyecto

**Última actualización:** 11 de agosto de 2026, con el Plan 4 a mitad de camino.

Este documento es el punto de entrada. Dice qué está hecho, qué falta, y qué hay
que decidir antes de seguir. Los detalles viven en los documentos que se enlazan.

---

## Dónde estamos

| Plan | Qué produce | Estado |
|---|---|---|
| **1. `core/`** | Toda la lógica del campeonato, funciones puras | ✅ **Terminado y en `main`** |
| **2. Datos y auth** | Schema Supabase, migraciones, RLS, login + Google | ✅ **Terminado**, rama `plan-2-data-and-auth` |
| **3. Pantallas de lectura** | Tabla, Fechas, Estadísticas, Reglas, Perfil | ✅ **Terminado**, rama `plan-3-read-screens` |
| **4. Pantallas de escritura** | Crear torneo, abrir fecha, cargar resultados, Ajustes | 🚧 **6 de 14 tareas**, rama `plan-4-write-screens` |

> **Si estás retomando: arrancá por la Task 8.** El estado exacto —qué está
> hecho, qué falta, en qué orden y qué desvíos ya ocurrieron— está en la sección
> "Dónde quedó la ejecución" y en "Aparecidos" del
> [plan 4](superpowers/plans/2026-08-11-write-screens.md). Esta página resume;
> ese documento manda.

**`core/` en números:** 13 módulos, 145 tests, cero dependencias de producción.
Verificado de forma independiente: ningún archivo usa `Date`, `Math.random`,
`fetch` ni `process`; nada importa fuera de `core/`; el grafo de dependencias es
acíclico. Eso es lo que permite recalcular una fecha vieja y obtener exactamente
lo mismo que salió la noche que se jugó.

**El Plan 2 en números:** 5 migraciones, 10 tablas con RLS, 4 funciones `security
definer`, **215 tests unitarios y 92 contra la base**. `npm run build` compila.

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
| [`superpowers/plans/2026-08-10-data-and-auth.md`](superpowers/plans/2026-08-10-data-and-auth.md) | **El plan 2**, ejecutado. 14 tareas. Sus secciones "Las tres decisiones" y "Decisiones registradas" son las que mandan sobre cualquier cosa que diga este documento. Su "Aparecidos" tiene lo que quedó sin hacer. |
| [`superpowers/plans/2026-08-10-read-screens.md`](superpowers/plans/2026-08-10-read-screens.md) | **El plan 3**, ejecutado. 11 tareas, formato liviano: interfaces y "qué NO hace", con bloques de código completos sólo donde había lógica nueva. Su "Aparecidos" es la deuda conocida de las pantallas. |
| [`superpowers/plans/2026-08-11-write-screens.md`](superpowers/plans/2026-08-11-write-screens.md) | **El plan 4**, escrito y sin ejecutar. 14 tareas. Su tabla "El trazado" dice qué dato necesita cada pantalla y de ahí salen las primeras cuatro tareas; sus "Decisiones registradas" mandan sobre lo que dice este documento —una de ellas corrige el alcance de acá abajo—. |
| `.superpowers/sdd/2026-08-10-core-championship-logic/progress.md` | **El ledger de ejecución.** Cada fix round, cada minor diferido, cada decisión tomada y por qué. No está versionado (es scratch), pero es donde está el detalle de cada hallazgo. |

---

## Las tres decisiones que estaban abiertas, resueltas

Las tres se cerraron al escribir el plan 2. El detalle completo, con lo que cada
una arrastra, está en ese plan; acá va el resultado.

### 1. El contexto de la fecha anterior se deriva en `core/`

Módulo nuevo `core/history.ts`, no una query en la capa de Supabase. Recibe las
filas crudas de las dos fechas anteriores y devuelve `defenders`,
`defendersAlreadyRepeated` y `previousPairs`.

**No hace falta recomputar la tabla de la fecha anterior:** `awards` congela
`position`, así que el campeón es la pareja que contiene un asiento con
`position: 1`. Eso resuelve gratis el caso de la pareja mixta, porque el
compañero del torneo sí cobra.

### 2. Varios invitados por fecha, y el admin decide si juegan juntos

Se descartó "uno solo con un unique en el schema". Puede sumarse un equipo de
invitados a una fecha: juegan, no suman puntos, es un amistoso adentro de la
fecha. **Como máximo un invitado juega con alguien del torneo; el resto entra de
a dos.**

Lo que casi se nos pasa: el armado **no** los deja juntos solo. `orderPool` los
manda al fondo y `buildPairs` empareja primero-con-último, así que dos invitados
sueltos salen en dos parejas mixtas. Que jueguen juntos es una regla nueva
—parejas fijas, como los defensores—, no un efecto automático.

De ahí salen: `guestIds` en vez de `guestId`, `fixedPairs` en `PairingInput`,
`computeAwards` compactando posiciones sobre las parejas del torneo, y
`Award.position` pasando a significar posición del campeonato.

### 3. La tabla que arma las parejas es el ranking, mejores N de M

Nunca una suma cruda. La razón que decide: `snapshots.ts:31` ya construye la
cadena de desempate con `computeRanking`, así que emparejar por suma cruda
mezclaría dos bases. Además, la tabla que ves en pantalla tiene que ser la que
te empareja.

`matchday.test.ts:191` (`tally`) es la suma cruda y queda arreglado en la Task 2
del plan 2.

---

## Lo que falta implementar, por plan

### Plan 2 — datos y auth ✅

Las 14 tareas están hechas. Lo que quedó construido: schema y migraciones, RLS
sobre las diez tablas, auth con mail y contraseña más Google, reclamo de asiento
por link, y las tres operaciones que mueven una fecha —abrir, cerrar, reabrir—
cada una en una función `security definer` con chequeo de admin propio.

**Lo único que falta es a mano, y necesita a una persona:**

- **Google OAuth no está configurado.** Necesita credenciales reales de Google
  Cloud y un bloque `[auth.external.google]` en `supabase/config.toml`. El plan
  lo dejó como checklist manual a propósito; el botón está en pantalla y el
  callback funciona.
- **El recorrido a mano del criterio de terminado:** registrarse, salir, entrar,
  entrar con Google, reclamar un asiento por el link.

**Tres cosas que aprendimos ejecutándolo y conviene no volver a aprender:**

1. **El plan no corría `npm run build` en ninguna de sus 14 tareas**, sólo
   `typecheck` y `test`. Dos roturas reales de producción pasaron desapercibidas
   con las dos suites en verde: un componente `'use client'` arrastrando
   `next/headers`, y un `useSearchParams()` sin límite de Suspense. Ahora
   `db/client.ts` tiene sólo la mitad del browser y `db/server.ts` la del
   servidor. **Correr `build` en cada tarea de los planes 3 y 4.**
2. **Esta versión del CLI de Supabase no le da DML a los roles de la API.** Las
   diez tablas nacen con ACL `Dxtm` y sin select/insert/update/delete, así que
   `anon`, `authenticated` y `service_role` reciben `42501`. Y una política
   nunca ensancha un privilegio que no existe: sin el `grant` de base, toda la
   RLS es decorativa. Está en `0002_rls.sql`.
3. **Un test de permisos en verde no prueba nada hasta que lo ves fallar.** La
   suite de RLS pasaba sus 13 tests y aun así se podía apagar RLS entera en 7 de
   las 10 tablas sin que nada se pusiera rojo — cubría 3. Dos tests manejados por
   tabla cerraron ~40 de 47 mutaciones. **Para cualquier cosa de permisos:
   rompela a propósito y mirá si la suite se entera.**

**No queda ninguna decisión de modelo abierta.** Las tres que faltaban se
cerraron antes de arrancar:

- **El Masters es una fecha más**, con `matchdays.kind`. Reusa `pairs`,
  `matches` y `match_sets`; no escribe `awards`, porque define al campeón del
  año y no reparte puntos. Al cerrarlo, la temporada pasa a `FINISHED`. El
  flujo lo construye el plan 3, ya sin migración.
- **`pair_locks` reemplaza a `guest_team`.** Una tabla de parejas trabadas antes
  del sorteo cubre las dos cosas con un mecanismo: el equipo invitado que juega
  junto, y el invitado puesto con alguien en concreto — que es la regla del
  spec §2.6 que el modelo anterior dejaba sin implementar. Con un límite: toda
  pareja trabada tiene que incluir a un invitado, o el admin podría saltearse la
  regla de no repetir.
- **Reabrir borra la fecha siguiente si está vacía.** Si ya tiene asistencias,
  invitados o parejas, no la toca y hay que borrarla a mano.

### Plan 3 — pantallas de lectura ✅

Las 11 tareas están hechas. Quedaron construidas las seis pantallas (Tabla con su
sheet de desempate, Fechas, Fecha `[n]` con el acordeón de rondas, Estadísticas,
Reglas y Perfil), más tres funciones puras nuevas en `core/` —racha de títulos,
posición con movimiento, agregados por jugador— y `db/read.ts`, la capa de
lectura, que **no existía**: `db/` sólo tenía escrituras.

**Números:** 248 tests unitarios, 104 contra la base, `npm run build` compila.

### Lo que encontró abrir el navegador, y por qué importa

Con las dos suites en verde, el typecheck limpio y el build compilando, se
recorrieron las pantallas a mano por primera vez. **Aparecieron cinco defectos
reales en veinte minutos.** Ninguno era detectable por lo que había: el Plan 3 no
tenía un solo test de pantalla.

| Qué pasaba | Por qué |
|---|---|
| Entrabas y volvías a la landing, igual que deslogueado | `signIn` redirigía a `/` fijo, y no hay "Mis torneos" |
| La primera pantalla podía tirar 500 | `JWT issued at future`, carrera de sub-segundo |
| La Tabla decía "EN CURSO" con la temporada sin arrancar | `status` colapsaba `SETUP` con `ACTIVE` |
| Fechas salía vacía | Dibujaba filas de la tabla, no de `regularMatchdays` |
| Reglas decía "Marce lo creó" en todos los torneos | Nombre de ejemplo del handoff, hardcodeado |

Los cinco están arreglados. **La lección para el Plan 4: una pantalla que tipa y
compila puede estar mintiendo en cada línea.** Hace falta un smoke test de
navegador que abra cada ruta, asierte 200 y compare lo que dice contra el estado
real de los datos.

**Sobre el arreglo del JWT, para que nadie lo dé por probado:** la carrera **no se
pudo reproducir a pedido**. Diez logins seguidos pasan igual con y sin el
arreglo; la falla apareció con tres agentes cargando la máquina y no vuelve con
la máquina tranquila. Eso respalda el diagnóstico —contención de CPU, no relojes
desfasados— pero es circunstancial. Lo que sí está probado es el helper en
aislamiento (`db/client.unit.test.ts`): reintenta sólo ante `PGRST303`, deja
pasar el `42501` de RLS, y se rinde después de un reintento.

**Dos cosas quedaron decididas y anotadas, no olvidadas:**

- **La página de Reglas quedó detrás del login**, aunque el diseño la pensó como
  el link que se pega en el grupo. El layout del torneo es la guardia de acceso y
  envuelve también a esa pantalla. Hacerla pública necesita que `anon` pueda leer
  las reglas de una temporada: política de RLS nueva o RPC, o sea migración. El
  sanitizado del markdown está hecho y probado igual.
- **La racha se cuenta por jugador, no por pareja.** El spec §2.4 dice que existe
  pero no cómo se cuenta, y no puede ser de la pareja: la regla del tope hace que
  una pareja defienda como máximo una vez. La decisión, con su alternativa, está
  en el plan.

**La lección que dejó, y sirve para el Plan 4:** los tres huecos que aparecieron
son de la misma familia. La capa de lectura se especificó desde el schema y no
desde las pantallas, así que le faltaron justo las cosas que no son tablas sino
preguntas sobre quien mira: "¿estoy anotado?" y "¿cuál asiento soy yo?". Antes de
escribir el Plan 4, **trazar qué dato necesita cada pantalla y recién ahí definir
las funciones de datos.**

### Plan 4 — pantallas de escritura 🚧

**Hecho (Tasks 1 a 6, 8, 9 y 10, rama `plan-4-write-screens`):** toda la capa de
datos que faltaba —tres funciones SQL nuevas, la lectura de asistencias y de ids
de partido, crear temporada, editar el plantel, el Masters de punta a punta—,
"Mis torneos", el wizard de crear torneo, y **el flujo entero de jugar una
fecha**: abrirla, tildar quién viene, el invitado con su compañero, el sorteo de
parejas, confirmar, cargar los resultados en dos toques, cerrar y reabrir.
**273 tests unitarios, 153 contra la base, `build` compilando.**

**Y el recorrido con navegador ya corrió** (`scripts/smoke.mjs`, Task 14): pasa
entero, de crear el torneo a cerrar la fecha con su tabla. Encontró un defecto
real que ningún test podía ver —la pareja campeona mostraba **0 puntos** cuando
jugaba con el invitado, contradiciendo la nota que tiene dos líneas más abajo—,
arreglado y anotado.

**Falta la tanda B:** el toggle "No voy" (Task 7), Ajustes (11), Reglas sin login
(12) y las pantallas del Masters (13). Ninguna bloquea jugar una temporada.

#### Dos cosas rotas que nadie sabía, y ya están arregladas

Las dos aparecieron ejecutando, con las dos suites en verde, y ninguna era
detectable por lo que había:

| Qué estaba roto | Por qué no lo agarró nadie |
|---|---|
| **Crear una temporada desde la app tiraba `42501`** | `is_participant` responde con un SELECT adentro de una función `security definer`, y ese subselect no ve la fila que la propia sentencia está insertando — así que el `returning` se rechaza aunque el `WITH CHECK` pase. Los tests arman temporadas con `service_role`, que saltea RLS, y hasta el Plan 4 no había pantalla que creara un torneo. Arreglado en `0008_seasons_returning.sql` |
| **El Masters no se podía ni abrir ni cerrar** | `openMatchday` corría `assertMatchdaySize` sobre un `present` vacío (el Masters tiene 4 clasificados, no asistencias) y `closeMatchday` mandaba awards que `close_matchday` rebota. Ninguna prueba llegaba nunca al Masters |

**La lección, y es la misma de siempre:** una capa entera puede estar en verde y
tener un camino que nunca corrió nadie. Los dos agujeros estaban exactamente en
el borde entre dos piezas que cada una probaba sola.

**Y una que vale repetir:** en la primera tanda de tests, uno pasaba **por
vacuidad** — `expect(error).not.toBeNull()` se conformaba con "la función no
existe", así que estaba en verde antes de que existiera nada. Es el mismo modo de
falla que este documento ya tenía anotado del Plan 2.

#### El alcance original, para referencia

- Crear torneo (wizard de 5 pasos), abrir fecha, cargar resultados, Ajustes
- **Decidir el tamaño de la fecha desde las asistencias** y agregar el asiento de
  invitado cuando el número da impar
- ~~**Que el admin pueda mover al invitado** en el orden (spec §2.6). `core/` lo
  pone último y respeta el orden que le den; la UI tiene que ofrecer el
  arrastre~~ — **esta línea está mal y el plan 4 la corrige** (decisión
  registrada 2). `orderPool` (`core/pairing.ts:178`) manda a los invitados al
  final del pool *siempre*, y sólo respeta el orden *entre ellos*: con un solo
  invitado —el caso normal— el arrastre no cambia nada. Lo que sí implementa el
  spec §2.6 es elegir con quién juega, o sea `pair_locks`

**Lo que el Plan 3 le dejó, con lo que ya se resolvió:**

- ✅ **"Mis torneos".** Construida (`/torneos`). Después de entrar van todos ahí:
  el caso especial de "una sola temporada, directo a su tabla" se borró, porque
  un camino distinto para el mismo destino es una rama más que puede quedar mal.
- ✅ **La lectura de asistencias** (`attendancesOf`), y el permiso para que un
  jugador escriba la suya (`set_my_attendance`). **Falta el toggle en la Tabla**,
  que es la Task 7 y está en la tanda B.
- ⬜ **El flujo `DRAFT`** y **la carga de resultados**: son las Tasks 9 y 10, lo
  próximo que hay que hacer. Todo lo que necesitan de `db/` ya está.
- ⬜ **Editar las reglas** desde Ajustes: `updateSeasonRules` está hecha y
  probada; falta la pantalla (Task 11, tanda B).
- ⬜ **El flujo del Masters.** La base ya lo puede crear, armar, abrir y cerrar
  —lo prueba `db/masters.db.test.ts` de punta a punta—; falta la pantalla
  (Task 13, tanda B).
- ⬜ **La página de Reglas pública.** `season_public_rules` está hecha y `anon` ya
  la puede llamar; falta aflojar la guardia del layout (Task 12, tanda B).

**Cómo escribirlo, aprendido a los golpes en el Plan 3:**

1. **Trazar qué dato necesita cada pantalla ANTES de definir las funciones de
   datos.** La capa de lectura del Plan 3 se especificó desde el schema, y por eso
   le faltaron justo las preguntas que no son tablas: "¿estoy anotado?" y "¿cuál
   asiento soy yo?". Las dos tuvieron que resolverse a los parches.
2. **Correr `npm run build` en cada tarea.** El Plan 2 no lo corría y se le
   pasaron dos roturas de producción con las dos suites en verde.
3. **Un smoke test de navegador**, aunque sea mínimo. Cinco defectos reales
   salieron en veinte minutos de mirar la app, y cero de ellos era visible desde
   los tests.

### Dos pantallas que cambiaron de layout y todavía nadie miró

Al adaptar el diseño de Stitch al formato de 8 a 12, dos pantallas necesitaron
un layout nuevo, no sólo otro copy. Están marcadas con 🔁 en el handoff:

- ✅ **Wizard paso 4:** los puntos eran 4 columnas. Con 12 jugadores son 6 valores
  y no entran a lo ancho de un teléfono. Pasaron a filas — construido en la Task
  6 del Plan 4, una fila por posición con `−`/`+` de 34px.
- ✅ **Fecha en juego:** eran 3 rondas × 2 partidos fijas. Con 6 parejas son 15
  partidos, así que las rondas pasaron a acordeón, con la ronda en curso abierta
  y las completas colapsadas — construido en la Task 8 del Plan 3
  (`fechas/[n]/rondas.tsx`). **La Task 10 del Plan 4 le enchufa la carga de
  resultados encima, sin rehacer el acordeón.**

Los dos layouts están construidos y ninguno se discutió después de escrito, que
era el riesgo.

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
