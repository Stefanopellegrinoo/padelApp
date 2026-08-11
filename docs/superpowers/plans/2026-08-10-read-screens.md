# Plan 3 — pantallas de lectura

> **Para quien lo ejecute:** una tarea por vez, en orden. Una tarea termina cuando
> sus tests pasan y `npm run build` compila, no cuando la pantalla "quedaría más
> completa si además…".

**Goal:** que un jugador pueda entrar al torneo y ver todo lo que pasó: la tabla,
las fechas, las estadísticas, las reglas y el perfil de cualquiera.

**Architecture:** tres capas, en este orden. Primero las funciones puras que
faltan en `core/` (racha, movimiento, agregados por jugador). Después la capa de
lectura en `db/`, que hoy **no existe**: `db/` sólo tiene escrituras y
constructores de contexto para mutaciones, ni una función que una pantalla pueda
llamar. Recién después las pantallas, que son composición.

**Tech Stack:** Next.js 15 (App Router, Server Components por defecto), React 19,
Tailwind v4 con los tokens del handoff, Supabase con RLS ya puesta.

---

## Este plan es liviano, a propósito

Los planes 1 y 2 llevaban la implementación completa de cada módulo adentro. Eso
servía para que nadie improvisara reglas del campeonato. Acá el dominio ya está
resuelto y probado en `core/` y `db/`, y estas pantallas sólo leen.

Entonces: **bloques de código completos sólo donde hay lógica nueva** (Tasks 1 a
3, y el sanitizado de la Task 10). Las pantallas van con archivos, contrato,
copys textuales y "qué NO hace". El JSX lo escribe quien implementa.

Lo que **no** se aflojó: los copys son contractuales, la verificación incluye
`build`, y "qué NO hace esta tarea" es tan vinculante como el resto.

---

## Global Constraints

- **Los copys NO se inventan.** Salen textuales de `docs/padel_design/README.md`.
  Inventar copy es un modo de falla conocido de este repo: la Task 1 del Plan 2 ya
  tuvo que arreglarse por eso (`375ac76`). Cada tarea lista los suyos.
- **Los tokens de color se llaman `--color-*`** en `app/globals.css` (convención
  de Tailwind v4), aunque el handoff los nombre `--bg`, `--surface`, etc. Están
  los quince, en claro y en oscuro.
- **En oscuro `--color-accent` es fondo de bloque, nunca color de texto.** Para
  texto e íconos activos va `--color-accent-link`.
- **Sin sombras en toda la UI.** Lo dice el handoff y no tiene excepción.
- **Nav de 4: `Tabla · Fechas · Stats · Reglas`.** El label es `"Stats"` (handoff);
  el título de esa pantalla es `"Estadísticas"` (`ui-screens.md`). Los dos docs
  difieren y así se resuelve.
- **Los dos docs numeran distinto.** En `ui-screens.md` Reglas es §11 y Perfil
  §12; en el handoff están al revés. **Citalos por nombre, nunca por número.**
- **Server Components por defecto.** `'use client'` sólo donde hay interacción
  real (sheet, acordeón, toggle de asistencia).
- **Un componente `'use client'` NUNCA importa de `db/server.ts`.** Arrastra
  `next/headers` y rompe el build sin que `tsc` ni los tests se enteren. Es
  exactamente la rotura que costó el commit `8c6ffd6` del Plan 2.
- **`npm run build` en cada tarea.** El Plan 2 no lo corría en ninguna de sus 14
  verificaciones y se le pasaron dos roturas de producción con todo en verde.
- **Nombres de tests en inglés.** Copy de UI, mensajes de error y comentarios SQL
  en español.
- **`adminClient()` saltea RLS: arma la escena, nunca asierta.**
- **Nada de librerías nuevas** de componentes, formularios, estado o gráficos. Las
  barras de Estadísticas son `div`s con `width: %`.

---

## Estructura de archivos

```
core/
  streak.ts          Task 1   racha de títulos por jugador
  movement.ts        Task 2   posición y movimiento contra la fecha anterior
  playerstats.ts     Task 3   agregados por jugador: efectividad, duplas, presentismo
db/
  read.ts            Task 4   TODA la capa de lectura (hoy no existe nada)
app/
  torneo/[id]/
    layout.tsx       Task 5   shell + nav de 4
    page.tsx         Task 6   Tabla (home)
    desempate.tsx    Task 6   sheet de orden de desempate ('use client')
    fechas/
      page.tsx       Task 7   lista de fechas
      [n]/page.tsx   Task 8   detalle de una fecha (lectura)
      [n]/rondas.tsx Task 8   acordeón de rondas ('use client')
    stats/page.tsx   Task 9   Estadísticas
    reglas/page.tsx  Task 10  Reglas + sanitizado del markdown
    jugador/[entryId]/page.tsx  Task 11  Perfil
```

