# Piso y techo del plantel — el piso lo decide el deporte, el techo se va

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que dos amigos puedan armar un torneo de FIFA sin inventar seis jugadores de relleno, y que nadie tenga que pedir permiso para ser trece.

**Architecture:** `MIN_PLAYERS = 8` deja de ser un número y pasa a ser una función del deporte: **la gente que hace falta para que exista UN partido**. `MAX_PLAYERS = 12` se borra entero, incluida su copia adentro de `promote_guest`. Tres rebanadas, cada una con los cuatro gates en verde: primero `core/` gana la función nueva sin sacar nada, después los consumidores la usan, y recién al final se borra el techo y sale la migración.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5.7 strict, Supabase (RLS), Tailwind v4, vitest.

**Spec:** `docs/tipos-de-torneo.md` **§3.3** — el párrafo que difirió este cambio y dijo que "merece su propio cambio". Este plan es ese cambio. Quien ejecute lee los dos.

---

## Por qué, en las palabras del dueño del producto

> *"No deberíamos tener ni mínimo ni máximo, depende de las configuraciones."*

**Y tomada literal, esa regla no funciona — el techo sí, el piso no.**

Un plantel de 0 o 1 no es un torneo chiquito: no es nada. `buildSides` tira *"No se puede armar una fecha sin jugadores"* sobre un pool vacío, y con uno solo no hay contra quién jugar. El propio ejemplo del dueño —*"con 2 jugadores ya está"*— **es** un piso: 2, no 0.

Así que la regla honesta es: **el piso pasa a ser "la gente que hace falta para que exista un partido", derivada del tamaño de lado del deporte** — 2 cuando los lados son de a uno, 4 cuando son parejas. El techo, en cambio, se va del todo: no queda ninguna protección apoyada en él.

**Y el `MIN_PLAYERS = 8` de hoy es incoherente consigo mismo** (§3.3): prohíbe 6 —donde descansa uno— y permite 10, donde también descansa uno. Es una regla de 2v2 aplicada a todo.

---

## Lo medido — verificado contra el árbol el 02/09/2026, HEAD `1feafce`

Nada de esto es de memoria. Si algo de acá no coincide con lo que ves, **manda el código y hay que corregir el plan**.

### El techo no protege nada, y está probado

- **CPU (armado por fuerza bruta):** lo cuida `MAX_PAIRING_POOL` (`core/constants.ts:73`), que es un **literal `12` propio**, no `= MAX_PLAYERS`, con su propio tripwire. El docblock de arriba (`:67-71`) dice que valen lo mismo *"de casualidad"*. Y acota el POOL —presentes menos resueltos— que es una puerta más estricta y más correcta que la cabeza cruda del plantel.
- **Duración de la fecha:** ya lo hace `maxMatchesOf` / `defaultMaxMatches` (`core/constants.ts:45-59`), por disciplina, desde el 24/08.
- **Lados de a uno:** no hay explosión factorial que temer — la rama `sideSize=1` de `buildSides` es `orderPool(...).map(single)`, O(n log n).

### El Masters fija el piso de parejas, y da exactamente 4

Esto había que medirlo porque un error acá rompe torneos que ya existen:

- `core/masters.ts:9-11` compara `ranking.length < MASTERS_SIZE`.
- `RankingRow` es **una fila por miembro del plantel** (`core/ranking.ts:27-38`), así que `ranking.length === squad.length`. **`MASTERS_SIZE` cuenta JUGADORES, no lados.**
- `MASTERS_SIZE = 4` (`core/constants.ts:76`).
- `0053_disciplines_has_masters_needs_pair.sql:29-30` ya prohíbe `has_masters and pair_size = 1`.

**Entonces:** con parejas y Masters prendido, el plantel más chico que no lo rompe es **4** — exactamente el piso derivado. Con lados de a uno el Masters es inalcanzable por la constraint de `0053`. **No hace falta ninguna regla extra**, pero el piso derivado y `MASTERS_SIZE` quedan pegados: una tarea de este plan lo pinea con un test, porque el día que alguien toque la fórmula del piso, el Masters se rompe en silencio.

### La copia del techo en SQL, y por qué no hay riesgo en producción

