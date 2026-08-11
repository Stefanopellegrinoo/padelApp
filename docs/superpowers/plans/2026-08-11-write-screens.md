# Plan 4 — pantallas de escritura

> **Para quien lo ejecute:** una tarea por vez, en orden. Una tarea termina
> cuando sus tests pasan y `npm run build` compila, no cuando la pantalla
> "quedaría más completa si además…".

**Goal:** que un torneo se pueda crear, llenar y jugar entero desde la app: armar
la temporada, abrir una fecha, decir quién viene, generar las parejas, cargar los
resultados, cerrarla, y llegar al Masters.

**Architecture:** las escrituras del campeonato **ya existen** —el Plan 2 las
construyó y las probó contra la base—. Este plan es, en su mayor parte,
pantallas que las llaman. Tres capas, en este orden: primero los tres agujeros de
permisos que la base todavía no tiene (una migración), después lo que le falta a
`db/` para que las pantallas puedan leer y escribir lo que necesitan, y recién
después las pantallas.

**Tech Stack:** Next.js 15 (App Router, Server Components por defecto, Server
Actions para escribir), React 19, Tailwind v4 con los tokens del handoff,
Supabase con RLS ya puesta.

---

## Dónde quedó la ejecución

**Rama:** `plan-4-write-screens`, 14 commits, árbol limpio.
**Números al cortar:** 273 tests unitarios, 153 contra la base, `npm run typecheck`
limpio, `npm run build` compilando.

**Una temporada entera se juega desde el navegador**, de crear el torneo a
coronar al campeón del año — probado de punta a punta, no deducido.

| Task | Qué produce | Estado |
|---|---|---|
| 1 | Migración `0007`: `set_my_attendance` · `create_masters` · `season_public_rules` | ✅ `843ecb0` |
| 2 | `db/read.ts`: los huecos del trazado | ✅ `e78c508` |
| 3 | `db/season.ts` + `db/entries.ts`: crear temporada y editar plantel | ✅ `8119942` |
| 4 | `db/matchday.ts`: asistencia propia, invitado, Masters | ✅ `6086958` |
| 5 | Mis torneos y los cuatro redirects | ✅ `7c8ae8e` |
| 6 | Crear torneo — el wizard de 5 pasos | ✅ `53e7f2c` |
| 8 | Fechas — "Abrir fecha N" | ✅ `03e2e11` |
| 9 | Fecha `DRAFT` — quién viene, el invitado, las parejas | ✅ `1b0fcb6` |
| 10 | Fecha `OPEN` y `CLOSED` — cargar, cerrar, reabrir | ✅ `34073c4` |
| 14 | El recorrido con navegador | ✅ `bac6451` |
| 11 | Ajustes — plantel, formato, reglas | ✅ `205b20f` |
| 13 | El Masters — armarlo, jugarlo, coronar al campeón | ✅ `a06d863` |
| 12 | Reglas, sin login | ✅ `7a3bf24` |
| 7 | Tabla — "No voy" y "Sí voy" | 🚫 **descartada** |

**La Task 7 no se hace.** Decisión del dueño del producto, tomada con la tanda B
a la vista: el jugador no marca su propia asistencia. **El admin marca quién
juega**, que es lo que ya hace el armado de la Task 9, y de ahí sale todo lo
demás. `set_my_attendance` (0007) queda construida y probada, sin pantalla.

**Lo que sí queda pendiente, y es lo próximo:** el **equipo invitado** desde la
pantalla. Ver "El equipo invitado, y por qué la pantalla se queda corta" abajo.

**Lo que la app ya hace:** crear una cuenta, crear un torneo con su plantel y su
formato, compartir el link de invitación, reclamar un asiento, elegir torneo en
Mis torneos, leer las cinco pantallas del Plan 3, y **jugar**: abrir una fecha,
tildar quién viene, sumar el invitado, sortear las parejas, confirmar, cargar
los resultados en dos toques, cerrar la fecha y reabrirla.

**Lo que todavía no hace:** dos cosas, y ninguna bloquea jugar. **El jugador no
tiene ninguna acción de escritura en toda la app** —el toggle "No voy" es la
Task 7—, y **la página de Reglas sigue detrás del login** (Task 12).

**El recorrido con navegador ya corrió** (`scripts/smoke.mjs`, Task 14) y pasa
entero: crear el torneo, abrir la fecha, tildar, el invitado, el sorteo, los seis
resultados, el cierre y la tabla. Encontró un defecto real —la pareja campeona
mostraba 0 puntos— que está arreglado. Los pasos de Ajustes y Reglas sin login
quedaron salteados porque son tanda B.

**Lo primero que conviene hacer al retomar** es leer la sección `Aparecidos` del
final: tiene los tres desvíos del plan que ya ocurrieron y las dos cosas que las
Tasks 8 y 9 heredan.

---

## Este plan es liviano, a propósito

Igual que el Plan 3. Los planes 1 y 2 llevaban la implementación completa de cada
módulo adentro, porque el dominio se estaba inventando y nadie podía improvisar
reglas del campeonato. Acá el dominio está resuelto y probado.

Entonces: **bloques de código completos sólo donde hay lógica nueva** — la
migración de la Task 1, el armado de temporada de la Task 3, y el arreglo del
Masters de la Task 4. Todo lo demás va con archivos, contrato, copys textuales y
"qué NO hace". El JSX y el TSX los escribe quien implementa.

Lo que **no** se aflojó: los copys son contractuales, la verificación incluye
`build`, y "qué NO hace esta tarea" es tan vinculante como el resto.

---

## Cómo se reporta lo que falta

"Qué NO hace esta tarea" corta en las dos direcciones, y la segunda es la que
importa más.

Hacia afuera: **no agregues nada** que la tarea no pida. Ni un botón de más, ni
una validación extra, ni una función "que ya que estaba". Si te parece que falta
algo, no es tuyo arreglarlo acá.

Hacia adentro: **por eso mismo, cuando falte algo de verdad TIENE que salir a la
superficie.** Si una tarea te pide algo imposible, o si para terminarla hace
falta tocar un archivo que no está en su lista, **no improvises: pará, anotalo en
`Aparecidos` y reportalo.** El Plan 3 perdió tiempo justamente donde no se hizo
eso: la Task 9 necesitó una migración fuera de su alcance y la agregó sin
avisar, y el hueco recién apareció al cerrar el plan.

Las decisiones cerradas de los planes 1 a 3 **no se rediscuten**. Si una tarea de
acá parece pedir lo contrario de una de ellas, es esta tarea la que está mal
escrita. Reportalo.

---

## Global Constraints

- **Los copys NO se inventan.** Salen textuales de `docs/padel_design/README.md`.
  Cada tarea lista los suyos. Donde este plan tuvo que decidir un string que el
  handoff no trae, **está marcado con 🆕** en la tabla de copys de esa tarea: son
  pocos, son visibles, y son revisables. Si te falta un string que no está ni en
  el handoff ni marcado con 🆕, es un hueco del plan: reportalo, no lo escribas.
- **Las medidas del handoff son valores exactos, no aproximaciones.** Si dice
  `11.5px/800` va `text-[11.5px] font-extrabold`, no `text-xs font-semibold`.
  Usá valores arbitrarios de Tailwind. Redondear al valor más cercano es el modo
  de falla que una auditoría ya encontró en las pantallas del Plan 2.
- **El kicker es `uppercase` con `letter-spacing: .14em`** (`.13em` para el
  micro-label de 9.5px). Es la convención tipográfica más visible del handoff y
  la más fácil de perder.
- **Sin sombras en toda la UI.** Lo dice el handoff y no tiene excepción.
- **En oscuro `--color-accent` es fondo de bloque, nunca color de texto.** Para
  texto e íconos activos va `--color-accent-link`.
- **Estados deshabilitados: patrón único** — fondo `chip`, texto `muted`, sin
  navegación. Vale para el submit del wizard, "Generar parejas", "Confirmar
  fecha", "Cerrar fecha" y "Entrar como…".
- **Errores: siempre en línea, junto al campo.** Fondo `live-bg`, texto `live`, y
  el campo culpable con borde `live`. **Nunca alerts, nunca toasts, nunca
  `window.confirm`.**
- **Server Components por defecto.** `'use client'` sólo donde hay interacción
  real. El patrón de este repo es: la `page.tsx` lee y compone, y le pasa datos
  planos a un componente cliente que maneja la interacción.
- **Un componente `'use client'` NUNCA importa de `db/server.ts`.** Arrastra
  `next/headers` y rompe el build sin que `tsc` ni los tests se enteren. Es
  exactamente la rotura que costó el commit `8c6ffd6` del Plan 2.
- **Toda escritura pasa por una función de `db/`, llamada desde una Server
  Action.** Ninguna pantalla llama a `supabase.from(...).insert/update/delete`
  por su cuenta, y ningún componente cliente escribe. El patrón está en
  `app/auth/actions.ts` y `app/unirse/[token]/actions.ts`.
- **Después de escribir, `revalidatePath`.** Sin eso la pantalla se queda con la
  versión cacheada y parece que la escritura no hizo nada.
- **Los errores de escritura llegan como `EdgeError` con mensaje en español.** Se
  muestran, no se tragan. `db/errors.ts` ya los define.
- **`npm run build` en cada tarea.** El Plan 2 no lo corría en ninguna de sus 14
  verificaciones y se le pasaron dos roturas de producción con todo en verde.
- **Nombres de tests en inglés.** Copy de UI, mensajes de error y comentarios SQL
  en español.
- **`adminClient()` saltea RLS: arma la escena, nunca asierta.**
- **Nada de librerías nuevas** de componentes, formularios, estado, drag & drop,
  markdown o gráficos. `<input type="date">` y `<select>` nativos alcanzan.
- **Esto es un MVP para un grupo de amigos.** Ante la duda entre lo robusto y lo
  que anda, va lo que anda, con un comentario `ponytail:` diciendo dónde está el
  techo.

---

## Lo que YA existe y no se reescribe

Esta es la lista más importante del plan. **Todas estas funciones ya están
implementadas y probadas contra la base local.** Si escribís una segunda versión
de cualquiera de ellas, el bug que introduzcas no lo va a agarrar ningún test:
las dos van a estar de acuerdo entre sí y en desacuerdo con la realidad.

En `db/matchday.ts`:

| Función | Qué hace |
|---|---|
| `createMatchday(supabase, seasonId, playedOn)` | Crea la siguiente fecha por número. Rebota si ya hay una sin cerrar |
| `setAttendance(supabase, matchdayId, entryId, status)` | Tilda viene / no viene. **Es la del admin**: RLS pide `is_season_admin` |
| `addGuest(supabase, matchdayId, { displayName })` | Agrega un asiento `GUEST`, con `seed_position` correlativo |
| `lockPair(supabase, matchdayId, entryA, entryB)` | Traba una pareja antes del sorteo. Valida que incluya un invitado |
| `unlockPair(supabase, lockId)` | La destraba |
| `generatePairs(supabase, matchdayId)` | Sortea las parejas y escribe el fixture. **Re-ejecutable**: el botón "Regenerar" es esto |
| `openMatchday(supabase, matchdayId)` | `DRAFT → OPEN`. Exige invitados con nombre y que las parejas coincidan con quién viene |
| `closeMatchday(supabase, matchdayId)` | `OPEN → CLOSED` con los awards congelados, en una transacción |
| `reopenMatchday(supabase, matchdayId)` | `CLOSED → OPEN` de la última cerrada, borrando sus awards |
| `saveResult(supabase, matchId, sets)` | Guarda el resultado de un partido. **Reemplaza**, no acumula |
| `pairingContextFor` / `matchdayContextFor` | El contexto que compone `core/` con la base |

En `db/season.ts`: `seasonConfig`, `squadSeedOrder`, `awardsBefore`,
`closedHistory`, `updateSeasonConfig`.

En `db/validate.ts`: `assertValidConfig`, `setError`, `matchError`,
`assertMatchdaySize`, `assertLocksAndGuests`, `assertPointsCoverMatchday`,
`assertGuestsNamed`. **Los mensajes de error ya están en español y ya tienen
tests.** No los reescribas en la pantalla.

En `core/`: todo. La superficie pública es `core/index.ts`.

En SQL: `open_matchday`, `close_matchday`, `reopen_matchday`, `claim_seat`,
`season_invite`, `my_player_id`, y los helpers `is_participant`,
`is_season_admin`, `matchday_season`, `match_season`, `match_is_open`.

---

## El trazado: qué dato necesita cada pantalla

El Plan 3 dejó una lección cara: **la capa de lectura se especificó desde el
schema y no desde las pantallas**, así que le faltaron justo las cosas que no
son tablas sino preguntas sobre quien mira. Las dos que faltaron —"¿estoy
anotado?" y "¿cuál asiento soy yo?"— se tuvieron que resolver a los parches, y
una de ellas metió una migración fuera de alcance.

Así que primero el trazado, y después las funciones. Esta tabla es lo que define
las Tasks 1 a 4.

| Pantalla | Dato que necesita | ¿Existe hoy? |
|---|---|---|
| Mis torneos | Mis temporadas, con nombre y estado | ✅ `mySeasons` |
| Mis torneos | Mi posición en cada una | ✅ derivable: `awardsOf` + `entriesOf` + `rankingWithMovement` |
| Mis torneos | La próxima fecha de cada una | ✅ `matchdaysOf` |
| Crear torneo | Nada de la base hasta el submit | — |
| Crear torneo | El link de invitación al terminar | ❌ **`seasonHeader` no trae `invite_token`** |
| Crear torneo | La escritura: temporada + plantel | ❌ **no hay función que cree una temporada** |
| Tabla · próxima fecha | ¿Estoy anotado en la próxima fecha? | ❌ **no hay lectura de asistencias** |
| Tabla · próxima fecha | ¿Cuál asiento soy yo? | ⚠️ resuelto **inline** en `stats/page.tsx`, no reusable |
| Tabla · próxima fecha | La escritura "no voy" | ❌ **`attendances_write` es sólo del admin** |
| Tabla · próxima fecha | "Te reemplaza {X} (invitado)" | ❌ el invitado sale de `entriesOf`, pero **`EntryRow` no expone `matchdayId`**, así que no se sabe de qué fecha es |
| Fechas · abrir fecha | ¿Hay alguna fecha sin cerrar? | ✅ `matchdaysOf` |
| Fecha `DRAFT` | El plantel con su tilde de asistencia | ❌ mismo hueco de asistencias |
| Fecha `DRAFT` | Los invitados de **esta** fecha, con su nombre | ❌ mismo hueco de `matchdayId` |
| Fecha `DRAFT` | Las parejas generadas y la defensora | ✅ `matchdayDetail` + `previousContext` |
| Fecha `OPEN` | **El `id` de cada partido, para cargarlo** | ❌ **`MatchResult` de `core/` no tiene `id`, y `matchdayDetail` devuelve `MatchResult[]`** |
| Fecha `OPEN` | Cuántos partidos faltan | ✅ derivable de `sets.length === 0` |
| Fecha `CLOSED` | ¿Es la última cerrada? | ✅ `matchdaysOf` |
| Ajustes | El plantel y quién reclamó cada asiento | ⚠️ `entriesOf` trae `playerId`, **falta el nombre del jugador** |
| Ajustes | El link de invitación | ❌ mismo hueco de `invite_token` |
| Ajustes | Config y texto de reglas | ✅ `seasonHeader.config`, `seasonRules` |
| Ajustes | Editar plantel, nombre y reglas | ❌ **no hay funciones de escritura** |
| Reglas sin login | Todo, sin sesión | ❌ **`anon` no tiene SELECT en ninguna tabla, a propósito** |
| Masters | Los 4 clasificados | ✅ `mastersQualifiers` sobre el ranking |
| Masters | Crear la fecha con `kind = 'MASTERS'` | ❌ **el grant de columnas de `matchdays` no incluye `kind`** |
| Masters | Abrirla y cerrarla | ⚠️ **`openMatchday` y `closeMatchday` no la contemplan** — ver Task 4 |

**Los cuatro bloqueantes duros** —los que hacen que una pantalla directamente no
se pueda construir, no que quede fea— son: el `id` de los partidos, `kind` fuera
del grant, `attendances_write` sólo para el admin, y `anon` sin lectura. Los
cuatro se resuelven en las Tasks 1 y 2, antes de tocar una pantalla.

---

## Decisiones registradas

Siete cosas que este plan tuvo que decidir. Cada una con lo que la sostiene y con
la alternativa que se descartó, para que sea una decisión y no un olvido.