---

## Decisión registrada: qué cuenta como racha

**El spec no la define.** `§2.4` sólo dice que "la racha de defensas se guarda
como estadística, no como puntos". No hay fórmula en ningún lado.

**Y no puede ser de la pareja.** La regla del tope (`§2.5`) dice que la pareja
campeona juega exactamente 2 fechas juntas y después se separa, gane o pierda. O
sea que una pareja defiende **como máximo una vez**: una "racha" de 0 o 1 no es
una estadística, es un booleano.

**Decisión: la racha es por jugador, y cuenta fechas consecutivas ganadas.** Un
jugador puede encadenar aunque cambie de compañero: gana la fecha 1 con A,
defiende y gana la 2, se separa por regla, y gana la 3 con B. Eso da racha 3.

Lo que la sostiene: el handoff dibuja la tarjeta `"Racha más larga (Marce · 7)"`.
Un 7 sólo existe si se cuentan títulos consecutivos de un jugador — con parejas
el techo es 2.

Sub-decisiones, todas por la lectura más simple:

- **Falta a una fecha → se corta.** Si no jugaste no ganaste, y no ganar corta.
- **Sólo cuentan fechas `CLOSED`**, que son las únicas con `awards`.
- **El Masters no cuenta.** No escribe `awards` (decisión del Plan 2), así que
  queda afuera solo.

**Alternativa disponible:** contar *defensas* en vez de *títulos*, o sea ganar la
fecha inmediatamente posterior a una ganada. Da siempre `títulos − 1` por tramo y
hace que ganar una sola fecha valga 0. Se descartó porque el handoff muestra un 7
y porque "ganó 3 seguidas" se explica solo.

---

### Task 1: `core/streak.ts` — la racha de títulos

**Files:**
- Create: `core/streak.ts`
- Test: `core/streak.test.ts`
- Modify: `core/index.ts`

**Interfaces:**
- Consumes: `Award`, `EntryId` de `core/types.ts`
- Produces:
  ```typescript
  interface Streak { entryId: EntryId; longest: number; current: number }
  function titleStreaks(
    awardsByMatchday: Map<number, Award[]>,
    squad: readonly EntryId[],
  ): Streak[]
  ```

**Qué NO hace esta tarea:** no lee de la base, no formatea nada para pantalla, no
decide quién se muestra primero, no toca `computeRanking`.

- [ ] **Step 1: Escribir los tests que fallan**

Create `core/streak.test.ts`. Cubrir, como mínimo:

- un jugador que gana las fechas 1, 2 y 3 → `longest: 3`, `current: 3`
- un jugador que gana 1 y 2, pierde la 3, gana la 4 → `longest: 2`, `current: 1`
- un jugador que nunca ganó → `longest: 0`, `current: 0`
- un jugador que faltó a la fecha del medio de una racha → se corta
- **el orden de las fechas no depende del orden del `Map`** — construir el mapa
  con las claves desordenadas (3, 1, 2) y asertar el mismo resultado que
  ordenado. Es el error más fácil de cometer acá y ningún test lo agarra solo
- un jugador del plantel que no aparece en ningún `award` igual sale en el
  resultado, en cero
- huecos de numeración (fechas 1, 2 y 5 cerradas) **no** cortan la racha si ganó
  las tres: se recorren las fechas que existen, no `1..n`

**Expected: FAIL** — el módulo no existe.

- [ ] **Step 2: `core/streak.ts`**

```typescript
import type { Award, EntryId } from './types'

/** How many matchdays in a row a player has finished champion. */
export interface Streak {
  entryId: EntryId
  /** The longest run of the whole season. */
  longest: number
  /** The run still open at the last closed matchday. Zero if it is broken. */
  current: number
}

/**
 * The title streak, per player.
 *
 * It is per PLAYER and not per pair on purpose: a champion pair plays exactly
 * two matchdays together and then splits (spec 2.5), so a pair can defend at
 * most once and its "streak" would only ever be 0 or 1. A player, on the other
 * hand, can keep winning with a different partner each time.
 *
 * Missing a matchday breaks the run: if you did not play you did not win.
 * Only closed matchdays carry awards, so only they can appear in the map.
 */
export function titleStreaks(
  awardsByMatchday: Map<number, Award[]>,
  squad: readonly EntryId[],
): Streak[] {
  // Se ordena por número de fecha y no por orden de inserción: un Map conserva
  // el orden en que le metieron las claves, y quien lo arme desde la base no
  // tiene por qué haberlas puesto en orden.
  const numbers = [...awardsByMatchday.keys()].sort((left, right) => left - right)

  const championsOf = (number: number): Set<EntryId> =>
    new Set(
      (awardsByMatchday.get(number) ?? [])
        .filter((award) => award.position === 1)
        .map((award) => award.entryId),
    )
  const champions = numbers.map(championsOf)

  return squad.map((entryId) => {
    let longest = 0
    let run = 0
    for (const winners of champions) {
      run = winners.has(entryId) ? run + 1 : 0
      if (run > longest) longest = run
    }
    return { entryId, longest, current: run }
  })
}
```