- `if v_squad + 1 > 12` está en **exactamente cuatro** migraciones (`0032:162`, `0033:188`, `0048:199`, `0062:171`), las cuatro **adentro de `if v_pair_size = 1 then`**.
- La definición VIGENTE de `promote_guest` es la de **`0062_promote_guest_no_entries_seed.sql`**. Es la única que hay que reemplazar.
- **Producción corre `main`, que está antes de `0015`**, así que no existe ni una disciplina con `pair_size = 1` allá. Ese guard hoy es **código muerto en producción**. Riesgo de datos: cero. Igual necesita migración, porque `create or replace function` pide archivo nuevo.

### La trampa que el plan viejo no tenía en la lista

**No existe NINGUNA lógica de "máximo entre disciplinas" para extender.** Se buscó: cero resultados.

- `squadWarning` (`wizard-state.ts:191-206`) gatea contra las constantes planas y **no mira `pairSize` de ninguna disciplina**.
- `configSideSize` (`wizard-state.ts:438-443`) resuelve otro problema —la ambigüedad de la curva de puntos— y devuelve `2` fijo cuando hay más de una disciplina.

El plantel es **compartido** entre disciplinas y cada una elige su `pairSize`. Así que el piso de la pantalla del plantel es **el MÁXIMO de los pisos de las disciplinas elegidas**, y eso hay que escribirlo de cero. Es la Task 2.

---

## Global Constraints

- **TDD estricto.** El test que falla va primero y hay que **verlo fallar** por el motivo correcto.
- **Los cuatro gates, en cada tarea:** `npm test` · `npm run test:db` · `npm run typecheck` · `npm run build`. La tarea que toca SQL suma `npm run db:types` adelante.
- `db/test/env.ts` se niega a correr la suite de base si la URL no es local. **Nunca se puentea.**
- **Los tests que ejercitan permisos van por cliente autenticado**, nunca `adminClient()`.
- **Este cambio es ESTRICTAMENTE ENSANCHADOR.** `validateConfig` corre sólo al escribir config, nunca al leer, así que las dos temporadas vivas (las dos en `squadSize = 12`) no se tocan. Si una tarea le quita algo a alguien, está mal.
- **Un comentario que nombra un mecanismo tiene que nombrar uno VERIFICADO.** En la rebanada anterior este defecto apareció siete veces y cada uno costó una ronda de fix. Si no lo chequeaste, no lo afirmes.
- **Una aserción tiene que poder fallar.** Si borrás lo que el test dice cuidar y sigue verde, el test no cuida nada.
- Los comentarios explican **por qué**, no qué, ~1:1 con el código.
- `core/` es puro: no importa nada de afuera.
- Commits convencionales en castellano, **sin `Co-Authored-By` ni atribución de IA**.
- Fuera de alcance: un techo opcional configurable por disciplina (nadie lo pidió; YAGNI), y abrir `disciplines.kind` más allá de `PADEL`/`FIFA`.

---

## Estructura de archivos

| archivo | tarea | responsabilidad |
|---|---|---|
| `core/constants.ts` | 1, 3 | `minSquadFor`; y al final, borrar `MAX_PLAYERS` |
| `core/config.ts` | 1 | el piso derivado en `validateConfig`; semillas de puntos para 2 y 3 lados |
| `core/index.ts` | 1, 3 | exportar lo nuevo; corregir el doc stale de `:225` |
| `core/constants.test.ts` · `config.test.ts` · `knockout.test.ts` | 1, 3 | los tripwires |
| `db/validate.ts` | 2 | `assertMatchdaySize` con el piso del deporte |
| `db/season.ts` | 2 | **borrar** el `assertValidConfig(config, 2)` de `:266` |
| `app/torneos/nuevo/wizard-state.ts` | 2 | el **piso efectivo**: máximo entre disciplinas elegidas |
| `app/torneos/nuevo/wizard.tsx` | 2 | los tres usos + el copy |
| `app/torneo/[id]/[disciplina]/fechas/[n]/armado-state.ts` · `armado.tsx` | 2 | `tooFew`/`tooMany` y su copy |
| `supabase/migrations/0073_promote_guest_sin_techo.sql` | 3 | `create or replace` sin el guard de 12 |
| `core/narrate.ts` | 3 | la prosa deja de nombrar un techo que no existe |