### 1. Los defaults del wizard salen de `defaultConfig`, no del handoff

Los dos documentos no coinciden. El handoff (§6 paso 4) dice "Defaults 10 · 7 ·
5 · 3 · 2 · 1, recortados a las primeras N" y `1/4/12/9/3`. `core/config.ts`
tiene una lista distinta por tamaño de plantel —`[10,6,3,1]` para 8, `[10,7,5,3,1]`
para 10, `[10,7,5,3,2,1]` para 12— y `10/8` de fechas.

**Manda `defaultConfig(squadSize)`.** Está implementado, tiene tests, lo valida
`validateConfig`, y es el que usan el seed y todos los tests contra la base. Un
wizard que produjera otros defaults haría que cada captura de pantalla no
coincida con ningún fixture. El spec (§2.1, §3.4) dice 10 fechas y 8 mejores, o
sea que `defaultConfig` es el que sigue al spec.

**Lo que sí queda del handoff son los rangos de los steppers**, que son medidas:
sets 1–3, games 3–9, fechas 4–24, cuentan 1–24, refresco 1–6.

### 2. El invitado no se arrastra: se elige con quién juega

El handoff (§9a paso 2) dibuja `⠿` y flechas `↑↓` para mover al invitado en el
orden. **Con un solo invitado eso no hace nada**, y con este formato casi siempre
hay uno solo: `orderPool` (`core/pairing.ts:178`) manda a los invitados al final
del pool **siempre**, sin excepción, y sólo respeta el orden *entre ellos*. Un
control que no cambia el resultado es peor que no tenerlo: miente.