- [ ] **Step 3: `core/index.ts`**

```typescript
// ── La racha de títulos ──────────────────────────────────────────────────────
// Por jugador y no por pareja: una pareja campeona juega exactamente 2 fechas
// juntas (spec 2.5), así que su racha sería siempre 0 o 1.
export type { Streak } from './streak'
export { titleStreaks } from './streak'
```

- [ ] **Step 4: Verificar y commitear**

```bash
npm run typecheck && npm test && npm run build
git add core/streak.ts core/streak.test.ts core/index.ts
git commit -m "feat: count each player's run of consecutive titles"
```

---

### Task 2: `core/movement.ts` — posición y movimiento

**Files:**
- Create: `core/movement.ts`
- Test: `core/movement.test.ts`
- Modify: `core/index.ts`

**Interfaces:**
- Consumes: `RankingRow`, `EntryId`, `SeasonConfig`, `Award` de `core/`; `computeRanking`
- Produces:
  ```typescript
  interface RankedRow extends RankingRow { position: number; movement: number | null }
  function rankingWithMovement(
    awardsByMatchday: Map<number, Award[]>,
    squad: readonly EntryId[],
    config: SeasonConfig,
    snapshot: readonly EntryId[],
  ): RankedRow[]
  ```

**Qué NO hace esta tarea:** no cambia `computeRanking` ni `RankingRow`, no
formatea las flechas (`▲2` es de la pantalla), no guarda posiciones históricas en
ninguna tabla — el movimiento se **deriva** recomputando el ranking sin la última
fecha, igual que todo lo demás en este proyecto.

**Por qué se deriva y no se guarda.** Guardar la posición de cada fecha sería
estado duplicado que se desincroniza la primera vez que alguien reabre una fecha.
`computeRanking` es barato y determinista: correrlo dos veces cuesta nada.

- [ ] **Step 1: Escribir los tests que fallan**

Create `core/movement.test.ts`. Cubrir:

- `position` arranca en 1 y es correlativa, en el orden que devuelve `computeRanking`
- con una sola fecha cerrada, `movement` es `null` para todos (no hay contra qué
  comparar) — **`null`, no `0`**: "sin dato" y "no se movió" son cosas distintas
  y la pantalla las dibuja distinto (`—` sólo para el `0`)
- alguien que sube dos puestos da `movement: 2`; alguien que baja uno, `-1`
- alguien que no se movió da `0`
- un jugador que no estaba en el ranking anterior da `movement: null`
- **el descarte de mejores-N mueve la tabla**: con `countBestOf` alcanzado, cerrar
  una fecha puede cambiar posiciones sin que nadie sume. Un fixture que lo
  ejercite (es el caso que la Task 14 del Plan 2 probó contra la base)

**Expected: FAIL** — el módulo no existe.

- [ ] **Step 2: `core/movement.ts`**

Implementación: correr `computeRanking` con el mapa completo, y otra vez con el
mapa sin la fecha de número más alto. Indexar la segunda por `entryId → posición`
y restar. Si el mapa tiene una sola fecha —o ninguna—, `movement` es `null` para
todos.

```typescript
const previous = new Map(awardsByMatchday)
previous.delete(Math.max(...awardsByMatchday.keys()))
```

Cuidado con `Math.max()` sobre un mapa vacío: devuelve `-Infinity`. Cortá antes.

- [ ] **Step 3: `core/index.ts`, verificar y commitear**

```bash
npm run typecheck && npm test && npm run build
git add core/movement.ts core/movement.test.ts core/index.ts
git commit -m "feat: rank the squad with its movement against the previous matchday"
```

---

### Task 3: `core/playerstats.ts` — los agregados por jugador

**Files:**
- Create: `core/playerstats.ts`
- Test: `core/playerstats.test.ts`
- Modify: `core/index.ts`