---

### Task 1: `core/` aprende a derivar el piso, y todavía no saca nada

**Files:** modificar `core/constants.ts`, `core/config.ts`, `core/index.ts`, `core/constants.test.ts`, `core/config.test.ts`

**Interfaces:**
- Produce: `export function minSquadFor(sideSize: SideSize): number` en `core/constants.ts`, exportada por `core/index.ts`.
- `MAX_PLAYERS` **sigue existiendo y sigue gateando el techo.** No se toca en esta tarea.

**Por qué esta tarea no borra nada.** Si `core/` borrara `MAX_PLAYERS` acá, ocho lugares dejarían de compilar y los cuatro gates se pondrían rojos hasta la Task 3. Esta rebanada nace **ensanchando y nada más**, y por eso es la del revert más barato de las tres — mismo criterio que el encabezado de `0069`.

**La fórmula, y por qué es esa.** `minSquadFor(sideSize) = 2 * sideSize`: dos lados, un partido. Es la traducción literal de *"la gente que hace falta para que exista un partido"*. No la escondas en una constante derivada ni la generalices a "N lados": **hoy la respuesta es dos lados y no hay ningún caso de uso para otra cosa.**

- [ ] **Step 1: Correr `core/` ANTES de tocar nada y anotar el número.** Es el pin de que esto no rompe nada existente.

- [ ] **Step 2: El test que falla, primero**

En `core/constants.test.ts`, para `minSquadFor`: con lados de a uno da 2, con parejas da 4. Y **el test que amarra el Masters**, que es el que importa de verdad:

```typescript
it('el piso de parejas no puede quedar por debajo del Masters', () => {
  // MASTERS_SIZE cuenta JUGADORES (`ranking.length === squad.length`,
  // core/ranking.ts:27-38), y `0053` prohíbe Masters con lados de a uno.
  // Así que el piso de parejas es el único que puede romperlo.
  expect(minSquadFor(2)).toBeGreaterThanOrEqual(MASTERS_SIZE)
})
```

En `core/config.test.ts`: que `defaultConfig` con 2 y con 3 lados devuelva una curva de puntos **no vacía y del largo correcto**, porque hoy devuelve `[]` (`core/config.ts:75`) y eso hace fallar `pointsCountError`.

- [ ] **Step 3: Verlos fallar.** `npx vitest run core/` — `minSquadFor is not a function` y la curva vacía.

- [ ] **Step 4: Implementar**

`minSquadFor` en `core/constants.ts`, exportada por `core/index.ts`.

`validateConfig` (`core/config.ts:162`) cambia el piso plano por `minSquadFor(sideSize)`. **El techo de `:165` NO se toca.**

`DEFAULT_POINTS` (`core/config.ts:37-49`) suma dos claves:

```typescript
2: [10, 6],
3: [10, 6, 3],
```

> Son la cabeza de la curva de 4, que ya está puesta a dedo. **Es una semilla, no una regla**: el creador edita los puntos puesto por puesto en el wizard (`app/torneos/nuevo/wizard.tsx:311-325`) y después en ajustes (`app/torneo/[id]/ajustes/formato.tsx:103-113`). Lo único que tiene que respetar la semilla es `pointsErrors` (`core/config.ts:261-273`): el primero no puede ser 0, va de mayor a menor, y sólo el 0 se repite.

- [ ] **Step 5: Verificar.** Los tests nuevos en verde y **el número del Step 1 sin bajar**. Si un test viejo cambió de resultado, esta rebanada dejó de ser ensanchadora: volvé atrás.

- [ ] **Step 6: Pureza de `core/`.** `rg -n 'from .\.\./|from .@/' core/constants.ts core/config.ts core/index.ts` — sin resultados.

- [ ] **Step 7: Cuatro gates y commit** — `feat(core): el piso del plantel lo decide el deporte`

---

### Task 2: Los consumidores usan el piso derivado, y el plantel compartido aprende a elegir

**Files:** modificar `db/validate.ts`, `db/season.ts`, `app/torneos/nuevo/wizard-state.ts`, `app/torneos/nuevo/wizard.tsx`, `app/torneo/[id]/[disciplina]/fechas/[n]/armado-state.ts`, `armado.tsx`, y los tests de cada uno.