**Decisión: el control es "con quién juega", y se implementa con `lockPair`.** Es
exactamente el mecanismo que el Plan 2 construyó para el spec §2.6 ("el admin lo
puede mover si conoce al tipo"), y `assertLocksAndGuests` ya lo valida. Por
defecto no hay lock y el invitado cae último, que es lo que el spec pide.

Esto **corrige** la línea del alcance de `docs/estado.md` que dice "la UI tiene
que ofrecer el arrastre". El arrastre no es implementable sobre el `core/` que
existe, y `core/` no se toca en este plan.

### 3. El plantel y el `squadSize` se editan por separado

En Ajustes se pueden agregar y sacar asientos. `config.squadSize` y
`config.points` **no se tocan solos** al hacerlo: se editan en la sección
Formato, que es donde viven.

Mientras no coincidan, la pantalla lo dice llamando a
`validateConfig({ ...config, squadSize: cantidadDeAsientos })` y mostrando lo que
devuelve. **Cero copy inventado**: esa función ya produce la frase exacta ("Con
un plantel de 10 hacen falta 5 valores de puntos, no 4."), en español y con
tests encima.

Que queden desalineados un rato no rompe nada: el riesgo real —una fecha con más
parejas que valores de puntos— lo ataja `assertPointsCoverMatchday` al abrir la
fecha.

### 4. Reglas sin login: se afloja el layout, no se duplica la pantalla

El Plan 3 dejó la pantalla de Reglas construida y correcta, con su rama "sin
sesión" **inalcanzable**: `app/torneo/[id]/layout.tsx` llama a `seasonHeader()`
sin condición y tira antes de que la página se monte.

Se evaluó una ruta pública nueva (`/reglas/[id]`) y se descartó: duplica la
pantalla, y el link que la gente ya tiene apunta a `/torneo/{id}/reglas`.

**Decisión: el layout no llama a `seasonHeader` cuando no hay sesión, y no dibuja
la nav.** Cada página decide qué hacer sin sesión; hoy sólo Reglas sabe, y las
demás siguen tirando por RLS, que es lo correcto. Los datos sin sesión salen de
una función `security definer` con `grant` a `anon` que devuelve **cinco campos y
nada más** (Task 1).

### 5. El Masters es una fecha más, y por lo tanto no tiene ruta propia

Se juega en `/torneo/{id}/fechas/{n}`, la misma pantalla, con `kind = 'MASTERS'`.
Es la decisión que el Plan 2 ya registró y que el schema implementa
(`0001_schema.sql:32-38`). Lo que cambia por dentro: en vez de asistencias hay 4
clasificados, en vez de `buildPairs` va `mastersFixture`, y al cerrar no se
reparten puntos — se define al campeón del año.

### 6. Ajustes es sólo la parte del torneo

El handoff (§13) dibuja cuatro secciones: Torneo, Notificaciones, Apariencia y
Cuenta. **Se construyen Torneo y una línea de Cuenta.**

- **Notificaciones**: el spec las excluye del MVP por escrito ("No entra:
  reserva de canchas, pagos, chat, notificaciones push"). Tres toggles que no
  notifican nada son una mentira con switch.
- **Apariencia**: la app ya sigue `prefers-color-scheme` y funciona en claro y en
  oscuro. Un selector necesita persistencia por usuario, que no existe.
- **Cuenta**: queda "Cerrar sesión", que ya está implementado (`signOut`).
  "Cambiar contraseña" y "Salir del torneo" no tienen backend.

### 7. Una fecha se abre con una fecha de calendario

`createMatchday` pide `playedOn` y todas las pantallas muestran ese dato ("jue 27
ago"). El handoff dibuja el CTA "Abrir fecha 7" sin ningún campo al lado.

**Decisión: un `<input type="date">` nativo junto al botón, con hoy por
defecto.** Es la opción más barata que no obliga a inventar una fecha, y no
necesita librería. El campo no lleva label: el control nativo ya se explica.

---

## Estructura de archivos

```
supabase/migrations/
  0007_write_screens.sql        Task 1   set_my_attendance · create_masters · season_public_rules
db/
  read.ts             Task 2    (modificar) los huecos del trazado
  season.ts           Task 3    (modificar) createSeason · updateSeasonRules · renameSeason
  entries.ts          Task 3    (crear)     editar el plantel
  matchday.ts         Task 4    (modificar) setMyAttendance · seedAttendances
                                            nameGuest · removeGuest · syncGuestSeat
                                            createMasters · generateMastersPairs
                                            + los dos arreglos de open/close para el Masters
app/
  torneos/
    page.tsx          Task 5    Mis torneos
    nuevo/
      page.tsx        Task 6    Crear torneo (shell)
      wizard.tsx      Task 6    los 5 pasos ('use client')
      actions.ts      Task 6    el submit
  auth/actions.ts     Task 5    (modificar) a dónde va cada quien
  page.tsx            Task 5    (modificar) landing logueada
  unirse/[token]/actions.ts     Task 5  (modificar) al torneo, no a la landing
  torneo/[id]/
    layout.tsx        Task 12   (modificar) guarda condicional, nav sólo con sesión
    actions.ts        Tasks 7-8 acciones del torneo
    page.tsx          Task 7    (modificar) tarjeta de próxima fecha
    asistencia.tsx    Task 7    "No voy" / "Sí voy" ('use client')
    fechas/
      page.tsx        Tasks 8,13 (modificar) CTA de abrir · CTA del Masters
      abrir.tsx       Task 8    fecha + botón ('use client')
      [n]/
        page.tsx      Tasks 9,10,13 (modificar) los tres estados
        actions.ts    Tasks 9,10,13 acciones de la fecha
        armado.tsx    Task 9    el flujo DRAFT ('use client')
        carga.tsx     Task 10   la carga en dos toques ('use client')
        rondas.tsx    Task 10   (modificar) enchufar la carga
        masters.tsx   Task 13   el bloque del Masters ('use client')
    ajustes/
      page.tsx        Task 11   Ajustes
      actions.ts      Task 11
      formato.tsx     Task 11   los steppers ('use client')
      plantel.tsx     Task 11   los asientos ('use client')
      reglas.tsx      Task 11   el editor de markdown ('use client')
    reglas/
      page.tsx        Task 12   (modificar) rama sin sesión
      rules-body.tsx  Task 12   (extraer) el cuerpo, compartido
scripts/
  smoke.mjs           Task 14   el recorrido con navegador
```

---

## Cómo se revisa este plan

**No hay revisor separado por tarea.** Quien implementa verifica su propia tarea
con los comandos que la tarea lista, y sigue.

**Revisión adversarial sólo en cuatro tareas**: las que escriben historia, borran
datos o ponen una guardia de permisos. Son las Tasks **1**, **3**, **4** y **10**,
y cada una dice al pie qué se le pide al revisor.

Dos reglas para esas cuatro:

1. **Pedile que CALCULE, no que lea.** Un test y un código pueden estar
   equivocados de acuerdo, y eso ninguna suite lo detecta. Los revisores del Plan
   1 rindieron cuando se les pidió enumerar los ocho resultados del Masters y
   computar `floor((f-1)/k)` en los bordes, no cuando se les pidió "revisá esto".
2. **Para permisos y guardias: que rompa la protección a propósito y confirme que
   la suite se pone roja.** Un test de permisos en verde no prueba nada hasta que
   lo ves fallar. La suite de RLS del Plan 2 pasaba sus 13 tests y aun así se
   podía apagar RLS entera en 7 de las 10 tablas sin que nada se rompiera.

---

## Orden de ejecución: primero que se pueda jugar

Las 14 tareas no valen lo mismo. Diez de ellas son el camino para que un grupo
juegue una temporada entera; las otras cuatro son cosas que se pueden hacer
después sin bloquear a nadie. **Se ejecutan en dos tandas, y la tanda A se
mergea antes de arrancar la B.**

**Tanda A — jugar una temporada** (en este orden): **1 · 2 · 3 · 4 · 5 · 6 · 8 ·
9 · 10 · 14**. Al terminarla, un admin puede crear el torneo, compartir el link,
abrir una fecha, tildar quién viene, generar las parejas, cargar los resultados y
cerrarla. Eso es la app.

**Tanda B — lo que puede esperar**: **7 · 11 · 12 · 13**.

Por qué cada una espera:

- **Task 7 (el toggle "No voy")**: el admin ya tilda a los ausentes en el armado
  (Task 9). Es comodidad para el jugador, no un camino bloqueado.
- **Task 11 (Ajustes)**: nada de lo que edita hace falta para jugar. El plantel y
  el formato se cargan bien en el wizard.
- **Task 12 (Reglas sin login)**: la pantalla existe y se ve logueado. Lo que
  falta es que la vea alguien sin cuenta.
- **Task 13 (el Masters)**: se juega **una vez al año, al final**. Faltan doce
  fechas para que haga falta.

**Lo que NO se recorta:** la migración de la Task 1 va entera, con las tres
funciones. Es un archivo, se escribe una vez, y partirla en dos migraciones
cuesta más de lo que ahorra. Los arreglos del Masters en `openMatchday` y
`closeMatchday` (Task 4) también van: son cuatro líneas y hoy dejan el Masters
imposible de abrir y de cerrar. Lo que espera es la **pantalla**, no la base.

**Dos ajustes que hace la tanda A por saltearse la Task 7:**

- `app/torneo/[id]/actions.ts` lo **crea** la Task 8, no la 7. Cuando llegue la
  Task 7, lo modifica.
- El recorrido de la Task 14 saltea sus pasos 10 y 11 (Ajustes y Reglas sin
  sesión) en la tanda A, y los suma cuando se ejecute la B.

---

### Task 1: La migración — los tres permisos que faltan

**Files:**
- Create: `supabase/migrations/0007_write_screens.sql`
- Test: `db/write-screens.db.test.ts`

**Interfaces:**
- Consumes: los helpers de `0002_rls.sql` (`is_season_admin`, `matchday_season`)
- Produces (SQL, para las Tasks 4, 12 y 13):
  ```
  set_my_attendance(p_matchday uuid, p_status text) returns void
  create_masters(p_season uuid, p_played_on date) returns uuid
  season_public_rules(p_season uuid)
    returns table (name text, config jsonb, rules_text text,
                   rules_updated_at timestamptz, admin_name text)
  ```

**Qué NO hace esta tarea:** no toca ninguna política de RLS existente, no toca
ningún `grant` de tabla, no escribe una sola línea de TypeScript (los wrappers
son de la Task 4), no crea pantallas.

**Por qué las tres son necesarias, y no una comodidad:**

1. **`attendances_write` es sólo del admin** (`0002_rls.sql:181-184`). El toggle
   "No voy" de la Tabla es una acción del jugador sobre su propia fila, y hoy
   no hay ninguna forma de que la escriba.
2. **`kind` no está en el grant de columnas de `matchdays`.** `0002_rls.sql:237`
   otorga `insert (season_id, number, played_on)` y nada más, así que ningún
   insert desde el cliente puede nacer `MASTERS`.
3. **`anon` no tiene SELECT en ninguna tabla**, a propósito (`0002_rls.sql:117`
   lo deja explícitamente afuera). La página de reglas se comparte sin cuenta
   (spec §2.8), así que necesita una superficie pública, y tiene que ser mínima.

**Se eligió función y no política de RLS** para las tres. Una política que
permitiera al jugador escribir su asistencia necesitaría dos helpers nuevos
—`players.user_id` no es legible— y dejaría dos caminos de escritura sobre
`attendances`. Una función es un solo lugar donde mirar quién puede qué.

- [ ] **Step 1: Escribir los tests que fallan**

Create `db/write-screens.db.test.ts`, con los andamios de `db/test/`. Cubrir:

- un jugador del plantel marca `ABSENT` en su fecha `DRAFT` → queda la fila, con
  **su** `entry_id`
- el mismo jugador vuelve a `PLAYING` → **se actualiza**, no se duplica (el
  `unique (matchday_id, entry_id)` lo rebotaría)
- un jugador de **otra** temporada llama a `set_my_attendance` sobre esta fecha →
  error `'No tenés lugar en esta temporada.'`
- la fecha está `OPEN` → error, no se toca nada. **Es el test que importa**: sin
  esto se puede desanotar alguien cuando las parejas ya están armadas
- `create_masters` la llama un jugador que no es admin → error
- `create_masters` con fechas regulares sin cerrar → error que nombra cuántas
  faltan
- `create_masters` dos veces → la segunda rebota (`matchdays_one_masters`)
- `create_masters` con una fecha regular abierta → rebota (`matchdays_one_live`)
- `season_public_rules` **con el cliente anónimo** devuelve nombre, config, texto
  y quién organiza
- `season_public_rules` con el cliente anónimo sobre un id que no existe →
  cero filas, sin error
- **el anónimo sigue sin leer nada más**: `entries`, `matchdays` y `awards` de
  esa misma temporada le devuelven vacío o `42501`

**Expected: FAIL** — las funciones no existen.

- [ ] **Step 2: `supabase/migrations/0007_write_screens.sql`**

```sql
-- ── el jugador marca su propia asistencia ────────────────────────────────────
-- `attendances_write` (0002_rls.sql) es sólo del admin, así que sin esta función
-- un jugador no puede tocar ni su propia fila. El chequeo de "la fila es la
-- tuya" vive ACÁ adentro y no en la pantalla: si viviera en la pantalla,
-- cualquiera con la consola abierta marca ausente a otro.
create or replace function public.set_my_attendance(p_matchday uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid;
  v_entry  uuid;
begin
  if p_status not in ('PLAYING', 'ABSENT') then
    raise exception 'El presentismo sólo puede ser PLAYING o ABSENT.';
  end if;

  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;

  -- Mismo criterio que setAttendance en db/matchday.ts: una vez armadas las
  -- parejas, desanotarse deja la fecha con más parejas que jugadores.
  if not exists (
    select 1 from public.matchdays where id = p_matchday and status = 'DRAFT'
  ) then
    raise exception 'La fecha ya está armada: hablá con quien organiza.';
  end if;

  -- `entries_one_seat` garantiza a lo sumo un asiento por (temporada, player),
  -- así que este select nunca devuelve dos filas.
  select e.id into v_entry
    from public.entries e
    join public.players p on p.id = e.player_id
   where e.season_id = v_season
     and e.kind = 'SQUAD'
     and p.user_id = (select auth.uid());

  if v_entry is null then
    raise exception 'No tenés lugar en esta temporada.';
  end if;

  insert into public.attendances (matchday_id, entry_id, season_id, status)
  values (p_matchday, v_entry, v_season, p_status)
  on conflict (matchday_id, entry_id) do update set status = excluded.status;
end;
$$;

revoke execute on function public.set_my_attendance(uuid, text) from public, anon;
grant  execute on function public.set_my_attendance(uuid, text) to authenticated;

-- ── crear el Masters ─────────────────────────────────────────────────────────
-- `kind` NO está en el grant de columnas de matchdays (0002_rls.sql: sólo
-- season_id, number y played_on), así que ningún insert desde el cliente puede
-- crear una fecha MASTERS. Hace falta esta función, y de paso es el lugar donde
-- viven las condiciones para que el Masters exista.
create or replace function public.create_masters(p_season uuid, p_played_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_regular int;
  v_closed  int;
  v_number  int;
  v_new     uuid;
begin
  if not public.is_season_admin(p_season) then
    raise exception 'Sólo quien organiza la temporada puede armar el Masters.';
  end if;

  select (config ->> 'regularMatchdays')::int into v_regular
    from public.seasons where id = p_season;
  if v_regular is null then
    raise exception 'La temporada no existe.';
  end if;

  select count(*) into v_closed
    from public.matchdays
   where season_id = p_season and kind = 'REGULAR' and status = 'CLOSED';

  if v_closed < v_regular then
    raise exception 'El Masters se juega al terminar las % fechas: faltan %.',
      v_regular, v_regular - v_closed;
  end if;

  select coalesce(max(number), 0) + 1 into v_number
    from public.matchdays where season_id = p_season;

  -- `matchdays_one_masters` frena el segundo Masters y `matchdays_one_live`
  -- frena crearlo con otra fecha sin cerrar. Los dos levantan 23505; el borde
  -- de TypeScript traduce ese código a un mensaje que se pueda leer.
  insert into public.matchdays (season_id, number, kind, played_on)
  values (p_season, v_number, 'MASTERS', p_played_on)
  returning id into v_new;

  return v_new;
end;
$$;

revoke execute on function public.create_masters(uuid, date) from public, anon;
grant  execute on function public.create_masters(uuid, date) to authenticated;

-- ── las reglas, sin cuenta ───────────────────────────────────────────────────
-- La página de reglas es el link que se pega en el grupo y se ve SIN cuenta
-- (spec 2.8). `anon` no tiene select en ninguna tabla, a propósito, así que
-- ésta es la ÚNICA superficie pública de toda la app.
--
-- Devuelve exactamente cinco campos y ninguno dice quién juega: nada de plantel,
-- nada de asistencias, nada de resultados, nada de puntos. Agregar una columna
-- acá es agrandar la superficie pública de la app entera.
create or replace function public.season_public_rules(p_season uuid)
returns table (
  name             text,
  config           jsonb,
  rules_text       text,
  rules_updated_at timestamptz,
  admin_name       text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name,
         s.config,
         s.rules_text,
         s.rules_updated_at,
         coalesce(p.display_name, '')
    from public.seasons s
    left join public.players p on p.user_id = s.created_by
   where s.id = p_season
$$;

revoke execute on function public.season_public_rules(uuid) from public;
grant  execute on function public.season_public_rules(uuid) to anon, authenticated;
```

- [ ] **Step 3: Regenerar los tipos, verificar y commitear**

```bash
npm run db:reset && npm run db:types
npm run typecheck && npm test && npm run test:db && npm run build
git add supabase/migrations/0007_write_screens.sql db/write-screens.db.test.ts db/database.types.ts
git commit -m "feat: let a player mark their own attendance, an admin build the masters and anyone read the rules"
```

> **🔎 Revisión adversarial — permisos.** Pedile al revisor que **rompa las tres
> protecciones a propósito**, una por vez, y confirme que la suite se pone roja
> en cada caso:
> 1. Sacar el bloque `if not exists (... status = 'DRAFT')` de
>    `set_my_attendance`.
> 2. Cambiar `p.user_id = (select auth.uid())` por `true` en el mismo select.
> 3. Sacar el `if not public.is_season_admin(p_season)` de `create_masters`.
>
> Si alguna mutación **no** pone ningún test en rojo, falta un test — el arreglo
> es escribirlo, no razonar por qué igual está bien.
>
> Y una cuenta que ningún test hace: **enumerar las cinco columnas de
> `season_public_rules` y decir, una por una, qué le revela a un desconocido con
> el id de la temporada.** Si alguna revela quién juega, quién ganó o quién
> organiza más allá de un nombre de pila, sobra.

---

### Task 2: `db/read.ts` — los huecos del trazado

**Files:**
- Modify: `db/read.ts`
- Modify: `db/read.db.test.ts`
- Modify: `app/torneo/[id]/stats/page.tsx` (usar `myEntryId` en vez de resolverlo inline)

**Interfaces:**
- Consumes: `Client` de `db/client.ts`; `season_public_rules` (Task 1)
- Produces:
  ```typescript
  // Tipos que CAMBIAN — los tres son campos agregados, ningún consumidor se rompe
  interface SeasonHeader { /* …lo de hoy… */; inviteToken: string }
  interface EntryRow     { /* …lo de hoy… */; matchdayId: string | null }

  /** Un partido como lo necesita una pantalla que escribe: `MatchResult` más el id que pide `saveResult`. */
  interface MatchWithId extends MatchResult { id: string }
  interface MatchdayDetail { matchday: MatchdaySummary; pairs: Pair[]; matches: MatchWithId[]; guestIds: EntryId[] }

  interface PublicRules {
    name: string
    config: SeasonConfig
    text: string
    updatedAt: string | null
    adminName: string
  }

  function attendancesOf(supabase, matchdayId): Promise<Map<EntryId, 'PLAYING' | 'ABSENT'>>
  function myEntryId(supabase, seasonId): Promise<EntryId | null>
  function playerNames(supabase, playerIds: readonly string[]): Promise<Map<string, string>>
  function publicRules(supabase, seasonId): Promise<PublicRules | null>
  ```

**Qué NO hace esta tarea:** no escribe nada, no calcula nada del campeonato, no
arma componentes, no agrega políticas de RLS, no crea migraciones, **no cambia
ninguna firma existente** — sólo agrega campos y funciones.

**`MatchWithId extends MatchResult` es la pieza que desbloquea la Task 10.** Sin
el `id`, la pantalla de carga no tiene a qué partido llamarle `saveResult`. Como
es un supertipo estructural, todo lo que hoy consume `matchdayDetail().matches`
como `MatchResult[]` —`computeStandings`, `mastersChampion`, la pantalla de
lectura— sigue compilando sin tocarse.

**`myEntryId` no es nuevo: es un `extract`.** `stats/page.tsx:207-224` ya hace
exactamente esto —`rpc('my_player_id')` y después buscar el entry— inline. Mové
esa lógica acá y que la pantalla la llame. Es la única duplicación que esta tarea
tiene permitido tocar.

**`publicRules` es la única lectura de `db/` que funciona sin sesión.** Devuelve
`null` cuando la temporada no existe, en vez de tirar: quien abre un link roto no
necesita un stack trace.

- [ ] **Step 1: Escribir los tests que fallan**

En `db/read.db.test.ts`, agregar:

- `attendancesOf` devuelve sólo las filas de **esa** fecha, con su estado
- `attendancesOf` de una fecha sin asistencias devuelve un mapa vacío, no tira
- `entriesOf` devuelve `matchdayId` en `null` para el plantel y **con el id de su
  fecha** para un invitado. Con invitados de **dos fechas distintas**, cada uno
  trae la suya — es el error de lado que pasa desapercibido con una sola
- `matchdayDetail` devuelve el `id` de cada partido, y ese id sirve para
  `saveResult` (guardá un resultado con él y leelo de vuelta)
- `seasonHeader` devuelve `inviteToken`, y es el mismo con el que `season_invite`
  resuelve la invitación
- `myEntryId` devuelve el asiento del caller, y `null` para alguien que no tiene
  lugar en esa temporada
- `playerNames` de una lista vacía devuelve un mapa vacío **sin ir a la base**
- `publicRules` **con el cliente anónimo** trae los cinco campos
- `publicRules` de un id inexistente devuelve `null`

**Expected: FAIL**

- [ ] **Steps 2-3: implementar, mover el inline de stats, verificar y commitear**

```bash
npm run typecheck && npm test && npm run db:reset && npm run test:db && npm run build
git add db/read.ts db/read.db.test.ts "app/torneo/[id]/stats/page.tsx"
git commit -m "feat: read the attendances, the match ids and the invite the write screens need"
```

---

### Task 3: `db/season.ts` y `db/entries.ts` — crear un torneo y editar su plantel

**Files:**
- Modify: `db/season.ts`
- Create: `db/entries.ts`
- Create: `db/entries.db.test.ts`

**Interfaces:**
- Consumes: `Client`, `EdgeError`, `assertValidConfig` de `db/validate.ts`
- Produces:
  ```typescript
  // db/season.ts
  interface NewSeason { name: string; squadNames: string[]; config: SeasonConfig }
  function createSeason(supabase, season: NewSeason): Promise<{ seasonId: string; inviteToken: string }>
  function renameSeason(supabase, seasonId, name: string): Promise<void>
  function updateSeasonRules(supabase, seasonId, text: string): Promise<void>

  // db/entries.ts
  function addSquadSeat(supabase, seasonId, displayName: string): Promise<string>
  function renameSeat(supabase, entryId, displayName: string): Promise<void>
  function removeSeat(supabase, entryId): Promise<void>
  function unlinkSeat(supabase, entryId): Promise<void>
  ```

**Qué NO hace esta tarea:** no toca `config.squadSize` ni `config.points` al
agregar o sacar un asiento (decisión registrada 3), no reordena `seed_position`
—el orden inicial se escribe una sola vez, en el wizard—, no borra temporadas, no
arma pantallas, no crea invitados (eso es de la fecha, Task 4).

**`createSeason` son dos escrituras y no una transacción.** La base no expone una
función para esto y no vale la pena una migración: si el insert del plantel
falla, se borra la temporada recién creada y se tira el error original. Una
temporada sin asientos es basura que el usuario ve en Mis torneos y no puede
arreglar.

```typescript
/**
 * La temporada y su plantel. Dos escrituras, no una transacción: PostgREST no
 * las tiene, y una función SQL sólo para esto sería una migración para el
 * camino feliz de una pantalla que se usa una vez por año.
 *
 * Si la segunda falla, se deshace la primera. Una temporada sin asientos no se
 * puede arreglar desde ninguna pantalla —Ajustes necesita al menos el plantel
 * para dibujarse— y queda para siempre en la lista de Mis torneos.
 *
 * ponytail: el rollback es best-effort. Si el delete también falla, gana el
 * error del insert, que es el que explica qué pasó.
 */
export async function createSeason(
  supabase: Client,
  { name, squadNames, config }: NewSeason,
): Promise<{ seasonId: string; inviteToken: string }> {
  assertValidConfig(config)

  const trimmed = name.trim()
  if (trimmed.length === 0) throw new EdgeError('El torneo necesita un nombre.')
  if (squadNames.length !== config.squadSize) {
    throw new EdgeError(
      `El plantel tiene ${squadNames.length} nombres y la configuración dice ${config.squadSize}.`,
    )
  }
  if (squadNames.some((seat) => seat.trim().length === 0)) {
    throw new EdgeError('Falta un nombre del plantel.')
  }

  const { data: auth } = await supabase.auth.getUser()
  const userId = auth.user?.id
  if (userId === undefined) throw new EdgeError('Hay que entrar antes de crear un torneo.')

  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .insert({ name: trimmed, config: config as unknown as Json, created_by: userId })
    .select('id, invite_token')
    .single()
  if (seasonError !== null || season === null) {
    throw new EdgeError(`No se pudo crear el torneo: ${seasonError?.message}`)
  }

  const { error: entriesError } = await supabase.from('entries').insert(
    squadNames.map((seat, index) => ({
      season_id: season.id,
      display_name: seat.trim(),
      kind: 'SQUAD' as const,
      seed_position: index,
    })),
  )
  if (entriesError !== null) {
    await supabase.from('seasons').delete().eq('id', season.id)
    throw new EdgeError(`No se pudo cargar el plantel: ${entriesError.message}`)
  }

  return { seasonId: season.id, inviteToken: season.invite_token }
}
```

**`removeSeat` va a fallar cuando el asiento tenga historia, y está bien.**
`pairs` y `awards` referencian `entries` con `on delete no action`
(`0001_schema.sql:170,225`), justamente para que dar de baja a alguien no borre
las fechas que ya se jugaron. Traducí el `23503` a algo legible; no intentes
borrar en cascada y no agregues un "borrado lógico".

**Sacar un asiento deja un hueco en `seed_position`, y no pasa nada.**
`squadSeedOrder` ordena por esa columna y `entries_seed` es único, no
consecutivo. Renumerar sería reescribir el orden de desempate inicial de todos
los demás por sacar a uno.

- [ ] **Step 1: Escribir los tests que fallan**

Create `db/entries.db.test.ts`. Cubrir:

- `createSeason` deja la temporada en `SETUP`, con `squadSize` asientos `SQUAD`,
  `seed_position` de 0 a n-1 **en el orden en que vinieron los nombres**
- `createSeason` devuelve un `inviteToken` que `season_invite` resuelve
- `createSeason` con una config inválida no escribe **nada** (ni la temporada)
- `createSeason` con la cantidad de nombres distinta de `squadSize` tira, sin
  escribir
- **el rollback**: forzá el fallo del insert de asientos (un nombre vacío rebota
  contra `entries_squad_named`) y confirmá que **la temporada no quedó**
- `addSquadSeat` toma `max(seed_position) + 1`
- `renameSeat` cambia el nombre y **no** toca `player_id`
- `unlinkSeat` pone `player_id` en `null` y deja el nombre
- `removeSeat` de un asiento sin historia lo borra
- **`removeSeat` de un asiento con awards falla con un mensaje legible, y el
  award sigue ahí.** Es el test que protege el histórico
- un jugador que no es admin no puede hacer ninguna de las cuatro de
  `db/entries.ts` — RLS ya lo garantiza, pero una función que use el cliente
  equivocado lo saltea sin que nadie lo note
- `updateSeasonRules` guarda el texto **y** mueve `rules_updated_at`

**Expected: FAIL**

- [ ] **Steps 2-3: implementar, verificar y commitear**

```bash
npm run typecheck && npm test && npm run db:reset && npm run test:db && npm run build
git add db/season.ts db/entries.ts db/entries.db.test.ts
git commit -m "feat: create a season with its squad and let the admin edit the seats"
```

> **🔎 Revisión adversarial — borrado.** Tres cuentas, para hacer a mano:
> 1. **Una temporada de 8 con la fecha 3 cerrada. El admin saca el asiento del
>    que salió último.** ¿Qué pasa con `awards`? ¿Con `pairs`? ¿Con
>    `computeRanking`, que recibe un `squad` de 7 y un mapa de awards que nombra
>    a 8? Escribí el resultado esperado **antes** de correr nada.
> 2. **Agregar un asiento noveno con `config.squadSize` en 8.** Enumerá todo lo
>    que se rompe y todo lo que no. Confirmá que la fecha siguiente **no** se
>    puede abrir con 9 presentes si `points` tiene 4 valores, y decí qué función
>    lo frena.
> 3. **`createSeason` con 12 nombres y `defaultConfig(8)`.** ¿Qué chequeo la
>    frena, el de esta función o `validateConfig`? Si son los dos, ¿cuál corre
>    primero y qué mensaje ve el usuario?

---

### Task 4: `db/matchday.ts` — asistencia propia, invitado, y el Masters

**Files:**
- Modify: `db/matchday.ts`
- Modify: `db/close.db.test.ts`
- Create: `db/masters.db.test.ts`

**Interfaces:**
- Consumes: `set_my_attendance` y `create_masters` (Task 1); `mastersQualifiers`,
  `mastersFixture`, `computeRanking`, `snapshotForMatchday` de `core/`
- Produces:
  ```typescript
  function setMyAttendance(supabase, matchdayId, status: 'PLAYING' | 'ABSENT'): Promise<void>
  /** Escribe PLAYING para todo asiento SQUAD que todavía no tenga fila en esta fecha. Idempotente. */
  function seedAttendances(supabase, matchdayId): Promise<void>
  function nameGuest(supabase, entryId, displayName: string): Promise<void>
  function removeGuest(supabase, entryId): Promise<void>
  /** Agrega o saca el asiento de invitado según el conteo de confirmados quede impar o par. */
  function syncGuestSeat(supabase, matchdayId): Promise<void>
  function createMasters(supabase, seasonId, playedOn: string): Promise<string>
  function generateMastersPairs(supabase, matchdayId): Promise<void>
  ```

**Qué NO hace esta tarea:** no cambia `generatePairs`, `saveResult`,
`setAttendance`, `addGuest`, `lockPair` ni `unlockPair`, no toca `core/`, no arma
pantallas, no maneja el equipo invitado completo —`syncGuestSeat` administra
**un** invitado, el que aparece cuando el número da impar—.

**Dos funciones existentes necesitan un arreglo quirúrgico, y sólo ése.** Las dos
son bloqueantes del Masters y las dos escriben historia, así que se cambian con
el bisturí y con un test cada una.

```typescript
// En openMatchday, ANTES de todo lo demás:
//
// El Masters no tiene asistencias: son 4 clasificados, no 8 a 12 confirmados.
// pairingContextFor correría assertMatchdaySize sobre un `present` vacío y
// tiraría "Con 0 no hay fecha" en una fecha perfectamente armada. La función
// SQL open_matchday ya verifica lo único que importa acá: que existan parejas.
const matchday = await requireMatchday(supabase, matchdayId)
if (matchday.kind === 'MASTERS') {
  const { error } = await supabase.rpc('open_matchday', { p_matchday: matchdayId })
  if (error !== null) throw new EdgeError(error.message)
  return
}
```

```typescript
// En closeMatchday, donde hoy dice `const awards = computeAwards(...)`:
//
// El Masters define al campeón del año, no reparte puntos (spec 2.7), y
// close_matchday rechaza un p_awards no vacío para kind = 'MASTERS'. Sin esta
// línea el Masters no se puede cerrar: computeAwards devuelve seis premios y la
// función SQL los rebota con "El Masters no reparte puntos."
const awards =
  matchday.kind === 'MASTERS' ? [] : computeAwards(standings, config, guests.map((g) => g.entryId))
```

`matchdayContextFor` ya devuelve `matchday`, así que `closeMatchday` sólo tiene
que desestructurarlo.

**`seedAttendances` existe por una asimetría que muerde.** `playingEntryIds`
—lo que arma `present`— cuenta filas `PLAYING` **existentes**, así que un plantel
sin filas da `present` vacío: el panel diría "8 confirmados", `syncGuestSeat`
contaría 0, y `generatePairs` tiraría "Con 0 no hay fecha". La pantalla dibuja
"sin fila = viene", y esta función hace que la base opine lo mismo.

Es idempotente y **se llama al principio de cada acción del armado** —tildar,
sincronizar el invitado, generar—, no al renderizar. Un Server Component que
escribe al dibujarse es un GET con efectos, y en App Router además no puede
revalidar lo que acaba de cambiar.

**`syncGuestSeat` es la regla del spec §2.6 escrita una sola vez.** Se llama
después de cada cambio de asistencia, desde la Server Action de la Task 9:

- confirmados impar y ningún invitado → `addGuest` con nombre vacío
- confirmados par y hay **un** invitado sin nombre → `removeGuest`
- confirmados par y hay un invitado **con** nombre → **no se toca**. Alguien lo
  puso a propósito; sacarle el invitado al admin porque cambió un tilde es
  perder un dato que él cargó
- cualquier otra combinación (dos o más invitados) → no se toca. Ese es el equipo
  invitado, que este plan no administra

**`generateMastersPairs` no pasa por `buildPairs`.** El Masters tiene su propio
fixture: `mastersFixture(four)` da los 3 partidos con 6 parejas distintas, cada
una jugando una vez. Los 4 clasificados salen de `mastersQualifiers` sobre el
ranking de la temporada completa. Insertá las 6 parejas y los 3 partidos con
`round` 1, 2 y 3.

- [ ] **Step 1: Escribir los tests que fallan**

En `db/close.db.test.ts`:

- **cerrar una fecha `MASTERS` funciona y no escribe un solo award.** Este test
  falla hoy, y falla con el mensaje de la función SQL — dejalo fallar así antes
  de arreglar nada
- cerrar una fecha `REGULAR` sigue escribiendo exactamente los awards de antes
  (el test que ya existe no se toca)

Create `db/masters.db.test.ts`:

- `createMasters` sobre una temporada con todas las fechas cerradas devuelve el
  id de una fecha `MASTERS` en `DRAFT`
- `generateMastersPairs` deja **6 parejas y 3 partidos**, y cada uno de los 4
  clasificados aparece en exactamente 3 parejas
- **cada clasificado juega una vez con cada uno**: enumerá las 6 parejas y
  confirmá que son las 6 combinaciones posibles, sin repetir
- `openMatchday` sobre el Masters lo pasa a `OPEN` **sin tocar asistencias**
- cargar los 3 resultados y cerrarlo → `seasons.status = 'FINISHED'` y `awards`
  vacío para esa fecha
- `mastersChampion` sobre esos partidos da el mismo campeón que sale de contar a
  mano los partidos ganados

Y para las asistencias e invitados:

- `setMyAttendance` marca la fila del caller (el resto ya se probó en la Task 1;
  acá alcanza con que el wrapper llame bien)
- `seedAttendances` sobre un plantel de 8 sin ninguna fila deja 8 filas `PLAYING`
- **`seedAttendances` corrida dos veces deja 8 filas, no 16**
- **`seedAttendances` no pisa un `ABSENT` que ya existe.** Es el test que protege
  lo que el jugador avisó desde la Tabla
- `syncGuestSeat` con 9 confirmados agrega **un** invitado sin nombre
- `syncGuestSeat` con 10 confirmados y un invitado sin nombre lo saca
- `syncGuestSeat` con 10 confirmados y un invitado **con** nombre lo deja
- `syncGuestSeat` corrido dos veces seguidas no agrega dos invitados

**Expected: FAIL**

- [ ] **Steps 2-3: implementar, verificar y commitear**

```bash
npm run typecheck && npm test && npm run db:reset && npm run test:db && npm run build
git add db/matchday.ts db/close.db.test.ts db/masters.db.test.ts
git commit -m "feat: let a player mark their attendance and let the masters open and close"
```

> **🔎 Revisión adversarial — historia.** Tres cuentas, a mano y por escrito:
> 1. **Los 8 resultados posibles del Masters.** Enumerálos y confirmá lo que dice
>    el spec §2.7: sólo existen "alguien gana los 3" y "tres empatan en 2 y uno
>    queda en 0". Después confirmá que `mastersChampion` corta el triple empate
>    por ranking anual en los 4 casos donde ocurre.
> 2. **Una fecha de 6 parejas en una temporada con `points` de 4 valores.**
>    Seguí `closeMatchday` línea por línea y decí exactamente dónde revienta y
>    con qué mensaje. Si no revienta, encontraste un bug.
> 3. **El arreglo de `openMatchday`.** ¿Qué validaciones se saltea una fecha
>    `MASTERS` que una `REGULAR` sí corre? Listalas una por una desde
>    `pairingContextFor` y decí, de cada una, por qué no aplica al Masters. Si
>    hay una que sí aplicaría, el `return` temprano está mal puesto.

---

### Task 5: Mis torneos, y a dónde va cada quien

**Files:**
- Create: `app/torneos/page.tsx`
- Modify: `app/auth/actions.ts`, `app/page.tsx`, `app/unirse/[token]/actions.ts`

**Interfaces:**
- Consumes: `mySeasons`, `entriesOf`, `matchdaysOf`, `awardsOf`, `myEntryId` de
  `db/read.ts`; `rankingWithMovement`, `snapshotForMatchday` de `core/`
- Produces: la ruta `/torneos`, que es a donde va todo el mundo después de entrar

**Qué NO hace esta tarea:** no arma el wizard (Task 6, el CTA linkea a
`/torneos/nuevo`), no dibuja notificaciones ni configuración de cuenta, no
agrega una nav — esta pantalla está **un nivel por encima del torneo** y va sin
bottom nav.

**Es la pantalla que le faltaba a la app.** Hoy quien tiene dos temporadas
entra y queda en la landing, porque `loginDestination` no tiene dónde mandarlo.
Con esta pantalla la regla se simplifica: **después de entrar, todos van a
`/torneos`**, salvo que traigan un `next` explícito (el link de invitación, que
sigue ganando siempre). Borrá el caso especial de "una sola temporada": ya no
hace falta y era un camino distinto para el mismo destino.

`claimSeat` deja de mandar a la landing: `claim_seat` **devuelve el uuid de la
temporada**, así que redirigí a `/torneo/{seasonId}` — que es lo que pide el
handoff ("Unirse OK → Tabla").

En la landing, el bloque de usuario logueado gana un link a "Mis torneos".

**Mi posición y la próxima fecha se componen en la pantalla, no en `db/`.** Son
tres lecturas por temporada. Con las 1 a 3 temporadas que va a tener cualquiera
de este grupo eso es gratis, y una función `db/` con forma de pantalla es
exactamente lo que el Plan 3 aprendió a no hacer. Dejá un comentario `ponytail:`
diciendo que el techo es la cantidad de temporadas por usuario.

**Copys contractuales, textuales:**

| Dónde | Texto |
|---|---|
| Kicker del header | el nombre del usuario |
| Título | `"Mis torneos"` |
| Labels de la fila inferior | `"Mi posición"` · `"Próxima fecha"` |
| CTA | `"Crear torneo"` |
| Separador | `"Terminados"` |
| Vacío, título | `"Todavía no estás en ningún torneo"` |
| Vacío, cuerpo | `"Creá el tuyo y compartí el link con el grupo. Si alguien ya te pasó un link de invitación, abrilo y elegí tu nombre de la lista."` |
| 🆕 Chip de estado | `"Sin empezar"` (`SETUP`) · `"En curso"` (`ACTIVE`) · `"Terminado"` (`FINISHED`) |
| 🆕 Landing, logueado | `"Mis torneos"` |

> 🆕 El handoff dibuja el chip de estado con su tipografía y su color pero no le
> pone texto, y `ui-screens.md` §5 dice "(en curso / terminado)" sin el tercer
> caso. Los tres strings los decide este plan. `SETUP` existe de verdad: una
> temporada recién creada no pasa a `ACTIVE` hasta que se abre su primera fecha
> (`0005_matchday_moves.sql:37`).

**Medidas del handoff (§5):** tarjeta padding 16px, radio 16px, borde 1px `line`,
fondo `surface`. Nombre 18px/800/-.02em. Chip 10.5px/800, padding 6px 10px, radio
99px, `ok-bg`/`up`. Divisor vertical 1px × 26px entre las dos columnas. Labels
9.5px/800/uppercase/.13em `muted`, valores 15px/800. Terminados: `opacity: .6`,
nombre 15px/750, detalle 12px/600 `muted`. Vacío: título 22px/800, cuerpo
14px/550 `muted`.

**Estados a construir:** sin torneos · con torneos · con torneos terminados
(abajo, apagados).

- [ ] **Step 1: La pantalla · Step 2: Los cuatro redirects · Step 3: Verificar**

```bash
npm run typecheck && npm test && npm run build
git add app/torneos app/auth/actions.ts app/page.tsx "app/unirse/[token]/actions.ts"
git commit -m "feat: give everyone somewhere to land after signing in"
```

---

### Task 6: Crear torneo — el wizard de 5 pasos

**Files:**
- Create: `app/torneos/nuevo/page.tsx`, `app/torneos/nuevo/wizard.tsx`,
  `app/torneos/nuevo/actions.ts`
- Test: `app/torneos/nuevo/wizard.unit.test.ts`

**Interfaces:**
- Consumes: `defaultConfig`, `validateConfig` de `core/`; `createSeason` (Task 3)
- Produces: una temporada nueva; el link de invitación en el paso 5

**Qué NO hace esta tarea:** **no persiste nada hasta el paso 5**. No hay fila de
temporada a medio hacer, no hay borrador en la base, no hay autosave. Tampoco
instala una librería de formularios ni de drag & drop: los reordenamientos del
paso 3 son las flechas `↑↓`, que el handoff ya pide como alternativa accesible.

**Un solo componente cliente con los 5 pasos y un solo submit.** Es un formulario
que se usa una vez por año; partirlo en cinco rutas con estado compartido es
pagar routing por nada.

**Los defaults salen de `defaultConfig(squadSize)`** — decisión registrada 1. Se
recalculan cuando cambia el tamaño del plantel en el paso 2, **pisando los
valores del paso 4 si el admin ya los había tocado**. Es lo correcto: con otro
plantel, `points` necesita otra cantidad de valores.

**La validación es `validateConfig`, no una copia.** La función ya devuelve las
frases en español y ya tiene tests. Los dos mensajes del handoff que no salen de
ahí —los avisos del paso 2— sí van textuales.

**Copys contractuales, textuales:**

| Dónde | Texto |
|---|---|
| Kicker | `"Paso {n} de 5"` |
| Títulos | `"Nombre"` · `"El plantel"` · `"Orden inicial"` · `"Formato"` · `"Listo"` |
| CTA | `"Continuar"` — en el paso 5, `"Ir al torneo"` |
| Paso 1, ayuda | `"Como lo llaman en el grupo. Se puede cambiar después."` |
| Paso 2, botón | `"+ Agregar jugador"` |
| Paso 2, contador | `"{n} jugadores"` |
| Paso 2, aviso corto | `"Falta 1 nombre. El plantel arranca en 8."` |
| Paso 2, aviso impar | `"Son 9. El plantel tiene que ser par para poder armar parejas."` |
| Paso 2, ayuda | `"Tipeá los nombres del grupo, de 8 a 12. Después compartís un link y cada uno elige el suyo. No hace falta que vayan todos a todas las fechas."` |
| Paso 3, ayuda | `"Ordenalos del mejor al peor. Es el criterio que corta los empates hasta que haya fechas jugadas, y de ahí salen las primeras parejas."` |
| Paso 4, ayuda de puntos | `"Son los puntos de cada posición de la fecha. Si una fecha la juegan menos parejas, se usan los primeros de la lista — ganar siempre suma {puntos[0]}."` |
| Paso 4, filas | `"Sets por partido"` · `"Games por set"` · `"Fechas del año"` · `"Cuentan las mejores"` · `"Refresco del orden"` |
| Paso 4, errores | `"Los puntos tienen que ir de mayor a menor y ninguno puede quedar en cero."` · `"No pueden contar más fechas de las que se juegan."` |
| Paso 4, botón | `"Usar los defaults"` |
| Paso 4, ayuda | `"Todos tienen un valor que ya funciona. Si no te importa, seguí de largo."` |
| Paso 5, label | `"Link de invitación"` |
| Paso 5, botón | `"Copiar link"` → `"Copiado ✓"` |
| Paso 5, nota | `"Pegalo en el grupo. Cada uno elige su nombre de la lista al entrar."` |
| Paso 5, resumen | `Nombre` · `Jugadores` · `Formato` · `Puntos` · `Fechas` · `Desempate` |

**El paso 4 cambió de layout y está marcado 🔁 en el handoff.** Los puntos eran 4
columnas y con un plantel de 12 son 6 valores que no entran en 342px útiles.
**Pasan a filas:** una por posición, `1°` a la izquierda (13px/800 `muted`, ancho
fijo 28px), valor 20px/800 al centro, `−`/`+` de 34px a la derecha, alto de fila
56px, separadas por 1px `line`. La cantidad de filas sale del paso 2:
`plantel / 2`.

**Rangos de los steppers (medidas del handoff):** sets 1–3, games 3–9, fechas
4–24, cuentan 1–24, refresco 1–6.

**Medidas del handoff (§6):** barra de progreso de 5 segmentos `flex:1`, alto
4px, radio 99px, completados en `accent` y pendientes en `line`. Ayuda por paso
13.5px/550 `muted`. Campos padding 15px, radio 12px, borde 1.5px. Filas del paso
3: handle `⠿`, número, nombre 15px/700, dos botones cuadrados de 34px con fondo
`chip` radio 9px. Paso 5: tarjeta en `accent`, URL 13.5px/700 con
`word-break: break-all`, botón con fondo `accent-text` y texto `accent`.

- [ ] **Step 1: Escribir los tests que fallan**

`wizard.unit.test.ts` — corre en la suite unitaria, sin base ni navegador. Testeá
**las funciones puras del wizard**, no el render:

- el paso 2 con 7 nombres cargados devuelve el aviso corto; con 9, el de impar;
  con 8 o 10, ninguno
- cambiar el plantel de 8 a 12 devuelve 6 valores de puntos, no 4
- "Usar los defaults" con un plantel de 10 devuelve exactamente
  `defaultConfig(10)`
- la config que arma el paso 4 pasa `validateConfig` sin errores con los
  defaults de los tres tamaños (8, 10 y 12)
- `countBestOf` mayor que `regularMatchdays` produce el error del handoff, no el
  de `validateConfig`

**Expected: FAIL**

- [ ] **Steps 2-4: el wizard, la action, verificar**

```bash
npm run typecheck && npm test && npm run build
git add app/torneos/nuevo
git commit -m "feat: create a tournament from a five step wizard"
```

---

### Task 7: Tabla — "No voy" y "Sí voy"

**Files:**
- Modify: `app/torneo/[id]/page.tsx`
- Create: `app/torneo/[id]/asistencia.tsx`, `app/torneo/[id]/actions.ts`

**Interfaces:**
- Consumes: `attendancesOf`, `myEntryId`, `entriesOf`, `matchdaysOf` de
  `db/read.ts`; `setMyAttendance` (Task 4)
- Produces: `app/torneo/[id]/actions.ts`, que la Task 8 también usa

**Qué NO hace esta tarea:** no toca la tabla general ni el sheet de desempate,
no agrega el chip de hora —`played_on` es una columna `date` sin hora y no hay
dato que poner ahí—, no abre fechas, no arma Ajustes.

**El estado por defecto es "voy".** No hay fila de `attendances` hasta que
alguien toca el botón, y eso significa que viene: el admin arma la fecha con
todos y descuenta a los que avisaron. Así lo dibuja el handoff (la fila de la
Task 9 arranca en "Viene") y así se comporta `playingEntryIds`, que sólo cuenta
las filas `PLAYING`.

> **Ojo con esa asimetría, porque muerde.** `playingEntryIds` cuenta filas
> `PLAYING` **existentes**, así que un jugador sin fila **no** está en `present`.
> Quien concilia las dos cosas es `seedAttendances` (Task 4), y la llama el
> armado (Task 9). Acá alcanza con que "sin fila" se **dibuje** como anotado: esta
> pantalla no escribe nada hasta que alguien toca el botón.

**La tarjeta sólo se dibuja si la próxima fecha está en `DRAFT`.** Con la fecha
`OPEN` las parejas ya están armadas y `set_my_attendance` rechaza el cambio: un
botón que siempre falla es peor que no tener botón. Con la fecha `OPEN` la
tarjeta se muestra sin controles, como hoy.

**Copys contractuales, textuales:**

| Dónde | Texto |
|---|---|
| Kicker | `"Próxima fecha"` |
| Título de la tarjeta | `"Fecha {n} · {día}"` |
| Estado voy | `"Estás anotado"` + botón `"No voy"` |
| Estado no voy, con invitado | `"Avisaste que no vas. Te reemplaza {nombre} (invitado)."` + botón `"Sí voy"` |
| 🆕 Estado no voy, sin invitado | `"Avisaste que no vas."` + botón `"Sí voy"` |

> 🆕 El handoff trae una sola frase para "no voy" y da por hecho que hay
> reemplazo. Cuando todavía no hay invitado en la fecha, se muestra la misma
> frase **cortada en el punto**. Es un recorte del string contractual, no otro
> string: la app no puede afirmar un reemplazo que no existe, que es exactamente
> el defecto que el Plan 3 tuvo que arreglar con `"Estás anotado"`.

**Medidas del handoff (§7.1):** tarjeta padding 16px, radio 16px, fondo `accent`,
texto `accent-text`. Kicker con `opacity: .75`. Título 21px/800. Bloque de estado
con fondo `rgba(255,255,255,.16)`. Botón "No voy" con borde
`rgba(255,255,255,.4)`; botón "Sí voy" con fondo `accent-text`. **La acción es
reversible**, en los dos sentidos, siempre.

- [ ] **Step 1: La lectura y la tarjeta · Step 2: El toggle y la action · Step 3: Verificar**

```bash
npm run typecheck && npm test && npm run build
git add "app/torneo/[id]/page.tsx" "app/torneo/[id]/asistencia.tsx" "app/torneo/[id]/actions.ts"
git commit -m "feat: let a player say they are not coming, and take it back"
```

---

### Task 8: Fechas — "Abrir fecha N"

**Files:**
- Modify: `app/torneo/[id]/fechas/page.tsx`
- Create: `app/torneo/[id]/fechas/abrir.tsx`
- Modify: `app/torneo/[id]/actions.ts`

**Interfaces:**
- Consumes: `matchdaysOf`, `seasonHeader` de `db/read.ts`; `createMatchday` de
  `db/matchday.ts`
- Produces: la fecha en `DRAFT` que la Task 9 llena

**Qué NO hace esta tarea:** no toca las tarjetas de las fechas ni el bloque del
Masters (Task 13), no arma el flujo `DRAFT`, no cierra ni reabre nada.

**El CTA aparece sólo si soy admin Y no hay ninguna fecha sin cerrar.** La segunda
condición no es cosmética: `matchdays_one_live` rebota el insert con un `23505` y
`createMatchday` lo traduce a `"Ya hay una fecha sin cerrar en esta temporada."`.
Un botón que siempre falla es peor que no tener botón.

**El número que va en el label es el que va a tener la fecha**: `max(number) + 1`,
la misma cuenta que hace `createMatchday`. Si la lista dibuja "Abrir fecha 7" y
la base crea la 8, alguien va a pensar que la app se equivocó.

**Copys contractuales:** CTA `"Abrir fecha {n}"`, fondo `accent`, arriba de todo.

**🆕 El `<input type="date">`** va al lado del botón, con hoy por defecto, sin
label (decisión registrada 7). No hay copy porque no hay texto: el control
nativo es todo el control.

- [ ] **Steps 1-2: construir y verificar**

```bash
npm run typecheck && npm test && npm run build
git add "app/torneo/[id]/fechas/page.tsx" "app/torneo/[id]/fechas/abrir.tsx" "app/torneo/[id]/actions.ts"
git commit -m "feat: let the admin open the next matchday"
```

---

### Task 9: Fecha `DRAFT` — quién viene, el invitado, las parejas

**Files:**
- Modify: `app/torneo/[id]/fechas/[n]/page.tsx`
- Create: `app/torneo/[id]/fechas/[n]/armado.tsx`,
  `app/torneo/[id]/fechas/[n]/actions.ts`

**Interfaces:**
- Consumes: `entriesOf`, `attendancesOf`, `matchdayDetail` de `db/read.ts`;
  `seedAttendances`, `setAttendance`, `syncGuestSeat`, `nameGuest`, `lockPair`,
  `unlockPair`, `generatePairs`, `openMatchday` de `db/matchday.ts`;
  `previousContext`, `samePair` de `core/`
- Produces: una fecha en `OPEN`, que es lo que la Task 10 carga

**Qué NO hace esta tarea:** no carga resultados, no cierra ni reabre la fecha
(Task 10), no administra un equipo invitado completo —un solo invitado, el que
aparece cuando el número da impar—, **no arrastra al invitado en el orden**
(decisión registrada 2), no toca el estado `OPEN` ni el `CLOSED` de esta misma
pantalla, que ya están construidos y funcionan.

**Es la pantalla más grande del plan, y es la que se usa parado en el club.** El
panel de conteo es el protagonista: es lo que el admin mira mientras tilda, y se
actualiza en vivo con cada toque.

**"Sin fila" se dibuja como "viene", y `seedAttendances` hace que la base opine
lo mismo.** El default es venir: el admin arma la fecha con todos y descuenta a
los que avisaron. La pantalla lo dibuja así, y toda acción del armado arranca
llamando a `seedAttendances` para que `playingEntryIds` cuente lo mismo que el
panel. **Nunca la llames al renderizar**, sólo desde las actions.

**Cualquier cambio de asistencia invalida las parejas ya generadas.** Lo dice el
handoff (`generated: false`). No hace falta borrarlas de la base: alcanza con
dejar de mostrarlas y volver a pedir "Generar parejas". `generatePairs` es
re-ejecutable y borra las anteriores solo.

**El orden de las cuatro cosas, en cada tilde y en la misma action:**
`seedAttendances` → `setAttendance` → `syncGuestSeat` → `revalidatePath`. En ese
orden, o el panel de conteo va a decir una cosa y la fecha va a tener otra.
"Generar parejas" y "Confirmar fecha" también arrancan con `seedAttendances`: el
admin puede no haber tocado un solo tilde.

**Los bloqueos se dibujan antes de llamar a nada.** Los mensajes del handoff son
los que ve el admin; los de `assertMatchdaySize` son la red de abajo, para lo que
se escape. No los mezcles.

**Copys contractuales, textuales:**

| Dónde | Texto |
|---|---|
| Kicker del header | `"Armando · sólo vos la ves"` |
| Panel, número | `"{n} confirmados"` |
| Panel, consecuencia | `"La fecha es de {n} · {n/2} parejas"` |
| Panel, impar (en `warn-bg`) | `"Son impares. Se suma 1 invitado y la fecha queda de {n+1}."` |
| Paso 1 | `"Quién viene"` |
| Tags de la fila | `"Viene"` (`ok-bg`/`up`) · `"No viene"` (`chip`/`muted`) |
| Sub de quien avisó | `"Avisó que no va"` |
| Paso 2 | `"El invitado"` |
| Paso 2, kicker | `"Falta uno para armar parejas"` |
| Paso 2, nota | `"No suma puntos para el campeonato, pero su compañero sí."` |
| Paso 2, hint | `"Va último porque nadie sabe cómo juega. Movelo si lo conocés."` |
| Bloqueo, pocos | `"Con {n} no alcanza para armar una fecha. Hacen falta 8."` |
| Bloqueo, muchos | `"Son {n} y entran hasta 12. Con más, la fecha no termina nunca."` |
| Bloqueo, sin nombre | `"Ponele nombre al invitado antes de confirmar."` |
| Paso 3 | `"Parejas"` |
| Chips | `"Defensora"` (`ok-bg`/`up`) · `"Invitado"` (`chip`/`muted`) |
| Paso 3, nota | `"Los defensores quedan fijos. El resto se arma cruzando la tabla: 1° con último, 2° con anteúltimo, y así."` |
| Botones | `"Regenerar"` · `"Confirmar fecha"` |
| 🆕 Selector del invitado | `"Juega con"`, con la opción vacía `"El que toque"` |

> 🆕 El handoff dibuja un `⠿` y dos flechas para mover al invitado, y ese control
> **no se puede construir**: `orderPool` manda a los invitados al final del pool
> siempre. El control que sí implementa el spec §2.6 es elegir con quién juega
> (`lockPair`), y para eso hacen falta dos strings que el handoff no tiene. La
> hint de arriba —"Movelo si lo conocés"— se queda tal cual: sigue siendo cierta.

**El bloqueo de "pocos" aparece con menos de 7 confirmados, no con menos de 8.**
Con 7 confirmados la app suma el invitado y la fecha queda de 8, que es el
mínimo. La frase del handoff dice "Hacen falta 8" porque habla del **tamaño de la
fecha**, no de cuántos tildaste.

**Medidas del handoff (§9a):** panel padding 16px, radio 16px, fondo `surface`,
borde 1px `line`; número 32px/800 centrado; consecuencia 12.5px/600 `muted`; la
línea de impar pasa a `warn-bg` con texto 12.5px/700. Filas: avatar 30px + nombre
14.5px/700 + tag; "no viene" con `opacity: .5` y **sin borde de alerta** —faltar
es normal y no bloquea nada—. Tarjeta del invitado con borde 1.5px dashed `line`;
campo padding 15px, radio 12px, borde 1.5px `accent` mientras esté vacío; nota
11.5px/600 `muted`. Parejas: filas numeradas con nombres 14.5px/750, la defensora
con borde `up`. Pie: "Regenerar" con borde 1.5px `line`, "Confirmar fecha" en
`accent` con `flex: 1`.

**Estados a construir:** plantel sin tildar (todos vienen) · número par ·
número impar con el invitado sin nombre · menos de 7 · más de 12 · parejas
generadas · parejas generadas y después un tilde cambiado.

- [ ] **Step 1: La siembra de asistencias y el panel de conteo**
- [ ] **Step 2: El invitado y su selector**
- [ ] **Step 3: Generar, regenerar y confirmar**
- [ ] **Step 4: Verificar**

```bash
npm run typecheck && npm test && npm run build
git add "app/torneo/[id]/fechas/[n]"
git commit -m "feat: build a matchday from who is coming"
```

---

### Task 10: Fecha `OPEN` y `CLOSED` — cargar, cerrar y reabrir

**Files:**
- Modify: `app/torneo/[id]/fechas/[n]/page.tsx`,
  `app/torneo/[id]/fechas/[n]/rondas.tsx`,
  `app/torneo/[id]/fechas/[n]/actions.ts`
- Create: `app/torneo/[id]/fechas/[n]/carga.tsx`
- Test: `app/torneo/[id]/fechas/[n]/carga.unit.test.ts`

**Interfaces:**
- Consumes: `matchdayDetail` (con `MatchWithId`, Task 2); `saveResult`,
  `closeMatchday`, `reopenMatchday` de `db/matchday.ts`; `setError`, `matchError`
  de `db/validate.ts`
- Produces: nada. Es la última tarea del flujo regular

**Qué NO hace esta tarea:** no cambia el acordeón de rondas —ya está construido y
funciona, sólo se le enchufa el botón de carga—, no toca el estado `DRAFT` (Task
9), no recalcula la tabla a mano: `computeStandings` ya la calcula y la pantalla
ya la dibuja.

**La carga es de dos toques y sin teclado.** Es el requisito que define esta
pantalla: se usa parado, de noche, con una mano.

1. `"Cargar resultado"` → `"¿Quién ganó?"`, dos botones con los nombres de las
   parejas.
2. `"Games del perdedor"`, un botón por cada valor de `0` a `gamesPerSet − 1`.
   El ganador queda en `gamesPerSet`.

**Con `setsToWin > 1` los dos toques se repiten por set.** El componente acumula
los sets en el cliente y llama a `saveResult` **una sola vez**, con el partido
completo. No lo llames por set: `saveResult` **reemplaza** los sets, no los
acumula, así que cargar de a uno borraría el anterior. Con el default de un set
esto es exactamente la interacción de dos toques del handoff.

**Los números de la carga salen de `config.matchFormat`, no de un literal.** El
handoff dibuja `0 / 1 / 2 / 3` porque su config es un set a 4 games. Con otra
config son otros botones.

**Cerrar es lo que congela la historia.** El botón está deshabilitado mientras
falten resultados y dice cuántos faltan; `close_matchday` vuelve a verificarlo
del lado de la base, y esa verificación es la que manda.

**Reabrir borra puntos, así que se confirma en línea.** Nada de `confirm()`: el
botón revela un bloque con el aviso y dos botones. `reopen_matchday` ya valida
que sea la última cerrada y ya sabe borrar la fecha siguiente si está vacía —no
repliques esas reglas en la pantalla, mostrá su mensaje.

**Copys contractuales, textuales:**

| Dónde | Texto |
|---|---|
| Kicker `OPEN` | `"En juego · {día}"` |
| Kicker `CLOSED` | `"Cerrada · {día}"` |
| Botón de carga | `"Cargar resultado"` |
| Paso 1 | `"¿Quién ganó?"` |
| Paso 2 | `"Games del perdedor"` |
| Sin resultado | `"–"` |
| Cerrar, incompleta | `"Cerrar fecha · faltan {n} partidos"` (deshabilitado) |
| Cerrar, completa | `"Cerrar fecha"` (en `accent`) |
| Reabrir | `"Reabrir fecha"` |
| 🆕 Aviso de reabrir | `"Se borran los puntos de esta fecha y la tabla se recalcula."` |
| 🆕 Botones del aviso | `"Reabrir"` · `"Cancelar"` |

> 🆕 `ui-screens.md` §9c pide "confirmación explícita y el aviso de que se
> recalculan los puntos" pero no da la frase, y el handoff dibuja el botón sin
> confirmación. Las tres las decide este plan. El aviso dice lo que
> `reopen_matchday` hace de verdad: `delete from public.awards`.

**Medidas del handoff (§9b):** partido padding 13px, radio 14px, borde 1px
`line`, fondo `surface`. Nombre 14.5px, weight 800 si ganó y 650 si no, el
perdedor en `muted`. Score en caja de 32px mínimo, radio 8px, fondo `chip`,
16px/800. Chips de las parejas arriba: radio 99px, 11.5px/750, la defensora en
`ok-bg`/`up`, `gap: 6px` cuando envuelven a dos líneas.

**Estados a construir:** `OPEN` sin ningún resultado · `OPEN` a medio cargar
(la ronda incompleta abierta, las completas colapsadas — ya lo hace el acordeón)
· `OPEN` completa · `CLOSED` · `CLOSED` que no es la última (sin botón de
reabrir).

- [ ] **Step 1: Escribir los tests que fallan**

`carga.unit.test.ts` — suite unitaria, sin base. Testeá la **máquina de estados**
de la carga, que es donde está toda la lógica nueva:

- un set a 4 con tie-break: ganador A y 2 games del perdedor → `[{gamesA: 4, gamesB: 2}]`
- lo mismo con ganador B → `[{gamesA: 2, gamesB: 4}]`. **Un fixture de cada
  lado**, o el error de lado pasa desapercibido
- los botones de "games del perdedor" son `0..gamesPerSet - 1`: con `gamesPerSet:
  4` son cuatro botones, con `6` son seis
- todo lo que produce la máquina pasa `setError` con esa misma config. **Correlo
  sobre los dos lados y todos los valores posibles**, no sobre un caso
- con `setsToWin: 2`, dos sets ganados por el mismo lado cierran el partido y
  `matchError` lo acepta; uno solo no lo cierra
- cancelar a mitad de camino no deja sets a medio armar

**Expected: FAIL**

- [ ] **Steps 2-4: la carga, el cierre, la reapertura, verificar**

```bash
npm run typecheck && npm test && npm run db:reset && npm run test:db && npm run build
git add "app/torneo/[id]/fechas/[n]"
git commit -m "feat: load results in two taps, close the matchday and reopen it"
```

> **🔎 Revisión adversarial — historia y borrado.** Cuatro cuentas, a mano:
> 1. **Enumerá los 4 resultados posibles** de un set a 4 con tie-break, para cada
>    una de las dos parejas: 8 combinaciones. Corré la máquina de estados sobre
>    las 8 y confirmá que `setError` acepta las 8 y que ninguna sale con el lado
>    invertido.
> 2. **Una fecha de 4 parejas con el reparto `2-2-1-1`.** Calculá a mano la tabla
>    con la cadena de desempate del spec §2.3 y comparala contra lo que dibuja la
>    pantalla. Es uno de los dos repartos que `core/` no tiene fixture (deuda
>    conocida en `docs/estado.md`).
> 3. **Reabrir la fecha 3 de una temporada con la 4 en `DRAFT` y una asistencia
>    cargada.** Seguí `reopen_matchday` línea por línea y decí qué mensaje ve el
>    admin. Después la misma cuenta con la 4 en `DRAFT` y **vacía**.
> 4. **Rompé la guardia y miralo fallar:** sacá el chequeo de "faltan resultados"
>    de la pantalla y confirmá que `close_matchday` igual rebota. Después sacalo
>    de `close_matchday` y confirmá que un test se pone rojo. Si no se pone,
>    falta un test.

---

### Task 11: Ajustes

**Files:**
- Create: `app/torneo/[id]/ajustes/page.tsx`,
  `app/torneo/[id]/ajustes/actions.ts`,
  `app/torneo/[id]/ajustes/plantel.tsx`,
  `app/torneo/[id]/ajustes/formato.tsx`,
  `app/torneo/[id]/ajustes/reglas.tsx`

**Interfaces:**
- Consumes: `seasonHeader`, `entriesOf`, `seasonRules`, `playerNames` de
  `db/read.ts`; `renameSeason`, `updateSeasonConfig`, `updateSeasonRules` de
  `db/season.ts`; las cuatro de `db/entries.ts`; `validateConfig` y
  `narrateRules` de `core/`; `renderAdminMarkdown` de la pantalla de Reglas
- Produces: nada

**Qué NO hace esta tarea:** no construye Notificaciones ni Apariencia ni
"Cambiar contraseña" ni "Salir del torneo" (decisión registrada 6), **no toca
`squadSize` ni `points` al agregar o sacar un asiento** (decisión registrada 3),
no reordena el plantel, no borra la temporada, no instala una librería de
markdown —`renderAdminMarkdown` ya existe y ya está probada—.

**Es la única pantalla de administración pura de toda la app**, y sólo la ve el
admin. La guarda es `seasonHeader().isAdmin`; si es `false`, la pantalla no se
dibuja. Pero **la guarda de verdad es RLS**: todas las escrituras de acá pasan
por políticas que piden `is_season_admin`. La de la pantalla es cortesía.

**El editor de reglas es un `<textarea>` con vista previa.** La vista previa
usa `renderAdminMarkdown`, la misma función que la pantalla pública, así que lo
que ve el admin mientras escribe es exactamente lo que va a ver el grupo —
escapado incluido.

**El desajuste de plantel se reporta con `validateConfig`, no con copy nuevo.**
Cuando la cantidad de asientos `SQUAD` no coincide con `config.squadSize`,
mostrá lo que devuelve `validateConfig({ ...config, squadSize: cantidadReal })`.

**Copys contractuales, textuales:**

| Dónde | Texto |
|---|---|
| Secciones | `"Torneo"` · `"Cuenta"` |
| Filas de Torneo | `"Nombre"` · `"Plantel"` · `"Formato"` · `"Link de invitación"` |
| Valor de Plantel | `"{n} ›"` |
| Valor de Formato | `"{sets} set a {games} ›"` |
| Valor del link | `"Copiar ›"` → `"Copiado ✓"` |
| Nota al pie de Torneo | `"Cambiar el formato con fechas ya jugadas no recalcula la tabla vieja."` |
| Fila de Cuenta | `"Cerrar sesión"` (14px/750 color `live`) |
| Editor de reglas | `"Texto de reglas"` |
| 🆕 Asiento sin dueño | `"Sin dueño"` |
| 🆕 Acciones por asiento | `"Editar nombre"` · `"Desvincular"` · `"Sacar"` |
| 🆕 Agregar | `"+ Agregar jugador"` (el mismo del wizard) |

> 🆕 `ui-screens.md` §13 describe estas acciones ("editar el nombre, desvincular
> el reclamo, se puede agregar y sacar gente") pero el handoff dibuja la fila de
> Plantel como un `›` que lleva a otro lado y nunca dibuja ese otro lado. Los
> strings los decide este plan, y "Sin dueño" sale textual de `ui-screens.md`.

**Medidas del handoff (§13):** secciones con label 10.5px/800/uppercase `muted`
sobre una lista agrupada con borde 1px `line`, radio 14px, fondo `surface`, filas
separadas por 1px `line`. Cada fila: label 14px/700 + hint 11.5px/600 `muted`, y
valor 13px/750 `muted` a la derecha.

**El bloque de Formato reusa el layout del paso 4 del wizard**, filas incluidas.
Si eso te tienta a extraer un componente compartido: **no lo hagas en esta
tarea.** Anotalo en `Aparecidos` y seguí. Son dos usos, el segundo recién existe
ahora, y el disparador para extraerlo es un tercero o un cambio que haya que
hacer en los dos.

**Estados a construir:** plantel completo y alineado con la config · plantel
desalineado (el aviso de `validateConfig`) · asiento sin dueño · asiento con
dueño · intento de sacar un asiento con historia (el error de `removeSeat`,
visible y en línea).

- [ ] **Steps 1-4: las cuatro secciones y su verificación**

```bash
npm run typecheck && npm test && npm run build
git add "app/torneo/[id]/ajustes"
git commit -m "feat: let the admin edit the squad, the format and the rules"
```

---

### Task 12: Reglas, sin login

**Files:**
- Modify: `app/torneo/[id]/layout.tsx`, `app/torneo/[id]/reglas/page.tsx`
- Create: `app/torneo/[id]/reglas/rules-body.tsx`

**Interfaces:**
- Consumes: `publicRules` (Task 2); `narrateRules` de `core/`;
  `renderAdminMarkdown` y `RulesAccordion`, que ya existen
- Produces: nada

**Qué NO hace esta tarea:** no crea una ruta nueva —el link que la gente ya tiene
es `/torneo/{id}/reglas`—, no duplica la pantalla, no hace públicas Tabla,
Fechas ni Stats, no toca el sanitizado, no agrega ningún dato a
`season_public_rules`.

**Esto cierra un defecto conocido, no agrega una función.** El Plan 3 construyó
la rama "sin sesión" de esta pantalla, correcta y completa, y la dejó
inalcanzable: el layout llama a `seasonHeader()` sin condición y tira antes de
que la página se monte. La rama existe, funciona, y nadie la puede ver.

**El cambio del layout son seis líneas:**

- sin sesión → no llamar a `seasonHeader`, no dibujar la nav, renderizar
  `children` con el mismo contenedor
- con sesión → exactamente lo de hoy

Las demás pantallas del torneo siguen tirando por RLS para un anónimo, y está
bien: son privadas. Lo único que cambia es **quién** las frena — antes el layout,
ahora la query.

**El cuerpo de la pantalla se extrae a `rules-body.tsx`** y las dos ramas —con
sesión y sin sesión— lo renderizan con los mismos props. Es un componente de
presentación puro: recibe `name`, `config`, `adminName`, `rulesText` e
`isAdmin`, y no lee nada.

**La rama sin sesión va sin nav de torneo y con un CTA discreto a la landing**,
como pide `ui-screens.md` §11.

**Copys contractuales:** los de la pantalla no cambian —intro
`"Las reglas de este torneo, como quedaron cuando {admin} lo creó."`, los seis
títulos del acordeón, `"Editar reglas"`—. El CTA de la rama pública es
`"Ir al inicio"`, que ya está escrito en esa página.

**La frase `"Para ver las reglas de este torneo necesitás el link que te pasó tu
grupo."` se queda**, pero cambia de caso: ya no es "no hay sesión" sino
"`publicRules` devolvió `null`", o sea link roto o temporada borrada. Es
exactamente lo que dice.

- [ ] **Step 1: Extraer el cuerpo · Step 2: Aflojar el layout y enchufar `publicRules` · Step 3: Verificar**

**La verificación de esta tarea es a mano y no es opcional:** abrí
`/torneo/{id}/reglas` **en una ventana privada, sin sesión**, y confirmá que se
ve. Con un `<script>alert(1)</script>` guardado de verdad en `rules_text`.

```bash
npm run typecheck && npm test && npm run build
git add "app/torneo/[id]/layout.tsx" "app/torneo/[id]/reglas"
git commit -m "feat: make the rules page reachable without an account"
```

---

### Task 13: El Masters

**Files:**
- Modify: `app/torneo/[id]/fechas/page.tsx`,
  `app/torneo/[id]/fechas/[n]/page.tsx`,
  `app/torneo/[id]/fechas/[n]/actions.ts`
- Create: `app/torneo/[id]/fechas/[n]/masters.tsx`

**Interfaces:**
- Consumes: `createMasters`, `generateMastersPairs` (Task 4); `mastersQualifiers`,
  `mastersFixture`, `mastersChampion`, `MASTERS_SIZE` de `core/`;
  `rankingWithMovement` de `core/`
- Produces: nada. Es la última tarea de producto

**Qué NO hace esta tarea:** **no crea una ruta `/masters`** — el Masters es una
fecha más y se juega en `/torneo/{id}/fechas/{n}` (decisión registrada 5). No
reparte puntos. No cambia la carga de resultados: son 3 partidos y se cargan con
los mismos dos toques de la Task 10. No toca `close_matchday`, que ya sabe que el
Masters termina el año.

**El bloque del Masters en Fechas ya está construido y dice "Bloqueado".** Lo
único que cambia es que, cuando todas las fechas regulares están cerradas y soy
admin, ese bloque ofrece armarlo. El resto del bloque —kicker, título, cuerpo,
medidas— no se toca.

**La pantalla de la fecha `MASTERS` cambia en tres lugares y en ninguno más:**

1. **En `DRAFT`, en vez del armado de la Task 9**, muestra los 4 clasificados en
   orden de ranking y un botón para generar. No hay asistencias, no hay
   invitado, no hay tilde: los 4 salen del ranking.
2. **En `OPEN`**, los 3 partidos con la carga de dos toques. Igual que una fecha
   regular.
3. **En `CLOSED`**, en vez de la tabla de la fecha y los puntos, **el campeón del
   año**, que sale de `mastersChampion(four, matches)`.

**Si el desempate del Masters cortó por ranking, hay que decirlo.** El formato
sólo admite dos desenlaces (spec §2.7): campeón limpio con 3 partidos ganados, o
triple empate en 2 con uno en 0 — y el triple empate ocurre la mitad de las
veces. Un campeón con 2 victorias igual que otros dos, sin una línea que explique
por qué es él, se lee como un bug.

**Copys contractuales, textuales:**

| Dónde | Texto |
|---|---|
| Bloque en Fechas, kicker | `"Cierre del año"` |
| Bloque en Fechas, título | `"Masters"` |
| Bloque en Fechas, cuerpo | `"Se juega con los {MASTERS_SIZE} primeros de la tabla al terminar las {n} fechas. Faltan {m}."` |
| Chip, bloqueado | `"Bloqueado"` |
| 🆕 CTA, habilitado | `"Armar el Masters"` |
| 🆕 Título de la pantalla | `"Masters"` (en vez de `"Fecha {n}"`) |
| 🆕 Clasificados | `"Los {MASTERS_SIZE} primeros del año"` |
| 🆕 Generar | `"Generar los partidos"` |
| 🆕 Campeón | `"Campeón del año"` |
| 🆕 Desempate por ranking | `"{nombre} y {otros} ganaron {n} partidos cada uno. Corta el ranking del año."` |

> 🆕 El handoff dibuja el Masters **sólo** como el bloque bloqueado del final de
> Fechas: nunca dibujó la jornada jugándose, porque el prototipo no la tenía
> entre sus 13 pantallas. Los seis strings los decide este plan. Los que se
> pueden derivar, se derivan: `MASTERS_SIZE` sale de `core/constants.ts`, nunca
> del número 4 escrito a mano.

**El kicker y el estado siguen las reglas de la fecha regular:** `"Armando · sólo
vos la ves"`, `"En juego · {día}"`, `"Cerrada · {día}"`. Esos sí son
contractuales y ya están implementados.

- [ ] **Step 1: El CTA en Fechas · Step 2: Los tres estados · Step 3: Verificar**

```bash
npm run typecheck && npm test && npm run db:reset && npm run test:db && npm run build
git add "app/torneo/[id]/fechas"
git commit -m "feat: play the masters and crown the champion of the year"
```

---

### Task 14: El recorrido con navegador

**Files:**
- Create: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: la app corriendo en `npm run dev`, con la base reseteada
- Produces: una lista de defectos, que se arreglan **en esta misma tarea**

**Qué NO hace esta tarea:** no agrega Playwright a `package.json` —se instala
aparte, ver abajo—, no escribe una suite de E2E, no refactoriza nada de lo que
encuentre que no sea un defecto real.

**Por qué existe esta tarea.** El Plan 3 terminó con las dos suites en verde, el
typecheck limpio y `npm run build` compilando. Después se abrió un navegador por
primera vez y **aparecieron cinco defectos reales en veinte minutos**. Ninguno
era detectable por lo que había: el login no tenía destino, la primera pantalla
podía tirar 500, la Tabla decía "EN CURSO" con la temporada sin arrancar, Fechas
salía vacía, y Reglas decía "Marce lo creó" en todos los torneos.

**Una pantalla que tipa y compila puede estar mintiendo en cada línea.** Este
plan agrega catorce pantallas que además **escriben**.

**Cómo se corre, y las trampas del entorno:**

- `npm run build` con el dev server vivo **corrompe `.next`** y tira 500 que
  parecen bugs de código. Buildeá con el server apagado.

  **Y la trampa es peor de lo que dice esa línea, medida tres veces en un día:**
  el build sale bien; **el que queda roto es el dev server**, y de una forma que
  no parece un problema de build. Sigue sirviendo el HTML, pero **todos los
  chunks de JS pasan a dar 404** (`main-app.js`, `app-pages-internals.js`,
  `app/login/page.js`). Sin JS React no hidrata, `canSubmit` se queda en `false`
  y **el botón "Entrar" nunca se habilita** — se lee como "el login está roto",
  no como "el server está en mal estado". Las otras dos direcciones del mismo
  problema: arrancar `npm run dev` sobre un `.next` de producción tira
  `MODULE_NOT_FOUND`, y editar archivos con el dev server vivo tira
  `UnrecognizedActionError: Server Action ... was not found on the server`.

  **La regla, entonces:** antes de cualquier `npm run build`, mirar qué hay
  levantado con `ss -ltnp | rg :300` — en esta máquina los puertos 3000 a 3003
  son de otros proyectos y el dev server de padelApp puede estar en cualquiera.
  Y después de buildear, `rm -rf .next` antes de volver a `npm run dev`.
  **Matar el server por el PID que tiene el puerto**, no por el nombre: `kill` al
  wrapper de `npm`/`sh` deja `next-server` vivo con el puerto tomado.
- `npm run test:db` deja ~80 temporadas basura. **Corré `npm run db:reset` antes
  de cualquier verificación visual.**
- El seed **no fija el UUID de la temporada demo**: cambia en cada reset.
  Credenciales: `admin@demo.com` / `demodemo`.
- Playwright no está en el proyecto. Instalalo en el scratchpad y apuntá a
  `~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`.
- **Al llenar el form de login, cargá con `waitUntil: 'networkidle'`.** Si llenás
  antes de que React hidrate, el submit queda deshabilitado y parece que el login
  está roto.

**El script es un script, no una suite.** `node scripts/smoke.mjs` con la app
levantada. Sin framework, sin fixtures, sin dependencia nueva en `package.json`.
Un comentario arriba dice qué hace falta para correrlo.

**El recorrido, en este orden:**

1. Landing sin sesión → 200
2. Login con las credenciales del seed → cae en `/torneos`
3. `/torneos` → la temporada demo está en la lista, con posición y próxima fecha
4. Crear un torneo nuevo de 8, con nombres de verdad, hasta el paso 5
5. En el torneo nuevo: abrir la fecha 1
6. Tilde de asistencia: dejar 7 → confirmar que aparece el invitado y el conteo
   dice 8
7. Ponerle nombre al invitado, generar parejas, confirmar → la fecha queda `OPEN`
8. Cargar los 6 resultados con los dos toques → cerrar la fecha
9. La Tabla muestra puntos, movimiento y defensores
10. Ajustes: cambiar el nombre del torneo y guardar texto de reglas
11. `/torneo/{id}/reglas` **en una ventana sin sesión** → se ve
12. Las cuatro pestañas del torneo demo, en claro y en oscuro

**Por cada paso, dos aserciones:** que la respuesta sea 200, y **que lo que dice
la pantalla coincida con el estado real de los datos**. La segunda es la que
encuentra cosas: los cinco defectos del Plan 3 eran todos pantallas que
respondían 200 y decían algo falso.

- [ ] **Step 1: Escribir el script · Step 2: Correrlo · Step 3: Arreglar lo que encuentre · Step 4: Anotar en `Aparecidos` lo que no se arregle**

```bash
npm run db:reset
npm run dev   # en otra terminal
node scripts/smoke.mjs
# con el dev server APAGADO:
npm run typecheck && npm test && npm run test:db && npm run build
git add scripts/smoke.mjs
git commit -m "test: walk the whole app in a browser and fix what it found"
```

---

## Aparecidos

Cosas que salieron durante la implementación. Las primeras cinco ya ocurrieron;
las dos últimas son deuda que hereda quien siga.

### Lo que apareció ejecutando las Tasks 1 a 6

- **Crear una temporada bajo RLS era imposible, y no lo sabía nadie.**
  `seasons_read` es `is_participant(id)`, e `is_participant` responde con un
  SELECT sobre `public.seasons` adentro de una función `security definer`. Ese
  subselect corre con el snapshot de la sentencia, que **no contiene la fila que
  esa misma sentencia está insertando**, así que el `returning` —que PostgREST
  siempre emite cuando el cliente hace `.select()` después de un insert— se
  rechaza con `42501` aunque el `WITH CHECK` de `seasons_insert` pase perfecto.
  Verificado a mano en psql: el mismo insert **sin** `returning` entra, **con**
  `returning` no. Nunca lo agarró nadie porque los andamios de `db/test/` arman
  las temporadas con `service_role`, que saltea RLS, y hasta este plan no había
  pantalla que creara un torneo. Arreglado en `supabase/migrations/0008_seasons_returning.sql`:
  la policy pregunta primero por la columna de la fila nueva. **Es una migración
  fuera de la lista de archivos de la Task 3**, y se agregó porque sin ella la
  Task 6 entera es imposible. Mutación verificada: revertir la policy pone 7
  tests en rojo.
- **La Task 4 agregó dos funciones que no estaban en su contrato**, las dos por
  el mismo motivo: `playingEntryIds` cuenta filas `PLAYING` **existentes**, así
  que un plantel sin filas da `present` vacío. `seedAttendances` hace que la base
  opine lo mismo que la pantalla ("sin fila = viene"), y `clearPairs` borra el
  sorteo cuando cambia quién viene — sin eso, sacar el invitado automático falla
  con un `23503` ilegible y `openMatchday` rebota con "Cambió quién viene desde
  que armaste las parejas".
- **La Task 6 agregó `app/torneos/nuevo/wizard-state.ts`**, que no estaba en la
  lista de archivos del plan. El plan pedía un `wizard.unit.test.ts` sobre "las
  funciones puras del wizard" sin decir dónde viven, y adentro de un componente
  `'use client'` no se pueden testear cómodamente. El test quedó como
  `wizard-state.unit.test.ts` por el mismo motivo.
- **Se extrajo `app/format.ts`.** Había **tres** copias del formateador de fecha
  de una jornada y **tres** de `initials()`, y la Task 5 iba a agregar la cuarta
  de cada una. Es refactor que el plan no pedía; se hizo porque el disparador ya
  estaba cumplido de sobra y costó veinte líneas.
- **Un test pasó por vacuidad y se apretó.** El de "create_masters con otra fecha
  abierta" asertaba `expect(error).not.toBeNull()`, y eso se cumplía con "la
  función no existe" — o sea que pasaba en verde **antes** de que la función
  existiera. Quedó `expect(error?.code).toBe('23505')`. Es exactamente la lección
  que `docs/estado.md` ya tenía anotada del Plan 2, y volvió a aparecer.

### Lo que apareció ejecutando las Tasks 8, 9 y 10

- **La Task 9 necesitó una lectura que no existía: `pairLocksOf` en
  `db/read.ts`.** El selector 🆕 "Juega con" escribe con `lockPair` y tiene que
  poder cambiar de opinión, o sea llamar a `unlockPair(lockId)` — y el id de la
  fila no lo devuelve nadie. `locksOf` vive privada en `db/matchday.ts` y tira el
  id a propósito, porque una `Pair` de `core/` es `{ a, b }` y nada más. Son doce
  líneas y **es un archivo fuera de la lista de la Task 9** (`db/read.ts` es de la
  Task 2). Sin eso el selector se puede poner una vez y nunca más.
- **Un caso que dejaba la fecha trabada, y lo destraba `saveGuestName`.** Con
  número par y un invitado YA NOMBRADO, `syncGuestSeat` lo conserva a propósito
  ("alguien lo puso"), así que la fecha queda de 9 y no se puede generar. La
  única salida es borrarle el nombre, y por eso `saveGuestName` termina llamando
  a `syncGuestSeat` — sin eso el asiento no se iba hasta el próximo tilde de
  asistencia. El panel de conteo sigue midiendo la paridad sobre el **plantel**:
  contando al invitado, el número daría siempre par y la línea "Son impares" —la
  que explica por qué apareció la tarjeta— no se vería nunca.
- **"Avisó que no va" se muestra en toda fila ausente.** `attendances` no guarda
  quién escribió la fila, así que distinguir al que avisó del que sacó el admin
  es una columna nueva. Está anotado con un `ponytail:` en `armado.tsx`.
- **La Task 10 partió la máquina de la carga en `carga-state.ts`**, con su test
  `carga-state.unit.test.ts`, y no en el `carga.unit.test.ts` que pedía el plan.
  Es exactamente el mismo motivo y la misma forma que `wizard-state.ts` de la
  Task 6: adentro de un componente `'use client'` esa lógica no se testea
  cómodamente. `CierreFecha` quedó en `carga.tsx` por lo contrario — para no
  agregar un quinto archivo que la tarea no lista.
- **Cancelar la carga a mitad de camino no tiene copy en ningún lado.** El plan
  lo pide como comportamiento ("cancelar a mitad de camino no deja sets a medio
  armar") pero ni el handoff ni la tabla de copys traen la palabra. Se resolvió
  sin inventar ninguna: **"Cargar resultado" es su propio cancelar**, volver a
  tocarlo cierra el panel y tira el set a medio armar.
- **La revisión adversarial de la Task 10 encontró un defecto real, y estaba en
  el reintento.** Si `saveResult` fallaba, `tapGames` hacía `return` dejando el
  partido completo en el estado y el panel abierto en "¿Quién ganó?": dos toques
  más apilaban un **tercer set fantasma** que `matchError` acepta —2-1 es legal
  a dos sets— y que `saveResult` escribía **encima del bueno**, porque reemplaza.
  La fecha pasaba de 2-0 / 12-7 a 2-1 / 14-13, y eso mueve la tabla por
  `setsDiff` y por games. Arreglado en los dos lados: `chooseLoserGames` no hace
  crecer un partido ya cerrado —la guarda está en el único punto por donde pasan
  todos los llamadores— y el panel se cierra cuando el guardado falla. El test
  que lo cubre se verificó por mutación: sin la guarda se pone rojo.
  Con `setsToWin: 1` el bug no escribía nada, sólo trababa el panel; **sólo
  mordía en formato multi-set.**
- **La segunda revisión encontró otro: "Reabrir fecha" se ofrecía en el camino
  normal, y ahí falla siempre.** `isLastClosed` replicaba **una** de las dos
  guardas de `reopen_matchday` —"no hay una CLOSED posterior" (`0005:180-185`)—
  y se olvidaba de la otra: "no hay ninguna fecha sin cerrar aparte de ésta"
  (`0005:174-179`). Con la 2 cerrada y la 3 en juego —o sea, después de cada
  cierre— el admin veía el botón, abría el panel que promete "Se borran los
  puntos de esta fecha y la tabla se recalcula", y recién al confirmar chocaba
  contra el error. Arreglado sumando la fecha `OPEN` a la cuenta. **La fecha
  siguiente en `DRAFT` se deja pasar a propósito**: si está vacía,
  `reopen_matchday` la borra y sigue, que es exactamente el caso para el que se
  escribió.
- **Dos cosas del SQL que quedaron anotadas y NO se tocaron, porque son
  `0005_matchday_moves.sql` y este plan no toca migraciones aplicadas:**
  1. El mensaje de `0005:178` es falso cuando el bloqueante es una fecha **en
     juego**: dice "La fecha siguiente ya tiene datos cargados" y puede ser una
     fecha `OPEN`, no un borrador. Con el arreglo de arriba ya no se llega desde
     la pantalla, así que quedó de red de abajo.
  2. Ese mismo mensaje pide "Borrala vos", y **no existe ninguna forma de borrar
     una fecha en todo el producto** — ni pantalla, ni función en `db/`. Se sale
     por la base o no se sale.
- **`"Cerrar fecha · faltan 1 partidos"`, y el copy es así.** El handoff y la
  tabla de copys de la Task 10 dan la frase con `{n}` y no traen la versión en
  singular. **Es un hueco del plan: se reporta, no se inventa.** Arreglarlo pide
  un string nuevo ("falta 1 partido") que tiene que decidir alguien.
- **Un test de `close.db.test.ts` no protege lo que parece.** `'no cierra con
  partidos sin cargar'` (línea 338) usa `rejects.toThrow(/resultado/)`, y ese
  regex matchea **las dos capas**: el mensaje SQL (`Faltan resultados por
  cargar.`) y el de TypeScript (`Falta cargar el resultado de este partido.`).
  Como el chequeo de TS atrapa primero, ese test sobrevive intacto si se borra el
  guard de la base. El que sí protege es el de la línea 428, que llama a la RPC
  directa — verificado por mutación: sacando el guard de `close_matchday`, ése es
  **el único** de los 153 que se pone rojo.
- **Latente, y anotado para Ajustes (Task 11): con `tieBreak: false` la máquina
  no puede cargar un set que se fue a ventaja.** Siempre pone al ganador en
  `gamesPerSet` exacto, así que 10 de los 16 resultados legales entre 0 y 9
  —`5-3`, `6-4`, `7-5`…— no se pueden registrar. Hoy no muerde: el wizard no
  expone `tieBreak` y `defaultConfig` lo fija en `true`, así que toda temporada
  nace con tie-break. **Si Ajustes llega a exponerlo, la carga miente.**
- **`loserGamesOptions` no es `0..gamesPerSet - 1` siempre.** Con `tieBreak:
  false` hay que ganar por dos, así que el 4-3 de un set a 4 no cierra nada y
  `setError` lo rebota. La regla del plan vale para la config con tie-break, que
  es la única que hoy sabe producir la app (`defaultConfig` la fija en `true` y
  el wizard no la expone). La máquina se quedó con las dos ramas: todo lo que
  produce pasa `setError` en las dos configs.

### Lo que encontró el recorrido con navegador (Task 14)

El script recorre 1 a 9 y 12 y pasa entero. **Los pasos 10 y 11 —Ajustes y
Reglas sin login— no se pudieron correr: son las Tasks 11 y 12, que están en la
tanda B.** Quedaron adentro del script, salteados y anunciados en la salida.

Y encontró **un defecto real, del tipo que ningún test de este repo podía ver**:

- **La pareja que ganaba la fecha mostraba 0 puntos.** En la Tabla de la fecha
  cerrada, toda fila que contuviera al invitado imprimía `'0'` fijo. Con el
  invitado jugando con el primero de la tabla —que es lo que hace `orderPool`
  siempre—, la pareja campeona salía **3 ganados, +10 de games, 0 puntos**,
  abajo de otra con un partido ganado y 6. Y contradecía la nota que está dos
  líneas más abajo: *"El invitado no suma para el campeonato; su compañero sí."*
  Arreglado: la columna es "los puntos que se llevó cada jugador"
  (`ui-screens.md` §9), y el `??` que ya estaba resuelve el caso solo, porque
  `computeAwards` no le escribe award al invitado.
  **Los dos documentos no coinciden y esto es una decisión, no un olvido:** el
  handoff (§9c) dice literal "su fila lleva el chip Invitado y **0 puntos**".
  Manda `ui-screens.md`, porque el handoff manda sobre color, tipografía y
  copys, y acá lo que está en juego es **qué significa el número**. Además la
  lectura del handoff se contradice a sí misma dos líneas después.
  Es una pantalla del Plan 3, y estuvo rota desde entonces: **hasta este plan no
  había forma de jugar una fecha con invitado.**

Lo que se miró y estaba bien: el armado con sus tres pasos y todos sus copys, el
sorteo (`1° con último`: el invitado sale con Jugador 1), la carga en dos toques
con los botones `0/1/2/3` de `gamesPerSet`, el acordeón colapsando la ronda
completa, el pie con "Reabrir fecha", y las cuatro pestañas en claro y en oscuro.

### Lo que encontró el barrido de botones, pantalla por pantalla

Después de la Task 14 se recorrieron **las 13 pantallas de `ui-screens.md`
tocando cada botón y cada link**, con una temporada de tres fechas jugadas por la
UI. Cero errores de JS, cero 500, y todas responden 200 salvo Ajustes.

- **`/unirse/[token]` te tiraba a la landing de marketing si ya tenías asiento.**
  `page.tsx:48` hacía `redirect('/')`. El link de invitación se pega una vez en
  el grupo y se toca muchas: todo el que ya reclamó su lugar volvía a caer en la
  página de venta, logueado —y **quien organiza caía siempre**, porque nunca tuvo
  asiento que reclamar—. Es el mismo defecto que el Plan 3 arregló en `signIn`,
  sobreviviendo en el camino que nadie recorrió: la Task 5 arregló el destino de
  `claimSeat` (`actions.ts`) y este `redirect` de `page.tsx` no estaba en su
  alcance. **Arreglado**: va a `/torneo/{seasonId}`.
- **Dos botones vivos apuntan a una pantalla que no existe.** El ⚙ de la Tabla
  (`app/torneo/[id]/page.tsx:134`) y "Editar reglas"
  (`app/torneo/[id]/reglas/page.tsx:117`) linkean a `/torneo/[id]/ajustes`, que
  da **404**. Los ve sólo quien organiza, y el ⚙ está arriba a la derecha de la
  primera pantalla del torneo. Los arregla la Task 11; mientras no exista, son
  dos links muertos.
- **"Mejor dupla del torneo" lista once duplas, no una.** `ui-screens.md` §10
  pide "la pareja con mejor récord, con su marca". La pantalla pone la mejor
  primera y después **todas las demás ordenadas por fechas jugadas juntas, no por
  récord**, así que la segunda fila puede decir 0%. Es pantalla del Plan 3; no se
  tocó.
- **Plurales en singular:** `"jugaron 1 fechas"` (stats) y
  `"faltan 1 partidos"` (cierre). Los dos vienen de copys con `{n}` que no traen
  variante singular.

Lo que se verificó **calculando contra la base**, no mirando: las ocho filas de
movimiento de la tabla (J1 de 7° a 4° = ▲3, J7 y J8 ▼2, los tres de arriba
quietos), los puntos por fecha del perfil (F1 1 · F2 3 · F3 10), la efectividad
33% = 3 de 9 partidos, y los 18 partidos de tres fechas. El sorteo es
determinista: "Regenerar" devuelve las mismas parejas.

Y se tocaron sin encontrar nada: el sheet de desempate y sus ⓘ, las seis
secciones de Reglas, el acordeón de rondas, Reabrir → Cancelar y Reabrir → sí,
"+ Agregar jugador", "Sacar", las flechas de orden (la del primero está
correctamente deshabilitada), los steppers, "Usar los defaults", y el alta de un
jugador nuevo por el link de invitación de punta a punta.

### Lo que apareció ejecutando las Tasks 11 y 13

- **El Masters se armaba y no se podía abrir.** La Task 13 describe el `DRAFT`
  como "los 4 clasificados y un botón para generar", y ahí termina: `MastersDraft`
  no tenía "Confirmar fecha", así que la jornada se sorteaba y **el estado
  `OPEN` que la misma tarea pide construir era inalcanzable**. Apareció jugando
  una temporada entera por el navegador, no compilando. Se cerró con el copy que
  ya existe —"Confirmar fecha", de la Task 9— y con la acción que ya existe:
  `openMatchday` sabe desde la Task 4 que el Masters no tiene asistencias.
- **El Masters decía "Descansa esta ronda" y no descansa nadie.** El acordeón de
  rondas nombra la pareja libre, que es real en una fecha de 5 parejas. En el
  Masters las 6 "parejas" son las tres combinaciones de los mismos 4 jugadores y
  cada ronda juega una sola: las que no juegan son cuatro, y nombrar una es
  mentir. Se apaga esa línea cuando `kind === 'MASTERS'`.
- **El campeón del año no cuenta los partidos por su cuenta.** Los ganados por
  jugador salen de `computeStandings` —cada pareja del Masters juega una vez, así
  que sumar las tres parejas de alguien es su marca—, no de un segundo tally. Dos
  formas de decidir quién ganó un partido es el bug que ningún test agarra.
  **Los dos desenlaces del spec 2.7 se probaron en el navegador**: campeón limpio
  con 3 ganados (sin línea de desempate) y triple empate en 2 con uno en 0, donde
  aparece "Corta el ranking del año".
- **La Task 11 agregó `ajustes/copiar.tsx`**, que no está en su lista de
  archivos. "Copiar ›" necesita el portapapeles, o sea un componente cliente, y
  las otras tres piezas de la lista (`plantel`, `formato`, `reglas`) no son su
  casa. El nombre del torneo, en cambio, **no** necesitó componente: es un
  `<form>` con Server Action y el error vuelve por la query, igual que en
  `unirse/[token]`.
- **Ajustes no tiene copy de "Guardar", y no se inventó ninguna.** El plan no la
  trae. Se resolvió guardando solo: el formato a cada toque de `−`/`+` —
  `updateSeasonConfig` corre `assertValidConfig` antes de escribir, así que un
  intermedio inválido vuelve como error en línea y no se guarda— y las reglas al
  salir del campo, igual que el nombre del invitado.
- **`STEPPERS` se importa del wizard, el layout se duplica.** El plan prohíbe
  extraer el componente compartido y eso se respetó; pero los labels, las ayudas
  y los topes tienen que decir lo mismo en las dos pantallas, así que la
  constante se reusa en vez de copiarse.
- **La frase del desempate del Masters encadena "y".** El copy es
  `"{nombre} y {otros} ganaron {n} partidos cada uno."` y con el triple empate
  —el único caso posible— sale "A y B y C". Es el template textual; cambiarlo a
  "A, B y C" es un string nuevo que decide alguien.
- **Al reabrir una fecha, todas sus rondas arrancan colapsadas.** El acordeón
  colapsa la ronda completa, y una fecha reabierta las tiene todas completas —
  justo cuando entrás a corregir un resultado. Es un toque de más, no un
  bloqueo.

### El equipo invitado, y por qué la pantalla se queda corta

Es lo único que falta del producto, y está medido, no supuesto. Se cargaron dos
invitados a mano en la base, trabados como pareja, y **se jugó la fecha entera
desde la pantalla**:

| | |
|---|---|
| Sortea 5 parejas y **los dos invitados quedan juntos** | ✅ |
| La fecha abre, se cargan los 10 partidos y cierra | ✅ |
| **El equipo invitado no cobra un solo punto**, y los 8 del plantel sí | ✅ |

O sea: `core/` y `db/` hacen exactamente lo que hay que hacer —`computeAwards`
saltea la pareja que es toda de invitados y `assertPointsCoverMatchday` la
descuenta—. **Lo que falta es pantalla, y son cuatro cosas:**

1. **No hay forma de agregar un invitado ni un equipo.** Los únicos botones del
   armado son los del plantel y "Generar parejas". El invitado aparece **sólo**
   cuando el número da impar, y "unos amigos que vienen a jugar" es justamente
   el caso de número par.
2. **Con dos invitados, la pantalla dibuja uno.** `fechas/[n]/page.tsx` usa
   `.find()` sobre los `GUEST` de la fecha: el segundo no existe para la UI.
3. **El panel de conteo es ciego a los invitados.** Con dos adentro dice
   `"8 confirmados · La fecha es de 8 · 4 parejas"` y la fecha es de 10 con 5
   parejas. Es la misma raíz que el caso ya anotado de "par + invitado ya
   nombrado".
4. **"Juega con" no puede decir "con el otro invitado".** Sus opciones son sólo
   asientos del plantel, así que con la pareja trabada de verdad el selector
   muestra "El que toque" — miente sobre un dato que existe.

Backend: cero. `addGuest`, `removeGuest`, `nameGuest`, `lockPair` y `unlockPair`
ya están y ya están probadas contra la base.

### Lo que apareció ejecutando la Task 12

- **Era un defecto, no una función, y el diagnóstico del plan era exacto.** La
  rama sin sesión de Reglas ya estaba construida desde el Plan 3 y era
  inalcanzable porque el layout llamaba a `seasonHeader()` sin condición.
- **Lo importante era lo que NO se rompía.** Sacar esa guarda deja a las otras
  pantallas del torneo frenadas sólo por RLS. Probado desde un contexto sin una
  cookie: Tabla, Fechas, Stats y Ajustes no le muestran **nada** a un anónimo.
  Lo único que cambió es quién frena, como decía el plan.
- **El criterio de terminado se cumplió con un `<script>` de verdad.** Guardado
  en `rules_text` por psql, la página pública lo dibuja **como texto literal** y
  no dispara un solo error de JS.
- **Un anónimo que abría la Tabla veía un 500, no un login. Arreglado después de
  cerrar el plan** (fuera de las 14 tareas, decisión del dueño del producto).
  Lo que se veía era la página blanca de Next en inglés —"Application error: a
  server-side exception has occurred"— y el link de la Tabla es justo el que
  alguien pega en el grupo. Dos piezas:
  1. **`middleware.ts`**: sin sesión y en una ruta de torneo que no sea Reglas,
     redirige a `/login?next={ruta}`. Va ahí porque el middleware ya corre en
     todas las rutas y **ya tiene el usuario en la mano**; `loginDestination` ya
     respetaba `next`, así que después de entrar caés en el link que abriste.
     Dos cuidados que no se ven: **las cookies que `setAll` escribió viven en el
     `response`**, así que se copian al redirect o una sesión vencida queda
     reintentando sola; y el chequeo **ignora la barra final**, o un
     `/reglas/` pegado con barra mandaría al login una página pública.
  2. **`app/error.tsx`**, que no existía: cualquier error de cualquier pantalla
     mostraba esa misma página blanca. Ahora muestra la app en castellano con
     "Probar de nuevo" e "Ir al inicio". **No muestra `error.message`** —en
     producción Next ya lo redacta, y en el cliente es una traza— pero sí el
     `digest`, que es lo único con lo que se encuentra el error en los logs.
  **El riesgo real de agregar un error boundary era otro:** `redirect()` de Next
  tira una excepción interna, y un boundary que la agarre convierte cada
  redirect de la app en "Algo se rompió". Se recorrieron **los seis**: alta de
  cuenta, reclamo de asiento, no-admin en Ajustes, link de invitación ya
  reclamado, renombrar por Server Action, y el wizard sin sesión. Ninguno cae en
  el boundary. Probado contra `npm start`, no contra el dev server.

### La auditoría de diseño contra el handoff

Se auditó la app entera contra `docs/padel_design/README.md`, regla por regla.

**Estaba exacto:** los **34 tokens de color** (17 claro + 17 oscuro), hex por hex;
la tipografía Archivo; **cero sombras**; el tracking del kicker —en todo el
código existen **sólo** `.14em` y `.13em`, ningún otro valor—; los radios; y ni
un `alert`, `confirm` o toast.

**No estaba, y era el modo de falla que este plan tenía anotado:** las cuatro
pantallas de entrada del Plan 2 (`login`, `registro`, `unirse`, `recuperar`)
usaban **la escala redondeada de Tailwind** en vez de los valores del handoff —
`text-xs` (12px) donde pide 11.5, `text-sm` (14px) donde pide 12.5, `border`
(1px) donde pide 1.5, `p-4` (16px) donde pide 15. El Global Constraint decía
textual que *"una auditoría ya encontró"* esto en el Plan 2: se encontró, se
escribió la regla para que no se propagara —**y no se propagó, todas las
pantallas de los Planes 3 y 4 usan valores exactos**— pero esas cuatro nunca se
corrigieron. **Ahora sí: en toda la app no queda una sola medida de la escala
redondeada.**

Dos cosas que se dejaron como están, con motivo:

- **`wizard.tsx:345` usa `text-accent`**, que el handoff prohíbe como color de
  texto en oscuro. Su fondo es `accent-text` (claro), así que el verde oscuro
  encima es el contraste correcto: rompe la letra de la regla y no su motivo, que
  es la legibilidad sobre fondo oscuro.
- **Los `font-semibold` que quedan son peso 600**, que el handoff pide para
  meta/hint (11.5–12.5px). No son redondeos.

**Lo que NO se auditó:** no se comparó pixel a pixel contra los `.dc.html`. Se
verificaron las reglas que el handoff enuncia —tokens, tipografía, radios,
bordes, sombras, tracking, patrones de estado— y el texto de cada sección.

**Y un falso positivo que costó tiempo, para no volver a caer:** medir el borde
con `getComputedStyle` devuelve **`1px` para un `border-width: 1.5px`**, aun con
`deviceScaleFactor: 2`. Lo redondea el navegador al reportar, no la hoja de
estilos: un `div` con 1.5px **inline** reporta lo mismo. El CSS tiene la regla y
el elemento tiene la clase.

### Deuda que heredan las tareas que faltan

- ✅ **La Task 8 tenía que CREAR `app/torneo/[id]/actions.ts`, no modificarlo.**
  Ocurrió tal cual: el archivo lo creó la Task 8 y la Task 7 lo va a encontrar
  hecho.
- **La fecha `CLOSED` deja el botón de carga afuera, pero la `OPEN` lo pone
  también sobre los partidos ya cargados.** `saveResult` reemplaza, y un score
  tipeado mal de noche no tendría otro arreglo. El handoff no dice ni que sí ni
  que no.
- **`db/entries.ts` no tiene pantalla todavía.** Sus cuatro funciones están
  implementadas y probadas, y las consume Ajustes (Task 11, tanda B). Hasta
  entonces, un plantel cargado mal en el wizard **sólo se arregla por la base**.

### Cosas que se decidieron NO hacer

- **`createSeason` no valida los nombres vacíos del plantel en TypeScript.** Los
  rebota `entries_squad_named`, que es la misma regla escrita una sola vez y del
  lado que no se puede saltear; el borde sólo traduce ese error a
  `"Falta un nombre del plantel."`. Hacer las dos cosas dejaba el camino del
  rollback sin ninguna forma de ejercitarlo.
- **`mySeasons` no creció.** "Mi posición" y "próxima fecha" se componen en
  `app/torneos/page.tsx` con cuatro lecturas que ya existían. Son cuatro consultas
  por temporada, y está anotado con un `ponytail:` en el archivo: con las 1 a 3
  temporadas que tiene cualquiera de este grupo es gratis, con veinte hay que
  mirar. Una función de `db/` con forma de pantalla es lo que el Plan 3 aprendió
  a no hacer.

---

## Qué queda afuera de este plan, a propósito

- **El equipo invitado completo.** `pair_locks` y `addGuest` soportan varios
  invitados por fecha, y `assertLocksAndGuests` ya valida las combinaciones. La
  Task 9 administra **uno solo**: el que aparece cuando el número da impar. Un
  equipo invitado de dos se puede cargar por la base, no por pantalla.
- **Notificaciones y selector de tema en Ajustes.** Decisión registrada 6.
- **Cambiar contraseña y salir del torneo.** No tienen backend.
- **El arrastre del invitado en el orden.** Decisión registrada 2: no es
  implementable sobre el `core/` que existe, y `core/` no se toca acá.
- **Editar el nombre propio desde el Perfil.** `ui-screens.md` §12 lo pide para
  el perfil propio; `players` no tiene política de `update` (`0002_rls.sql:133`
  lo dice y explica por qué). Es una política nueva, o sea otra migración.
- **Reordenar el orden inicial después de creado el torneo.** Se escribe en el
  wizard y no se vuelve a tocar. Cambiarlo con fechas jugadas movería la cadena
  de snapshots hacia atrás.
- **Configurar Google OAuth.** Sigue siendo un checklist manual: necesita
  credenciales reales de Google Cloud y un bloque `[auth.external.google]` en
  `supabase/config.toml`. El botón está en pantalla y el callback funciona.
- **Los dos fixtures que le faltan a `core/standings`** (`3-1-1-1` y `2-2-1-1`) y
  el resto de la deuda conocida de `core/`. Está triageada en `docs/estado.md` y
  no la desbloquea ninguna pantalla de acá.

---

## Criterio de terminado

- [x] `npm test` en verde, sin tests saltados — **273**
- [x] `npm run test:db` en verde contra Supabase local, sin tests saltados — **153**
- [x] `npm run typecheck` sin errores
- [x] `npm run build` sin errores, **con el dev server apagado** y `.next` borrado
- [x] `core/` sigue puro: nada de `Date`, `Math.random`, `fetch` ni `process`, y
      ningún import fuera de `core/` — los únicos aciertos del `rg` son el
      docstring de `index.ts` que nombra esas palabras para prohibirlas
- [x] **`core/` no se tocó en todo el plan** — `git diff main --stat core/` vacío
- [x] Ningún componente `'use client'` importa de `db/server.ts`
- [x] Ninguna pantalla escribe sin pasar por `db/`
- [x] Ningún copy inventado. Los que este plan tuvo que decidir están marcados
      🆕 en su tarea; los que faltaban y **no** se inventaron están reportados en
      `Aparecidos`: el singular de `"faltan {n} partidos"` y el de
      `"jugaron {n} fechas"`, y el cancelar de la carga —resuelto haciendo que
      "Cargar resultado" sea su propio cancelar—
- [x] La página de Reglas se abre **sin sesión** en una ventana privada, y el
      markdown del admin sale escapado — probado con un `<script>alert(1)</script>`
      de verdad guardado en `rules_text`: sale como texto literal y no dispara un
      solo error de JS. Y las otras cuatro pantallas del torneo no le muestran
      **nada** a un anónimo
- [x] Una temporada completa de punta a punta: crearla, jugar sus fechas,
      cerrarlas, jugar el Masters, coronar al campeón del año — **recorrida con
      navegador, no deducida**, y con los dos desenlaces del spec 2.7
- [x] El recorrido de la Task 14 pasa entero, en claro y en oscuro
- [x] Las cuatro revisiones adversariales (Tasks 1, 3, 4 y 10) están hechas, y
      **cada mutación que se probó dejó al menos un test en rojo**. La de la
      Task 10 encontró dos defectos reales, los dos arreglados
- [x] La sección "Aparecidos" está revisada

**Lo que queda fuera de este criterio, a sabiendas:** el equipo invitado desde la
pantalla (arriba, con su medición), la Task 7 descartada por decisión de
producto, y la deuda chica de copys. Nada de eso impide jugar una temporada.