**Interfaces:**
- Consumes: `Pair`, `MatchResult`, `EntryId`, `SetScore`
- Produces:
  ```typescript
  interface PlayedMatchday { number: number; pairs: Pair[]; matches: MatchResult[] }
  interface PartnerRecord { entryId: EntryId; partner: EntryId; together: number; won: number; lost: number }
  interface PlayerTally {
    entryId: EntryId
    matchesPlayed: number
    matchesWon: number
    gamesFor: number
    gamesAgainst: number
    matchdaysPlayed: number
  }
  function tallyPlayers(history: readonly PlayedMatchday[], squad: readonly EntryId[]): PlayerTally[]
  function partnerRecords(history: readonly PlayedMatchday[]): PartnerRecord[]
  function bestPair(history: readonly PlayedMatchday[]): PartnerRecord | null
  ```

**Qué NO hace esta tarea:** no calcula porcentajes (`matchesWon / matchesPlayed`
es de la pantalla, y evita decidir acá qué pasa con dividir por cero), no lee
asistencias de la base, no ordena para mostrar, no toca `computeStandings`.

**El presentismo sale de acá.** `matchdaysPlayed` cuenta en cuántas fechas el
jugador aparece en alguna pareja. Las ausencias son `fechas cerradas −
matchdaysPlayed`, y esa resta la hace la pantalla.

- [ ] **Step 1: Escribir los tests que fallan**

Cubrir, como mínimo:

- un jugador que jugó 3 partidos y ganó 2 → `matchesPlayed: 3, matchesWon: 2`
- los games se cuentan desde la perspectiva del jugador: si su pareja fue `pairB`,
  `gamesFor` son los `gamesB`. **Un fixture donde el jugador esté de los dos
  lados en fechas distintas**, o el error de lado pasa desapercibido
- un invitado aparece en el tally si jugó (no suma puntos, pero jugó partidos)
- `partnerRecords` es simétrico: si A jugó con B, hay fila para los dos
- una pareja que jugó 2 fechas juntas (la campeona defensora) sale con
  `together: 2`
- `bestPair` con empate en victorias: definir el criterio en el test y que el
  código lo cumpla, no al revés
- `bestPair` de una historia vacía es `null`

**Expected: FAIL**

- [ ] **Step 2, 3: implementar, exportar, verificar y commitear**

```bash
npm run typecheck && npm test && npm run build
git add core/playerstats.ts core/playerstats.test.ts core/index.ts
git commit -m "feat: tally matches, games and partners per player"
```

---

### Task 4: `db/read.ts` — la capa de lectura

**Files:**
- Create: `db/read.ts`
- Test: `db/read.db.test.ts`

**Interfaces:**
- Consumes: `Client` de `db/client.ts`; los tipos de `core/`
- Produces (todas toman `supabase: Client` primero):
  ```typescript
  interface SeasonHeader { id: string; name: string; status: string; regularMatchdays: number; isAdmin: boolean }
  interface EntryRow { id: string; displayName: string; kind: 'SQUAD' | 'GUEST'; seedPosition: number; playerId: string | null }
  interface MatchdaySummary { id: string; number: number; kind: 'REGULAR' | 'MASTERS'; status: 'DRAFT' | 'OPEN' | 'CLOSED'; playedOn: string | null }
  interface MatchdayDetail { matchday: MatchdaySummary; pairs: Pair[]; matches: MatchResult[]; guestIds: EntryId[] }

  function mySeasons(supabase): Promise<SeasonHeader[]>
  function seasonHeader(supabase, seasonId): Promise<SeasonHeader>
  function seasonRules(supabase, seasonId): Promise<{ text: string; updatedAt: string | null }>
  function entriesOf(supabase, seasonId): Promise<EntryRow[]>
  function matchdaysOf(supabase, seasonId): Promise<MatchdaySummary[]>
  function matchdayDetail(supabase, matchdayId): Promise<MatchdayDetail>
  function closedHistoryAll(supabase, seasonId): Promise<PlayedMatchday[]>
  function awardsOf(supabase, seasonId): Promise<Map<number, Award[]>>
  ```

**Qué NO hace esta tarea:** no escribe nada, no calcula nada del campeonato —
todo lo que sea cuenta va a `core/`—, no arma componentes, no agrega políticas de
RLS, no crea migraciones.

**Esta es la tarea que desbloquea todo el plan.** Hoy `db/` no tiene una sola
función que una pantalla pueda llamar: `matchday.ts` exporta escrituras y
constructores de contexto para mutaciones, y todo lo que tiene forma de lectura
—`resultsOf`, `guestsOf`, `locksOf`, `playingEntryIds`— es **privado del módulo**.
No los hagas públicos a mano: escribí las de acá, con su forma de lectura, y dejá
las privadas donde están.

**`isAdmin` sale de `seasons.created_by === auth.uid()`,** no de intentar una
escritura y ver si falla.

**Ojo con el nombre `MatchdayRow`: ya existe.** `db/matchday.ts:32` lo tiene como
alias privado de la fila cruda de la base (snake_case, generada por Supabase).
Por eso el tipo de lectura de acá se llama `MatchdaySummary` y no `MatchdayRow`:
son dos formas distintas y tenerlas con el mismo nombre en el mismo directorio es
pedirle a alguien que confunda una por la otra.