**Consume:** `minSquadFor` de `@/core` (Task 1).

**Lo que hay que entender antes de escribir:** `assertMatchdaySize` (`db/validate.ts:171-181`) y `validateConfig` gatean **cosas distintas** — la primera cuenta los presentes de UNA fecha, la segunda el `squadSize` de la config de la temporada. Las dos usan el piso, ninguna es la otra.

#### El piso efectivo, que es lo nuevo de verdad

El plantel es **uno solo y compartido**, y cada disciplina elige su `pairSize`. Un torneo con pádel (parejas, piso 4) y FIFA (de a uno, piso 2) necesita **4**: el máximo, no el mínimo ni el de la primera.

Esa función **no existe** y hay que escribirla. `squadWarning` (`wizard-state.ts:191-206`) hoy no mira `pairSize` de nadie, y `configSideSize` (`:438-443`) resuelve otro problema —la curva de puntos— devolviendo `2` fijo cuando hay más de una disciplina. **No la reuses para esto: contesta otra pregunta.**

- [ ] **Step 1: Los tests que fallan, primero.** El más importante:

```typescript
it('con pádel y FIFA juntos, manda el piso más alto', () => {
  // El plantel es compartido: si FIFA se conforma con 2 y el pádel necesita 4,
  // el plantel necesita 4. Elegir el mínimo dejaría armar un torneo cuyo pádel
  // no puede jugar una sola fecha.
  expect(pisoEfectivo([1, 2])).toBe(4)
  expect(pisoEfectivo([1])).toBe(2)
})
```

Más: `assertMatchdaySize` deja pasar una fecha de 2 presentes en una disciplina de a uno y **sigue rechazando 1**; `matchdayShape.tooFew` respeta el deporte; y el copy de `armado.tsx:624` deja de decir un número fijo.

- [ ] **Step 2: Verlos fallar.** Por el motivo correcto: la función no existe / el piso sigue siendo 8.

- [ ] **Step 3: Implementar.** Los cinco consumidores pasan a `minSquadFor`, y la pantalla del plantel al piso efectivo.

**Y borrá `db/season.ts:266`** — el `assertValidConfig(config, 2)`. El comentario de arriba (`:262-265`) ya admite que `seasons.config` **no tiene lectores desde el PR 5** y que el `drop column` está en el contrato. Esa línea valida una columna muerta con el tamaño de lado **hardcodeado en 2**, y es lo que rechazaría un torneo de dos amigos al FIFA aunque todo lo demás esté bien. No la arregles: borrala, y dejá dicho en el commit por qué era segura de borrar.

- [ ] **Step 4: Verificar en verde.**

- [ ] **Step 5: Los cuatro gates.**

- [ ] **Step 6: Verlo en el navegador.** `npm run dev` (puede tomar otro puerto — leé su salida). Armá un torneo de **FIFA con 2 jugadores** y confirmá que el wizard te deja pasar el paso del plantel, que la temporada se crea, y que podés abrir y jugar una fecha. **Cruzá contra `psql`**, no contra lo que esperabas. Después probá uno con pádel Y FIFA y confirmá que te pide 4, no 2. Bajá el server.

- [ ] **Step 7: Commit** — `feat(torneo): el plantel mínimo sale del deporte, no de un número fijo`

---

### Task 3: El techo se va, del código y de la base

**Files:** modificar `core/constants.ts`, `core/index.ts`, `core/narrate.ts`, `core/constants.test.ts`, `core/knockout.test.ts`, `app/torneos/nuevo/wizard-state.ts`, `wizard.tsx`, `armado-state.ts`, `armado.tsx`; crear `supabase/migrations/0073_promote_guest_sin_techo.sql`.

**El compilador es tu inventario.** Borrá `MAX_PLAYERS` de `core/constants.ts` y la lista de errores **es** la lista de lo que hay que tocar. No la adivines de antemano.

**Los tres tripwires que van a romper, y qué hacer con cada uno:**