- [ ] **Step 1: Escribir los tests que fallan**

Create `db/read.db.test.ts`, con los andamios de `db/test/`. Cubrir:

- `mySeasons` devuelve la temporada donde tengo asiento, y **no** la de otro grupo
- `seasonHeader` marca `isAdmin: true` para quien la creó y `false` para un jugador
- `entriesOf` trae plantel e invitados, con `playerId` en `null` si nadie reclamó
- `matchdaysOf` viene **ordenado por número**, y el Masters aparece con su `kind`
- `matchdayDetail` de una fecha cerrada trae parejas, partidos y sets completos
- `matchdayDetail` de una fecha `DRAFT` trae `pairs: []` sin explotar
- `closedHistoryAll` **excluye** las fechas no cerradas y el Masters
- `awardsOf` devuelve un mapa indexado por número de fecha
- **un extraño no lee nada de ninguna de las ocho** — RLS ya lo garantiza, pero
  una función que use el cliente equivocado lo saltea sin que nadie lo note

**Expected: FAIL**

- [ ] **Steps 2-3: implementar y verificar**

```bash
npm run typecheck && npm test && npm run db:reset && npm run test:db && npm run build
git add db/read.ts db/read.db.test.ts
git commit -m "feat: add the read layer the screens need"
```

---

### Task 5: El shell del torneo y la nav de 4

**Files:**
- Create: `app/torneo/[id]/layout.tsx`, `app/torneo/[id]/nav.tsx`
- Modify: `app/globals.css` (agregar `--scrim`)

**Interfaces:**
- Consumes: `seasonHeader` de `db/read.ts`
- Produces: el layout que envuelve a las Tasks 6 a 11, con la nav fija

**Qué NO hace esta tarea:** no dibuja ninguna de las pantallas, no arma la
pantalla de Ajustes (Plan 4), no arma "Mis torneos" (Plan 4), no agrega
breadcrumbs ni menús que el handoff no tenga.

**`--scrim` falta en `app/globals.css`.** Lo necesita el sheet de la Task 6 y
cualquier diálogo posterior. Agregalo al bloque `@theme`, en claro y en oscuro.

**Copys contractuales:** los cuatro labels de la nav son exactamente
`"Tabla"`, `"Fechas"`, `"Stats"`, `"Reglas"`.

**Medidas del handoff:** nav con `border-top: 1px` `line`, padding
`12px 22px 24px`, íconos de 19px con borde de 2px `currentColor`, label
`9.5px/800`. Padding lateral del contenido 20px, inferior 24px.

- [ ] **Step 1: El layout, la nav y el token**
- [ ] **Step 2: Verificar**

```bash
npm run typecheck && npm run build
git add app/torneo app/globals.css
git commit -m "feat: wrap the tournament screens in their shell and four-tab nav"
```

---

### Task 6: Tabla — la home del torneo

**Files:**
- Create: `app/torneo/[id]/page.tsx`, `app/torneo/[id]/desempate.tsx`

**Interfaces:**
- Consumes: `seasonHeader`, `entriesOf`, `matchdaysOf`, `awardsOf` de `db/read.ts`;
  `rankingWithMovement` (Task 2), `snapshotForMatchday` de `core/`
- Produces: nada que consuma otra tarea

**Qué NO hace esta tarea:** **no** implementa el toggle "No voy" —es una escritura
y va en el Plan 4—; el bloque de próxima fecha se dibuja en modo lectura. No abre
fechas. No arma Ajustes: el `⚙` linkea y nada más.

**El sheet es un sheet, no una página.** `ui-screens.md` explica por qué: es un
snapshot viejo, que se refresca cada 3 fechas, y como página competiría con la
tabla viva por ser "el ranking de verdad".

**Copys contractuales, textuales:**

| Dónde | Texto |
|---|---|
| Kicker del header | `"Fecha 6 de 12 · en curso"` |
| Kicker de la tarjeta | `"Próxima fecha"` |
| Estado propio | `"Estás anotado"` |
| Defensores | `"Ganaron la fecha 6 · les queda 1 defensa"` |
| Chip | `"Repiten"` |
| Sección | `"Tabla general"` |
| Botón | `"Orden de desempate ⇅"` |
| Movimiento | `"▲2"` · `"▼1"` · `"—"` |
| Corte | `"Clasifican al Masters"` |
| Sheet, kicker/título | `"Orden de desempate"` / `"Quién va antes"` |
| Sheet, explicación | `"Es la tabla al cierre de la fecha 3. Se actualiza cada 3 fechas: el próximo refresco es al cerrar la fecha 9. Corta los empates de puntos y de ahí salen las parejas de cada fecha."` |
| Sheet, botón | `"Entendido"` |

Los números de esas frases se calculan desde la config (`tiebreakSnapshotEvery`),
no se hardcodean.

**El chip `ⓘ` aparece sólo en filas empatadas en puntos.** Y `movement: null` se
dibuja vacío, no como `"—"`: `—` significa "no se movió", que es otra cosa.

**Estados a construir:** torneo recién creado (tabla en cero, sin defensores) ·
en curso · terminado (campeón del año arriba).

- [ ] **Step 1: La pantalla · Step 2: El sheet · Step 3: Verificar**

```bash
npm run typecheck && npm run build
git add app/torneo/[id]/page.tsx app/torneo/[id]/desempate.tsx
git commit -m "feat: show the standings with movement and the tiebreak sheet"
```

---

### Task 7: Fechas — la lista

**Files:**
- Create: `app/torneo/[id]/fechas/page.tsx`

**Interfaces:**
- Consumes: `matchdaysOf`, `entriesOf`, `awardsOf`, `matchdayDetail` de `db/read.ts`
- Produces: linkea a la Task 8

**Qué NO hace esta tarea:** **no** dibuja el botón "Abrir fecha N" —es escritura,
Plan 4—, no arma el flujo del Masters (Plan 3 lo muestra bloqueado y nada más).

**Copys contractuales:** tags `"Jugada"` / `"Por jugarse"`; detalle de una jugada
`"3–0 · +9 games"`; bloque del Masters con kicker `"Cierre del año"`, título
`"Masters"`, cuerpo `"Se juega con los 4 primeros de la tabla al terminar las 12 fechas. Faltan 6."`
y chip `"Bloqueado"`. Los números salen de la config y de cuántas fechas hay
cerradas.

**Estados:** ninguna fecha jugada · mezcla · temporada regular completa (el
Masters se activa) · todo terminado.

- [ ] **Steps 1-2: construir y verificar**

```bash
npm run typecheck && npm run build
git add app/torneo/[id]/fechas/page.tsx
git commit -m "feat: list the season's matchdays with the masters at the end"
```

---

### Task 8: Fecha `[n]` — la vista de lectura

**Files:**
- Create: `app/torneo/[id]/fechas/[n]/page.tsx`, `app/torneo/[id]/fechas/[n]/rondas.tsx`

**Interfaces:**
- Consumes: `matchdayDetail`, `entriesOf` de `db/read.ts`; `computeStandings` de `core/`
- Produces: nada

**Qué NO hace esta tarea — leelo dos veces:** no construye el wizard de `DRAFT`
(quién viene, el invitado, generar parejas), no carga resultados, no cierra ni
reabre la fecha. **Todo eso es el Plan 4.** Acá se dibuja lo que ya pasó: las
parejas, el fixture con los resultados que existan, y la tabla de la fecha.

Una fecha en `DRAFT` que se abra desde acá muestra que se está armando y nada
más.

**El acordeón es obligatorio y es el punto de la tarea.** Está marcado con 🔁 en
el handoff porque cambió de layout: el prototipo dibujaba 3 rondas × 2 partidos y
entraban de una, pero con 6 parejas son **15 partidos** y una lista sola rompe el
"mínimo scroll".

- Cada ronda es una sección con encabezado propio: `10.5px/800/uppercase` `muted`,
  `"Ronda 2 de 5"` a la izquierda y `"2/3 cargados"` a la derecha.
- La ronda con partidos sin cargar va **abierta**; las completas **colapsadas** a
  una fila resumen tocable con los resultados en chico.
- **Con 5 parejas hay una que descansa cada ronda y hay que mostrarla:**
  `"Descansa esta ronda: {pareja}"`. Si no se muestra, parece un error.

**Copys contractuales:** kickers `"Armando · sólo vos la ves"` /
`"En juego · jueves 27 ago"` / `"Cerrada · jueves 13 ago"`; chips `"Defensora"` y
`"Invitado"`; resultado vacío `"–"`; encabezados de tabla `Pareja / PG / Dif / Pts`;
nota `"Se actualiza a medida que se cargan los resultados. Los puntos se reparten al cerrar la fecha."`;
nota del invitado `"El invitado no suma para el campeonato; su compañero sí."`

**Si la tabla se resolvió por desempate, hay que decirlo, con el criterio.**
Patrón del handoff: `"Nico & Gastón quedaron 2° por diferencia de games: empataron en partidos ganados con Juanma & Seba."`

- [ ] **Steps 1-3: la pantalla, el acordeón, verificar**