| test | qué pasa | qué hacer |
|---|---|---|
| `core/constants.test.ts:7-8` | pinea 8 y 12 | reescribir para pinear `minSquadFor`, no el techo |
| `core/constants.test.ts:17-18` | asierta `MAX_PAIRING_POOL === MAX_PLAYERS` | **darle su propio literal.** Acoplaba una constante de CPU al techo de producto "por coincidencia documentada"; esa coincidencia se termina acá |
| `core/knockout.test.ts:646` | itera `MIN_PLAYERS..MAX_PLAYERS` | acotar por el deporte, no por el techo |

**Comentarios que quedan mintiendo** (verificados, no supuestos): `core/index.ts:225` dice que `allMatchings` *"throws above MAX_PLAYERS"* y en realidad lo tira `MAX_PAIRING_POOL`. Y los comentarios de `db/validate.unit.test.ts:47,477`, `core/config.test.ts:28`, `db/discipline.db.test.ts:554`, `db/matchday-format.db.test.ts:348,385`, `db/fixed-teams.db.test.ts:273`, `db/friends.db.test.ts:42` citan los números viejos. **Ninguno rompe la compilación: por eso hay que buscarlos a propósito.** `rg -n 'MIN_PLAYERS|MAX_PLAYERS'` cuando termines tiene que volver limpio.

`core/narrate.ts:120` **no es una frase hardcodeada** —es un template que interpola las dos constantes— así que el compilador te la va a marcar sola. La prosa nueva no nombra un techo que ya no existe.

#### La migración

- [ ] **Step 1: El test que falla, primero.** Por **cliente autenticado**, jamás `adminClient()`: con una disciplina de `pair_size = 1` y un plantel en 12, sumar un invitado número 13 **funciona**. Hoy eso explota con *"El plantel ya está en el máximo de 12"*.

- [ ] **Step 2: Verlo fallar** con ese mensaje exacto. Si falla con otro, no estás probando lo que creés.

- [ ] **Step 3: Escribir `0073`.** `create or replace function public.promote_guest` **copiando la definición vigente de `0062`** —es la última que la redefine— y sacando **sólo** el bloque del guard (`0062:156-173`, la parte del `if v_squad + 1 > 12`). Todo lo demás queda igual.

> El encabezado explica **por qué**, en el registro de la casa: que el techo dejó de proteger nada cuando ese trabajo pasó a `config.maxMatches` el 24/08, que el guard estaba **duplicado** entre el código y el SQL, y que en producción hoy es **código muerto** porque `main` está antes de `0015` y no existe una sola disciplina con `pair_size = 1`.

- [ ] **Step 4: `npm run db:reset` y ver el test en verde.**

- [ ] **Step 5: Buscar las otras tres copias.** `rg -n 'v_squad \+ 1 > 12' supabase/migrations/` va a seguir mostrando `0032`, `0033` y `0048`. **Están bien y no se tocan**: las migraciones son append-only y ésas ya corrieron. La única que manda es la última.

- [ ] **Step 6: `rg -n 'MIN_PLAYERS|MAX_PLAYERS'` en todo el repo.** Sólo puede quedar `MIN_PLAYERS` si decidiste conservarlo como nombre; `MAX_PLAYERS` no puede aparecer en ningún lado, ni en un comentario.

- [ ] **Step 7: Cinco gates** — `npm run db:types && npm test && npm run test:db && npm run typecheck && npm run build`.

- [ ] **Step 8: Navegador.** Un torneo de 13 jugadores, creado y con una fecha jugada. Cruzado contra `psql`.

- [ ] **Step 9: Commit** — `feat(torneo): se va el techo de 12, del código y de promote_guest`

---

## Lo que este plan NO hace

- **No agrega un techo opcional por disciplina.** Se consideró (`config.maxPlayers?`, espejo de `maxMatches`) y se descarta: **nadie lo pidió nunca**. Si algún día un grupo quiere tapar su tamaño por razones que no son ni CPU ni duración, ahí se agrega con su caso de uso adelante.
- **No toca las tres migraciones viejas** que tienen la copia del guard. Append-only.
- **No toca `season_public_rules`**, viva en producción.
- **No abre `disciplines.kind`.**
- **No decide las curvas de puntos de nadie**: siembra dos y el creador las edita.