```bash
npm run typecheck && npm run build
git add app/torneo/[id]/fechas/[n]
git commit -m "feat: show a matchday's pairs, fixture and table"
```

---

### Task 9: Estadísticas

**Files:**
- Create: `app/torneo/[id]/stats/page.tsx`

**Interfaces:**
- Consumes: `closedHistoryAll`, `entriesOf`, `awardsOf` de `db/read.ts`;
  `tallyPlayers`, `partnerRecords`, `bestPair` (Task 3), `titleStreaks` (Task 1)
- Produces: linkea al perfil de la Task 11

**Qué NO hace esta tarea:** no instala librería de gráficos —las barras son `div`s
con `width` en porcentaje—, no calcula nada por su cuenta: todo sale de `core/`.

**Es la única pantalla que no viene del spec.** Se diseñó de cero, así que el
handoff manda más que de costumbre.

**Bloques:** % de partidos ganados (barras, todo el plantel) · mejor dupla del
torneo · con quién te va bien (personal) · rachas de títulos · presentismo.

**Copys contractuales:** tabs `"Del torneo"` / `"Mías"`; tarjetas
`"Partidos jugados 36"`, `"Games totales 241"`, `"Fecha más pareja (Fecha 5)"`,
`"Racha más larga (Marce · 7)"`; en Mías: `"Partidos 18"`, `"Efectividad 61%"`,
`"Games a favor +14"`, `"Mejor fecha (Fecha 4)"`; duplas `"jugaron N fechas"`.

**Estado de datos insuficientes:** con menos de 2 fechas cerradas se muestra qué
va a aparecer y cuándo, no una pantalla vacía.

- [ ] **Steps 1-2: construir y verificar**

```bash
npm run typecheck && npm run build
git add app/torneo/[id]/stats/page.tsx
git commit -m "feat: show the season's statistics"
```

---

### Task 10: Reglas, con el markdown sanitizado

**Files:**
- Create: `app/torneo/[id]/reglas/page.tsx`, `app/torneo/[id]/reglas/markdown.ts`
- Test: `app/torneo/[id]/reglas/markdown.unit.test.ts`

**Interfaces:**
- Consumes: `seasonHeader`, `seasonRules` de `db/read.ts`; `narrateRules` de `core/`
- Produces: nada

**Qué NO hace esta tarea:** no implementa la edición —es Plan 4, el botón linkea
a Ajustes—, no instala una librería de markdown.

**Esta pantalla es pública: se ve sin login.** Es el link que se pega en el grupo.
Y es la **única entrada de texto libre que se renderiza en toda la app**.

**El sanitizado es la tarea, no un detalle.** El admin escribe markdown y eso se
muestra a todo el mundo, incluso sin cuenta. Sin sanitizar es XSS almacenado con
distribución por WhatsApp.

**Lo más simple que funciona: no renderizar HTML en absoluto.** No hace falta una
librería. Soportá un subconjunto mínimo —párrafos, saltos de línea, `**negrita**`,
listas con `-`— **escapando primero** todo el texto y recién después aplicando ese
subconjunto sobre el texto ya escapado.

```typescript
const ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

/**
 * El texto libre del admin, listo para mostrar.
 *
 * Se escapa TODO primero y recién después se aplica el subconjunto de markdown,
 * nunca al revés: si se formatea antes, el escape se come las etiquetas que
 * acabás de generar, y si se escapa después, no escapaste nada.
 *
 * No se acepta HTML del admin ni siquiera "el inofensivo". Esta página se ve
 * SIN cuenta, así que un `<img onerror>` acá le pega a cualquiera que abra el
 * link del grupo.
 */
export function renderAdminMarkdown(source: string): string {
  const escaped = source.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
  // ...aplicar acá el subconjunto sobre `escaped`
}
```

- [ ] **Step 1: Escribir los tests que fallan**

`markdown.unit.test.ts` — corre en la suite unitaria, sin base. Cubrir:

- `<script>alert(1)</script>` sale escapado y **no** ejecutable
- `<img src=x onerror=alert(1)>` sale escapado
- `[link](javascript:alert(1))` no produce un `href` ejecutable
- `**negrita**` sí produce `<strong>`
- un `&` suelto en el texto del admin sale como `&amp;` y no rompe el resto
- **el orden importa**: un texto con `<` y `**negrita**` junto sale bien las dos
  cosas — es el test que agarra si alguien invierte escape y formato

**Expected: FAIL**

- [ ] **Steps 2-3: implementar la pantalla, verificar**

**Copys contractuales:** intro `"Las reglas de este torneo, como quedaron cuando Marce lo creó."`;
las seis filas del acordeón con sus títulos fijos: `"Formato de partido"`,
`"Cómo se arman las parejas"`, `"Puntos por posición"`, `"Orden de desempate"`,
`"Fechas que cuentan"`, `"Masters"`; botón `"Editar reglas"` (sólo admin).

El bloque generado sale de `narrateRules(config)`, que ya existe y ya está en
español. **No lo reescribas en la pantalla.**

**Estados:** con texto del admin · sin texto del admin (sólo el bloque generado) ·
visto sin login (sin nav del torneo, con un CTA discreto a la landing).

```bash
npm run typecheck && npm test && npm run build
git add app/torneo/[id]/reglas
git commit -m "feat: show the rules page, escaping whatever the admin wrote"
```

---

### Task 11: Perfil de jugador

**Files:**
- Create: `app/torneo/[id]/jugador/[entryId]/page.tsx`

**Interfaces:**
- Consumes: `entriesOf`, `closedHistoryAll`, `awardsOf` de `db/read.ts`;
  `rankingWithMovement` (Task 2), `tallyPlayers` y `partnerRecords` (Task 3),
  `titleStreaks` (Task 1)
- Produces: nada. Es la última tarea

**Qué NO hace esta tarea:** no implementa editar el nombre propio (Plan 4), no
está en la nav —se llega tocando un nombre.

**Bloques:** nombre, posición y puntos · fecha a fecha, marcando **cuáles cuentan
para las mejores N y cuáles se descartan** (`RankingRow` ya trae `counted` y
`discarded`, usalos, no los recalcules) más las ausencias · sus números (fechas
ganadas, racha, partidos ganados y perdidos) · compañeros con récord.

**Copys contractuales:** meta `"2° de {plantel} · 47 puntos · 6 fechas jugadas"`;
tarjetas `"Efectividad 61%"`, `"Fechas ganadas 1"`, `"Dif. games +14"`; columnas
`"F1…F6"`; sección `"Con quién le va mejor"`.

**Estados:** perfil reclamado · asiento sin dueño todavía · perfil propio.

- [ ] **Steps 1-2: construir y verificar**

```bash
npm run typecheck && npm test && npm run db:reset && npm run test:db && npm run build
git add app/torneo/[id]/jugador
git commit -m "feat: show a player's season, matchday by matchday"
```

---

## Aparecidos

Cosas que salgan durante la implementación y **no** se hagan, para no ensanchar
las tareas. Una línea y seguí.

- **"Quién ganó el partido" está escrito cuatro veces.** Inline en
  `computeStandings`, otra vez adentro de su `headToHead`, una tercera en
  `core/masters.ts`, y ahora una cuarta en `core/playerstats.ts` (Task 3). Ninguna
  está exportada, así que la Task 3 no pudo reusarla y la duplicó con un
  comentario que lo dice. Las cuatro son correctas hoy y tienen tests encima, así
  que extraerlas es refactor sin beneficio visible. **El disparador para hacerlo
  es que aparezca una quinta copia, o que cambie `matchFormat`** —ahí hay que
  tocar cuatro lugares y alcanza con olvidarse de uno.

---

## Qué queda afuera de este plan, a propósito

- **Todo lo que escribe.** Abrir fecha, cargar resultados, cerrar, reabrir, el
  wizard de `DRAFT`, el toggle "No voy", editar las reglas, Ajustes. Plan 4.
- **Crear torneo** y **Mis torneos**. Plan 4 (`mySeasons` se construye acá porque
  la capa de lectura es una sola tarea, pero la pantalla es del 4).
- **El flujo del Masters.** Se muestra bloqueado; jugarlo es Plan 4.
- **La racha como puntos.** El spec es explícito: estadística, nunca bonus.

---

## Criterio de terminado

- [ ] `npm test` en verde, sin tests saltados
- [ ] `npm run test:db` en verde contra Supabase local, sin tests saltados
- [ ] `npm run typecheck` sin errores
- [ ] `npm run build` sin errores
- [ ] `core/` sigue puro: nada de `Date`, `Math.random`, `fetch` ni `process`, y
      ningún import fuera de `core/` — `rg '^import' core/ | rg -v "from '\./"`
      (los `vitest` de los tests son la única excepción esperada)
- [ ] Ningún componente `'use client'` importa de `db/server.ts` —
      `rg -l "'use client'" app/ | xargs rg -l 'db/server'` sin resultados
- [ ] Ningún copy inventado: cada string visible sale del handoff o de
      `narrateRules`
- [ ] La página de Reglas se abre **sin sesión** y el markdown del admin sale
      escapado — probado con un `<script>` de verdad guardado en `rules_text`
- [ ] A mano: recorrer las cuatro pestañas en un torneo con datos y en uno recién
      creado, en claro y en oscuro
- [ ] La sección "Aparecidos" está revisada
