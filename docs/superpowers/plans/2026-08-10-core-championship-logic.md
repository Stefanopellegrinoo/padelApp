# Plan 1 — `core/`: la lógica del campeonato

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar toda la lógica del campeonato como funciones puras y probadas, sin base de datos ni interfaz.

**Architecture:** Un paquete `core/` de TypeScript sin dependencias de runtime. Cada módulo recibe datos y devuelve datos: sin I/O, sin fechas del sistema, sin aleatoriedad. Todo determinista, así que un mismo input siempre da el mismo output y una fecha vieja se puede recalcular sin sorpresas. Los módulos posteriores reciben como parámetro lo que los anteriores calculan, en vez de importarse entre sí donde se pueda evitar.

**Tech Stack:** TypeScript, Vitest. Sin dependencias de producción.

## Global Constraints

- **El plantel (`squadSize`) es par, entre 8 y 12.** Constantes del formato: `MIN_PLAYERS = 8`, `MAX_PLAYERS = 12`.
- **`points` tiene exactamente `squadSize / 2` valores**, estrictamente descendentes, todos `> 0`.
- **`mastersSize` es 4.** No es configurable.
- **Una fecha se juega con un número par de jugadores, entre 8 y 12.**
- **El invitado no suma puntos.** Su compañero sí.
- **Nada de I/O, `Date.now()`, `Math.random()` ni acceso a red en `core/`.** Si una función necesita la fecha o el orden vigente, se le pasa por parámetro.
- **Los identificadores son `EntryId` (string), nunca `playerId`.** Los partidos referencian el asiento.
- **Idioma.** Identificadores, nombres de archivo, comentarios, nombres de test y mensajes de commit: **inglés**. Todo string que termine leyendo una persona del grupo va en **castellano**: los mensajes de `validateConfig`, la salida de `narrateRules`, y el texto de los `throw` que describen una situación del dominio (fecha impar, faltan jugadores, no hay puntos para esa posición). Los tests verifican esos textos, así que el idioma es parte del contrato, no una preferencia.

**Fuente de verdad de las reglas:** `docs/superpowers/specs/2026-08-09-padel-championship-design.md`. Ante cualquier duda de comportamiento, manda ese documento.

## Sobre los conteos de tests

Cada tarea dice "Expected: PASS — N tests". **Ese número es orientativo: el bloque de
código es la verdad.** Los conteos los escribí a mano y un `it.each` de tres casos cuenta
como tres tests, no como uno — ya me equivoqué dos veces por eso.

Si el conteo no coincide con lo que corre: **no toques los tests**. Reportá la
discrepancia y seguí. Borrar un test para que cuadre un número es la peor forma posible
de resolverlo.

## Regla anti-scope-creep

Cada tarea lista explícitamente **qué NO hace**. Si mientras implementás una tarea aparece algo que no está en sus pasos:

1. **No lo implementes.**
2. Anotalo al final del plan, en la sección "Aparecidos".
3. Seguí con los pasos de la tarea.

Una tarea termina cuando sus tests pasan. No cuando el módulo "quedaría más completo si además…".

---

## Estructura de archivos

```
core/
  types.ts             tipos del dominio, sin lógica
  constants.ts         MIN_PLAYERS, MAX_PLAYERS, MASTERS_SIZE
  config.ts            validación de SeasonConfig
  matchings.ts         enumeración de emparejamientos de un pool
  order.ts             ordenar jugadores por puntos con desempate
  pairing.ts           armado de parejas de una fecha
  fixture.ts           round robin (algoritmo del círculo)
  standings.ts         tabla de la fecha
  awards.ts            puntos por posición
  ranking.ts           ranking de temporada, mejores N de M
  snapshots.ts         cadena de criterios de desempate
  masters.ts           clasificación, fixture y campeón del Masters
  narrate.ts           la config contada en castellano

core/*.test.ts         un archivo de test por módulo, al lado del código
```

Cada archivo tiene una responsabilidad y no importa a los que están debajo suyo en esa lista, salvo donde una tarea lo diga explícitamente.

---

### Task 1: Setup del proyecto

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `core/constants.ts`
- Test: `core/constants.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `MIN_PLAYERS: 8`, `MAX_PLAYERS: 12`, `MASTERS_SIZE: 4` desde `core/constants.ts`

**Qué NO hace esta tarea:** no instala Next.js, ni Supabase, ni Tailwind, ni ninguna dependencia de UI. Este plan produce lógica pura. El framework llega en el plan 2.

- [ ] **Step 1: Inicializar git**

```bash
git init
git branch -M main
```

- [ ] **Step 2: Crear `package.json`**

```json
{
  "name": "padel-championship",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Crear `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["core/**/*.ts"]
}
```

`noUncheckedIndexedAccess` está a propósito: casi todo este código indexa arrays por posición, y esa opción obliga a manejar el caso "no hay nada ahí" en vez de asumirlo.

- [ ] **Step 4: Crear `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['core/**/*.test.ts'],
  },
})
```

Sin `globals`: cada test importa `describe`, `it` y `expect` de `vitest` explícitamente. Un global implícito que nadie usa es una perilla de más.

- [ ] **Step 5: Crear `.gitignore`**

```
node_modules/
.next/
dist/
*.log
.env
.env.local
.DS_Store
```

- [ ] **Step 6: Instalar dependencias**

Run: `npm install`
Expected: crea `node_modules/` y `package-lock.json` sin errores.

- [ ] **Step 7: Escribir el test que falla**

Create `core/constants.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { MIN_PLAYERS, MAX_PLAYERS, MASTERS_SIZE } from './constants'

describe('constants', () => {
  it('defines the matchday size limits from the format', () => {
    expect(MIN_PLAYERS).toBe(8)
    expect(MAX_PLAYERS).toBe(12)
  })

  it('defines the masters size as four', () => {
    expect(MASTERS_SIZE).toBe(4)
  })
})
```

- [ ] **Step 8: Correr el test y verificar que falla**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./constants"`.

- [ ] **Step 9: Escribir la implementación mínima**

Create `core/constants.ts`:

```typescript
/** Fewer than this and the matchday is lopsided: 3 pairs with one idle every round. */
export const MIN_PLAYERS = 8

/** More than this and a matchday runs 21 matches, which does not fit an afternoon. */
export const MAX_PLAYERS = 12

/** The three rotating Masters matches exist because there are exactly four players. */
export const MASTERS_SIZE = 4
```

- [ ] **Step 10: Correr el test y verificar que pasa**

Run: `npm test`
Expected: PASS — 2 tests.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore core/
git commit -m "chore: bootstrap typescript + vitest with format constants"
```

---

### Task 2: Tipos del dominio

**Files:**
- Create: `core/types.ts`
- Test: ninguno — son sólo tipos, y el chequeo lo hace `tsc`

**Interfaces:**
- Consumes: nada
- Produces: `EntryId`, `Pair`, `SetScore`, `MatchResult`, `SeasonConfig`, `MatchFormat`, `PairStanding`, `Award`, `RankingRow`

**Qué NO hace esta tarea:** no escribe ninguna función. Sólo tipos.

- [ ] **Step 1: Crear `core/types.ts`**

```typescript
/** A seat in a season. Matches always reference this, never a player. */
export type EntryId = string

export interface MatchFormat {
  setsToWin: number
  gamesPerSet: number
  tieBreak: boolean
}

export interface SeasonConfig {
  /** Squad size, not matchday size. Even, between MIN_PLAYERS and MAX_PLAYERS. */
  squadSize: number
  matchFormat: MatchFormat
  /** Exactly squadSize / 2 values, strictly descending, all above zero. */
  points: number[]
  regularMatchdays: number
  countBestOf: number
  mastersSize: number
  tiebreakSnapshotEvery: number
}

export interface Pair {
  a: EntryId
  b: EntryId
}

export interface SetScore {
  gamesA: number
  gamesB: number
}

export interface MatchResult {
  round: number
  pairA: Pair
  pairB: Pair
  /** Empty while the match has not been played. */
  sets: SetScore[]
}

export interface PairStanding {
  pair: Pair
  played: number
  won: number
  setsDiff: number
  gamesDiff: number
  /** 1-based final position within the matchday. */
  position: number
}

export interface Award {
  entryId: EntryId
  position: number
  points: number
}

export interface RankingRow {
  entryId: EntryId
  points: number
  /** Points that counted toward the total, best first. */
  counted: number[]
  /** Points dropped because only the best countBestOf results count. */
  discarded: number[]
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add core/types.ts
git commit -m "feat: add domain types"
```

---

### Task 3: Validación de la configuración

**Files:**
- Create: `core/config.ts`
- Test: `core/config.test.ts`

**Interfaces:**
- Consumes: `SeasonConfig` de `core/types.ts`; `MIN_PLAYERS`, `MAX_PLAYERS` de `core/constants.ts`
- Produces: `validateConfig(config: SeasonConfig): string[]` — devuelve la lista de errores en castellano, vacía si la config es válida. `defaultConfig(squadSize: number): SeasonConfig`.

**Qué NO hace esta tarea:** no narra la config en prosa (eso es la Task 13), no la persiste, no lanza excepciones — devuelve una lista de mensajes.

- [ ] **Step 1: Escribir los tests que fallan**

Create `core/config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { validateConfig, defaultConfig } from './config'
import type { SeasonConfig } from './types'

const valid: SeasonConfig = {
  squadSize: 12,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
  points: [10, 7, 5, 3, 2, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  mastersSize: 4,
  tiebreakSnapshotEvery: 3,
}

describe('validateConfig', () => {
  it('accepts a valid config', () => {
    expect(validateConfig(valid)).toEqual([])
  })

  it('rejects an odd squad size', () => {
    const errors = validateConfig({ ...valid, squadSize: 11, points: [10, 7, 5, 3, 2] })
    expect(errors).toContain('El plantel tiene que ser un número par.')
  })

  it('rejects a squad below the minimum', () => {
    const errors = validateConfig({ ...valid, squadSize: 6, points: [10, 7, 5] })
    expect(errors).toContain('El plantel tiene que ser de 8 jugadores o más.')
  })

  it('rejects a squad above the maximum', () => {
    const errors = validateConfig({ ...valid, squadSize: 14, points: [10, 7, 5, 3, 2, 1, 1] })
    expect(errors).toContain('El plantel no puede pasar de 12 jugadores.')
  })

  it('rejects a points list that does not match the pair count', () => {
    const errors = validateConfig({ ...valid, points: [10, 7, 5, 3] })
    expect(errors).toContain('Con un plantel de 12 hacen falta 6 valores de puntos, no 4.')
  })

  it('rejects points that are not strictly descending', () => {
    const errors = validateConfig({ ...valid, points: [10, 7, 7, 3, 2, 1] })
    expect(errors).toContain('Los puntos tienen que ir de mayor a menor, sin repetir.')
  })

  it('rejects a zero in the points list', () => {
    const errors = validateConfig({ ...valid, points: [10, 7, 5, 3, 1, 0] })
    expect(errors).toContain('Todos los puntos tienen que ser mayores que 0: si salir último diera 0, sería lo mismo que faltar.')
  })

  it('rejects countBestOf above regularMatchdays', () => {
    const errors = validateConfig({ ...valid, countBestOf: 12 })
    expect(errors).toContain('No pueden contar 12 fechas si el torneo tiene 10.')
  })

  it('rejects a tiebreak interval below one', () => {
    const errors = validateConfig({ ...valid, tiebreakSnapshotEvery: 0 })
    expect(errors).toContain('El orden de desempate se tiene que refrescar cada 1 fecha o más.')
  })

  it('reports every problem at once, not just the first', () => {
    const errors = validateConfig({ ...valid, squadSize: 7, countBestOf: 99 })
    expect(errors.length).toBeGreaterThan(1)
  })
})

describe('defaultConfig', () => {
  it('builds a valid config for any allowed squad size', () => {
    for (const size of [8, 10, 12]) {
      expect(validateConfig(defaultConfig(size))).toEqual([])
    }
  })

  it('gives the winner ten points regardless of squad size', () => {
    expect(defaultConfig(8).points[0]).toBe(10)
    expect(defaultConfig(12).points[0]).toBe(10)
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test core/config.test.ts`
Expected: FAIL — `Failed to resolve import "./config"`.

- [ ] **Step 3: Escribir la implementación**

Create `core/config.ts`:

```typescript
import { MAX_PLAYERS, MIN_PLAYERS } from './constants'
import type { SeasonConfig } from './types'

/**
 * Points for a full squad, longest first. A matchday with fewer pairs uses
 * the leading values, so winning always pays ten.
 */
const DEFAULT_POINTS: Record<number, number[]> = {
  4: [10, 6, 3, 1],
  5: [10, 7, 5, 3, 1],
  6: [10, 7, 5, 3, 2, 1],
}

export function defaultConfig(squadSize: number): SeasonConfig {
  const pairCount = squadSize / 2
  return {
    squadSize,
    matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
    points: DEFAULT_POINTS[pairCount] ?? [],
    regularMatchdays: 10,
    countBestOf: 8,
    mastersSize: 4,
    tiebreakSnapshotEvery: 3,
  }
}

export function validateConfig(config: SeasonConfig): string[] {
  const errors: string[] = []
  const { squadSize, points, regularMatchdays, countBestOf, tiebreakSnapshotEvery } = config

  if (squadSize % 2 !== 0) {
    errors.push('El plantel tiene que ser un número par.')
  }
  if (squadSize < MIN_PLAYERS) {
    errors.push(`El plantel tiene que ser de ${MIN_PLAYERS} jugadores o más.`)
  }
  if (squadSize > MAX_PLAYERS) {
    errors.push(`El plantel no puede pasar de ${MAX_PLAYERS} jugadores.`)
  }

  const expectedPoints = Math.floor(squadSize / 2)
  if (points.length !== expectedPoints) {
    errors.push(
      `Con un plantel de ${squadSize} hacen falta ${expectedPoints} valores de puntos, no ${points.length}.`,
    )
  }
  if (points.some((value) => value <= 0)) {
    errors.push(
      'Todos los puntos tienen que ser mayores que 0: si salir último diera 0, sería lo mismo que faltar.',
    )
  }
  if (!isStrictlyDescending(points)) {
    errors.push('Los puntos tienen que ir de mayor a menor, sin repetir.')
  }

  if (regularMatchdays < 1) {
    errors.push('El torneo tiene que tener al menos 1 fecha.')
  }
  if (countBestOf > regularMatchdays) {
    errors.push(`No pueden contar ${countBestOf} fechas si el torneo tiene ${regularMatchdays}.`)
  }
  if (countBestOf < 1) {
    errors.push('Tiene que contar al menos 1 fecha por jugador.')
  }
  if (tiebreakSnapshotEvery < 1) {
    errors.push('El orden de desempate se tiene que refrescar cada 1 fecha o más.')
  }

  return errors
}

function isStrictlyDescending(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    const previous = values[i - 1]
    const current = values[i]
    if (previous === undefined || current === undefined) return false
    if (current >= previous) return false
  }
  return true
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test core/config.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add core/config.ts core/config.test.ts
git commit -m "feat: validate season config"
```

---

### Task 4: Enumeración de emparejamientos

**Files:**
- Create: `core/matchings.ts`
- Test: `core/matchings.test.ts`

**Interfaces:**
- Consumes: `EntryId`, `Pair` de `core/types.ts`
- Produces: `allMatchings(pool: EntryId[]): Pair[][]` — todos los emparejamientos perfectos de un pool par. Devuelve `[[]]` para un pool vacío.

**Qué NO hace esta tarea:** no ordena, no filtra por parejas repetidas, no puntúa equilibrio. Sólo enumera. El filtrado y la elección son la Task 6.

- [ ] **Step 1: Escribir los tests que fallan**

Create `core/matchings.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { allMatchings } from './matchings'

describe('allMatchings', () => {
  it('returns a single empty matching for an empty pool', () => {
    expect(allMatchings([])).toEqual([[]])
  })

  it('returns the only matching for a pool of two', () => {
    expect(allMatchings(['a', 'b'])).toEqual([[{ a: 'a', b: 'b' }]])
  })

  it('returns three matchings for a pool of four', () => {
    expect(allMatchings(['a', 'b', 'c', 'd'])).toHaveLength(3)
  })

  // (n-1)!! — the double factorial of the pool size minus one
  it.each([
    [4, 3],
    [6, 15],
    [8, 105],
    [10, 945],
    [12, 10395],
  ])('returns the double factorial count for a pool of %i', (size, expected) => {
    const pool = Array.from({ length: size }, (_, i) => `p${i}`)
    expect(allMatchings(pool)).toHaveLength(expected)
  })

  it('uses every player exactly once in each matching', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f']
    for (const matching of allMatchings(pool)) {
      const used = matching.flatMap((pair) => [pair.a, pair.b])
      expect(used.sort()).toEqual([...pool].sort())
    }
  })

  it('never produces the same matching twice', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f']
    const keys = allMatchings(pool).map((matching) =>
      matching
        .map((pair) => [pair.a, pair.b].sort().join('-'))
        .sort()
        .join('|'),
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('throws on an odd pool, which cannot be paired', () => {
    expect(() => allMatchings(['a', 'b', 'c'])).toThrow(/par/)
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test core/matchings.test.ts`
Expected: FAIL — `Failed to resolve import "./matchings"`.

- [ ] **Step 3: Escribir la implementación**

Create `core/matchings.ts`:

```typescript
import type { EntryId, Pair } from './types'

/**
 * Every perfect matching of the pool. The count is (n-1)!!, which stays tiny
 * for our sizes: 105 for eight players, 10395 for twelve. Brute force gives
 * the guaranteed optimum in milliseconds, so no heuristic is needed.
 *
 * The first player is fixed and paired with each of the rest in turn, which
 * is what keeps every matching unique instead of producing permutations.
 */
export function allMatchings(pool: EntryId[]): Pair[][] {
  if (pool.length % 2 !== 0) {
    throw new Error(`No se puede emparejar un pool impar: son ${pool.length} jugadores.`)
  }
  if (pool.length === 0) return [[]]

  const [first, ...rest] = pool
  if (first === undefined) return [[]]

  const result: Pair[][] = []
  for (let i = 0; i < rest.length; i++) {
    const partner = rest[i]
    if (partner === undefined) continue
    const remaining = rest.filter((_, index) => index !== i)
    for (const sub of allMatchings(remaining)) {
      result.push([{ a: first, b: partner }, ...sub])
    }
  }
  return result
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test core/matchings.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add core/matchings.ts core/matchings.test.ts
git commit -m "feat: enumerate all perfect matchings of a pool"
```

---

### Task 5: Ordenar jugadores

**Files:**
- Create: `core/order.ts`
- Test: `core/order.test.ts`

**Interfaces:**
- Consumes: `EntryId` de `core/types.ts`
- Produces: `orderByPoints(entries: EntryId[], points: Map<EntryId, number>, snapshot: EntryId[]): EntryId[]` — de más a menos puntos, cortando empates por el orden del snapshot. Los que no están en el snapshot van al final, en el orden en que llegaron.

**Qué NO hace esta tarea:** no calcula puntos, no construye el snapshot, no arma parejas. Sólo ordena una lista que ya recibe.

- [ ] **Step 1: Escribir los tests que fallan**

Create `core/order.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { orderByPoints } from './order'

const snapshot = ['juan', 'stefano', 'marce', 'nico', 'pablo', 'leo']

describe('orderByPoints', () => {
  it('sorts by points, highest first', () => {
    const points = new Map([['juan', 10], ['stefano', 30], ['marce', 20]])
    expect(orderByPoints(['juan', 'stefano', 'marce'], points, snapshot)).toEqual([
      'stefano',
      'marce',
      'juan',
    ])
  })

  it('breaks ties with the snapshot order', () => {
    const points = new Map([['marce', 47], ['nico', 47]])
    expect(orderByPoints(['nico', 'marce'], points, snapshot)).toEqual(['marce', 'nico'])
  })

  it('treats a missing player as having zero points', () => {
    const points = new Map([['juan', 5]])
    expect(orderByPoints(['stefano', 'juan'], points, snapshot)).toEqual(['juan', 'stefano'])
  })

  it('puts players outside the snapshot last, keeping their input order', () => {
    const points = new Map([['guest', 0], ['leo', 0]])
    expect(orderByPoints(['guest', 'leo'], points, snapshot)).toEqual(['leo', 'guest'])
  })

  it('keeps two players outside the snapshot in the order they arrived', () => {
    const points = new Map<string, number>()
    expect(orderByPoints(['g1', 'g2'], points, snapshot)).toEqual(['g1', 'g2'])
  })

  it('does not mutate its input', () => {
    const input = ['nico', 'marce']
    const points = new Map([['marce', 47], ['nico', 47]])
    orderByPoints(input, points, snapshot)
    expect(input).toEqual(['nico', 'marce'])
  })

  it('is a total order: the same input always gives the same output', () => {
    const points = new Map([['marce', 47], ['nico', 47], ['juan', 47]])
    const input = ['juan', 'nico', 'marce']
    const first = orderByPoints(input, points, snapshot)
    const second = orderByPoints([...input].reverse(), points, snapshot)
    expect(first).toEqual(second)
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test core/order.test.ts`
Expected: FAIL — `Failed to resolve import "./order"`.

- [ ] **Step 3: Escribir la implementación**

Create `core/order.ts`:

```typescript
import type { EntryId } from './types'

/**
 * Orders players by championship points, highest first, breaking ties with the
 * standing snapshot. The snapshot is a permutation, so it always cuts: two
 * players can never share a position in it.
 *
 * Players missing from the snapshot — a guest, most of the time — go last,
 * keeping the order they arrived in so the result stays deterministic.
 */
export function orderByPoints(
  entries: EntryId[],
  points: Map<EntryId, number>,
  snapshot: EntryId[],
): EntryId[] {
  const snapshotRank = new Map(snapshot.map((id, index) => [id, index]))
  const arrivalRank = new Map(entries.map((id, index) => [id, index]))
  const OUTSIDE = Number.MAX_SAFE_INTEGER

  return [...entries].sort((left, right) => {
    const pointsDiff = (points.get(right) ?? 0) - (points.get(left) ?? 0)
    if (pointsDiff !== 0) return pointsDiff

    const leftRank = snapshotRank.get(left) ?? OUTSIDE
    const rightRank = snapshotRank.get(right) ?? OUTSIDE
    if (leftRank !== rightRank) return leftRank - rightRank

    return (arrivalRank.get(left) ?? 0) - (arrivalRank.get(right) ?? 0)
  })
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test core/order.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add core/order.ts core/order.test.ts
git commit -m "feat: order players by points with snapshot tiebreak"
```

---

### Task 6: Armado de parejas

**Files:**
- Create: `core/pairing.ts`
- Test: `core/pairing.test.ts`

**Interfaces:**
- Consumes: `allMatchings` de `core/matchings.ts`; `orderByPoints` de `core/order.ts`; `EntryId`, `Pair` de `core/types.ts`
- Produces:
  ```typescript
  interface PairingInput {
    present: EntryId[]
    points: Map<EntryId, number>
    snapshot: EntryId[]
    defenders: Pair | null
    defendersAlreadyRepeated: boolean
    previousPairs: Pair[]
    guestId: EntryId | null
  }
  function buildPairs(input: PairingInput): Pair[]
  function samePair(left: Pair, right: Pair): boolean
  ```

**Qué NO hace esta tarea:** no decide quién asiste, no valida el tamaño de la fecha (eso lo hace quien la llama), no genera el fixture, no reparte puntos.

**Reglas que implementa, del spec 2.5:**

```
1. present (con el invitado ya incluido si el número dio impar)
2. defenders quedan FIJOS si: no son null, ambos están presentes,
   y no repitieron ya. Si no, no hay defensores esa fecha
3. pool = present − defenders
4. ordenar el pool por puntos, desempate por snapshot; el invitado va último
5. enumerar todos los emparejamientos del pool
6. tachar los que repiten una pareja de la fecha anterior
7. quedarse con el de menor desbalance:
     desbalance = Σ |suma_posiciones(pareja) − (n+1)|
```

- [ ] **Step 1: Escribir los tests que fallan**

Create `core/pairing.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildPairs, samePair, type PairingInput } from './pairing'
import type { Pair } from './types'

const SNAPSHOT = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12']

function input(overrides: Partial<PairingInput> = {}): PairingInput {
  return {
    present: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
    points: new Map(SNAPSHOT.map((id, i) => [id, 100 - i])),
    snapshot: SNAPSHOT,
    defenders: null,
    defendersAlreadyRepeated: false,
    previousPairs: [],
    guestId: null,
    ...overrides,
  }
}

function key(pair: Pair): string {
  return [pair.a, pair.b].sort().join('-')
}

function keys(pairs: Pair[]): string[] {
  return pairs.map(key).sort()
}

describe('samePair', () => {
  it('ignores the order of the two players', () => {
    expect(samePair({ a: 'x', b: 'y' }, { a: 'y', b: 'x' })).toBe(true)
  })

  it('is false for different players', () => {
    expect(samePair({ a: 'x', b: 'y' }, { a: 'x', b: 'z' })).toBe(false)
  })
})

describe('buildPairs — the balanced default', () => {
  it('pairs first with last when nothing constrains it', () => {
    const pairs = buildPairs(input())
    expect(keys(pairs)).toEqual(['p1-p8', 'p2-p7', 'p3-p6', 'p4-p5'])
  })

  it('returns half as many pairs as players', () => {
    expect(buildPairs(input())).toHaveLength(4)
    expect(buildPairs(input({ present: SNAPSHOT.slice(0, 12) }))).toHaveLength(6)
    expect(buildPairs(input({ present: SNAPSHOT.slice(0, 10) }))).toHaveLength(5)
  })

  it('uses every present player exactly once', () => {
    const present = SNAPSHOT.slice(0, 12)
    const used = buildPairs(input({ present })).flatMap((pair) => [pair.a, pair.b])
    expect(used.sort()).toEqual([...present].sort())
  })

  it('gives the same result for the same input', () => {
    expect(keys(buildPairs(input()))).toEqual(keys(buildPairs(input())))
  })

  it('does not depend on the order the present players arrive in', () => {
    const straight = buildPairs(input())
    const shuffled = buildPairs(input({ present: ['p5', 'p1', 'p8', 'p3', 'p7', 'p2', 'p6', 'p4'] }))
    expect(keys(shuffled)).toEqual(keys(straight))
  })
})

describe('buildPairs — the defending champions', () => {
  const defenders: Pair = { a: 'p3', b: 'p4' }

  it('keeps the defenders together and out of the pool', () => {
    const pairs = buildPairs(input({ defenders }))
    expect(keys(pairs)).toContain('p3-p4')
    expect(pairs).toHaveLength(4)
  })

  it('dissolves them when one of the two is missing', () => {
    const pairs = buildPairs(
      input({ defenders, present: ['p1', 'p2', 'p3', 'p5', 'p6', 'p7', 'p8', 'p9'] }),
    )
    expect(keys(pairs)).not.toContain('p3-p4')
  })

  it('dissolves them when they already repeated once', () => {
    const pairs = buildPairs(input({ defenders, defendersAlreadyRepeated: true }))
    expect(keys(pairs)).not.toContain('p3-p4')
  })

  it('builds every pair from scratch when there are no defenders', () => {
    const pairs = buildPairs(input({ defenders: null }))
    expect(pairs).toHaveLength(4)
  })
})

describe('buildPairs — no repeating last matchday', () => {
  it('never repeats a pair from the previous matchday', () => {
    const previousPairs: Pair[] = [
      { a: 'p1', b: 'p8' },
      { a: 'p2', b: 'p7' },
      { a: 'p3', b: 'p6' },
      { a: 'p4', b: 'p5' },
    ]
    const pairs = buildPairs(input({ previousPairs }))
    for (const built of pairs) {
      expect(previousPairs.some((old) => samePair(old, built))).toBe(false)
    }
  })

  it('falls back to the next most balanced when the ideal one repeats', () => {
    const previousPairs: Pair[] = [{ a: 'p1', b: 'p8' }]
    const pairs = buildPairs(input({ previousPairs }))
    expect(keys(pairs)).not.toContain('p1-p8')
    expect(pairs).toHaveLength(4)
  })

  it('still finds a legal set when the table is identical to last matchday', () => {
    const previousPairs: Pair[] = [
      { a: 'p1', b: 'p8' },
      { a: 'p2', b: 'p7' },
      { a: 'p3', b: 'p6' },
      { a: 'p4', b: 'p5' },
    ]
    const pairs = buildPairs(input({ previousPairs, points: new Map() }))
    expect(pairs).toHaveLength(4)
  })

  it('ignores a previous pair whose players are not both present', () => {
    const previousPairs: Pair[] = [{ a: 'p1', b: 'p99' }]
    expect(() => buildPairs(input({ previousPairs }))).not.toThrow()
  })

  it('never runs out of legal options for any allowed size', () => {
    for (const size of [8, 10, 12]) {
      const present = SNAPSHOT.slice(0, size)
      const previousPairs = buildPairs(input({ present }))
      const next = buildPairs(input({ present, previousPairs }))
      expect(next).toHaveLength(size / 2)
      for (const built of next) {
        expect(previousPairs.some((old) => samePair(old, built))).toBe(false)
      }
    }
  })
})

describe('buildPairs — the guest', () => {
  it('places the guest last in the order, so they get the table leader', () => {
    const present = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'guest']
    const points = new Map(present.map((id, i) => [id, 100 - i]))
    points.set('guest', 999) // points must not lift the guest out of last place
    const pairs = buildPairs(input({ present, points, guestId: 'guest' }))
    expect(keys(pairs)).toContain('guest-p1')
  })

  it('pairs the guest normally when they are not flagged as one', () => {
    const present = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']
    expect(buildPairs(input({ present, guestId: null }))).toHaveLength(4)
  })
})

describe('buildPairs — refusing the impossible', () => {
  it('throws on an odd number of present players', () => {
    expect(() => buildPairs(input({ present: ['p1', 'p2', 'p3'] }))).toThrow(/par/)
  })

  it('throws loudly rather than returning nothing', () => {
    expect(() => buildPairs(input({ present: [] }))).toThrow()
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test core/pairing.test.ts`
Expected: FAIL — `Failed to resolve import "./pairing"`.

- [ ] **Step 3: Escribir la implementación**

Create `core/pairing.ts`:

```typescript
import { allMatchings } from './matchings'
import { orderByPoints } from './order'
import type { EntryId, Pair } from './types'

export interface PairingInput {
  /** Everyone playing this matchday, guest included. Must be even. */
  present: EntryId[]
  points: Map<EntryId, number>
  snapshot: EntryId[]
  /** Winners of the previous matchday, or null when there was none. */
  defenders: Pair | null
  /** True when the defenders already played their one repeat. */
  defendersAlreadyRepeated: boolean
  previousPairs: Pair[]
  guestId: EntryId | null
}

export function samePair(left: Pair, right: Pair): boolean {
  return (
    (left.a === right.a && left.b === right.b) || (left.a === right.b && left.b === right.a)
  )
}

export function buildPairs(input: PairingInput): Pair[] {
  const { present, points, snapshot, defenders, defendersAlreadyRepeated, previousPairs, guestId } =
    input

  if (present.length === 0) {
    throw new Error('No se puede armar una fecha sin jugadores.')
  }
  if (present.length % 2 !== 0) {
    throw new Error(`Hacen falta jugadores en número par: hay ${present.length}.`)
  }

  const fixed = resolveDefenders(present, defenders, defendersAlreadyRepeated)
  const pool = fixed
    ? present.filter((id) => id !== fixed.a && id !== fixed.b)
    : [...present]

  const ordered = orderPool(pool, points, snapshot, guestId)
  const position = new Map(ordered.map((id, index) => [id, index + 1]))
  const idealSum = ordered.length + 1

  const candidates = allMatchings(ordered)
  const legal = candidates.filter(
    (matching) =>
      !matching.some((pair) => previousPairs.some((previous) => samePair(previous, pair))),
  )

  // Proven in the spec (2.5): the no-repeat rule can never rule out everything.
  // A pool of six leaves eight legal draws out of fifteen, and the worst case,
  // a pool of four, still leaves two. If nothing survives here it is a bug, and
  // it must fail loudly rather than pair at random.
  let best = legal[0]
  if (best === undefined) {
    throw new Error(
      `No quedó ningún armado legal para ${ordered.length} jugadores. Esto es un bug: siempre tiene que existir al menos uno.`,
    )
  }
  let bestScore = imbalance(best, position, idealSum)
  for (const matching of legal.slice(1)) {
    const score = imbalance(matching, position, idealSum)
    if (score < bestScore) {
      best = matching
      bestScore = score
    }
  }

  return fixed ? [fixed, ...best] : best
}

/**
 * The defenders stay together only if both turned up and they have not used
 * their single repeat yet. Otherwise there are no defenders this matchday and
 * every pair comes out of the general draw.
 */
function resolveDefenders(
  present: EntryId[],
  defenders: Pair | null,
  alreadyRepeated: boolean,
): Pair | null {
  if (defenders === null) return null
  if (alreadyRepeated) return null
  const bothPresent = present.includes(defenders.a) && present.includes(defenders.b)
  return bothPresent ? defenders : null
}

/** The guest always sits last: nobody knows how they play, so the tail is the neutral spot. */
function orderPool(
  pool: EntryId[],
  points: Map<EntryId, number>,
  snapshot: EntryId[],
  guestId: EntryId | null,
): EntryId[] {
  if (guestId === null || !pool.includes(guestId)) {
    return orderByPoints(pool, points, snapshot)
  }
  const withoutGuest = pool.filter((id) => id !== guestId)
  return [...orderByPoints(withoutGuest, points, snapshot), guestId]
}

/**
 * How far a set of pairs is from perfect balance. With n players ranked 1..n,
 * a balanced pair adds up to n+1, so the further each pair strays from that
 * sum, the worse the draw.
 */
function imbalance(matching: Pair[], position: Map<EntryId, number>, idealSum: number): number {
  let total = 0
  for (const pair of matching) {
    const sum = (position.get(pair.a) ?? 0) + (position.get(pair.b) ?? 0)
    total += Math.abs(sum - idealSum)
  }
  return total
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test core/pairing.test.ts`
Expected: PASS — 20 tests.

- [ ] **Step 5: Commit**

```bash
git add core/pairing.ts core/pairing.test.ts
git commit -m "feat: build matchday pairs with defenders and no-repeat rule"
```

---

### Task 7: Fixture round robin

**Files:**
- Create: `core/fixture.ts`
- Test: `core/fixture.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores
- Produces: `buildFixture(pairCount: number): Array<Array<[number, number]>>` — rondas, cada una con los partidos como pares de índices de pareja. Con un número impar de parejas, una queda libre en cada ronda y simplemente no aparece.

**Qué NO hace esta tarea:** no asigna canchas, no asigna horarios, no conoce los `EntryId` — trabaja con índices. Quien la llama mapea índice a pareja.

- [ ] **Step 1: Escribir los tests que fallan**

Create `core/fixture.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildFixture } from './fixture'

function allMatches(fixture: Array<Array<[number, number]>>): Array<[number, number]> {
  return fixture.flat()
}

describe('buildFixture', () => {
  it('builds six matches in three rounds for four pairs', () => {
    const fixture = buildFixture(4)
    expect(fixture).toHaveLength(3)
    expect(allMatches(fixture)).toHaveLength(6)
    for (const round of fixture) expect(round).toHaveLength(2)
  })

  it('builds ten matches in five rounds for five pairs, one idle each round', () => {
    const fixture = buildFixture(5)
    expect(fixture).toHaveLength(5)
    expect(allMatches(fixture)).toHaveLength(10)
    for (const round of fixture) expect(round).toHaveLength(2)
  })

  it('builds fifteen matches in five rounds for six pairs', () => {
    const fixture = buildFixture(6)
    expect(fixture).toHaveLength(5)
    expect(allMatches(fixture)).toHaveLength(15)
    for (const round of fixture) expect(round).toHaveLength(3)
  })

  it.each([4, 5, 6])('has every pair meet every other exactly once with %i pairs', (count) => {
    const seen = new Set<string>()
    for (const [left, right] of allMatches(buildFixture(count))) {
      const key = [left, right].sort((a, b) => a - b).join('-')
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
    expect(seen.size).toBe((count * (count - 1)) / 2)
  })

  it.each([4, 5, 6])('never schedules a pair twice in one round with %i pairs', (count) => {
    for (const round of buildFixture(count)) {
      const playing = round.flat()
      expect(new Set(playing).size).toBe(playing.length)
    }
  })

  it.each([4, 5, 6])('gives every pair the same number of matches with %i pairs', (count) => {
    const played = new Map<number, number>()
    for (const [left, right] of allMatches(buildFixture(count))) {
      played.set(left, (played.get(left) ?? 0) + 1)
      played.set(right, (played.get(right) ?? 0) + 1)
    }
    expect([...played.values()]).toEqual(Array.from({ length: count }, () => count - 1))
  })

  it('only ever uses valid pair indices', () => {
    for (const [left, right] of allMatches(buildFixture(6))) {
      expect(left).toBeGreaterThanOrEqual(0)
      expect(right).toBeGreaterThanOrEqual(0)
      expect(left).toBeLessThan(6)
      expect(right).toBeLessThan(6)
    }
  })

  it('gives the same fixture for the same input', () => {
    expect(buildFixture(6)).toEqual(buildFixture(6))
  })

  it('throws below two pairs, where there is nothing to play', () => {
    expect(() => buildFixture(1)).toThrow(/2 parejas/)
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test core/fixture.test.ts`
Expected: FAIL — `Failed to resolve import "./fixture"`.

- [ ] **Step 3: Escribir la implementación**

Create `core/fixture.ts`:

```typescript
const BYE = -1

/**
 * Round robin with the circle method: pair 0 stays put and the rest rotate one
 * step each round, so every pair meets every other exactly once.
 *
 * With an odd number of pairs a phantom BYE joins the circle; whoever draws it
 * sits that round out, and the match is simply left out of the result. That is
 * arithmetic, not a shortcut — five pairs cannot all play at the same time.
 *
 * Returns rounds of matches, each match a tuple of pair indices.
 */
export function buildFixture(pairCount: number): Array<Array<[number, number]>> {
  if (pairCount < 2) {
    throw new Error(`Hacen falta al menos 2 parejas para jugar, hay ${pairCount}.`)
  }

  const circle: number[] = Array.from({ length: pairCount }, (_, i) => i)
  if (circle.length % 2 !== 0) circle.push(BYE)

  const size = circle.length
  const rounds: Array<Array<[number, number]>> = []

  for (let round = 0; round < size - 1; round++) {
    const matches: Array<[number, number]> = []
    for (let i = 0; i < size / 2; i++) {
      const home = circle[i]
      const away = circle[size - 1 - i]
      if (home === undefined || away === undefined) continue
      if (home === BYE || away === BYE) continue
      matches.push([home, away])
    }
    rounds.push(matches)

    // Rotate everything but the first slot.
    const fixed = circle[0]
    const last = circle[size - 1]
    if (fixed === undefined || last === undefined) break
    circle.splice(0, size, fixed, last, ...circle.slice(1, size - 1))
  }

  return rounds
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test core/fixture.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Commit**

```bash
git add core/fixture.ts core/fixture.test.ts
git commit -m "feat: build round robin fixture with the circle method"
```

---

### Task 8: Tabla de la fecha

**Files:**
- Create: `core/standings.ts`
- Test: `core/standings.test.ts`

**Interfaces:**
- Consumes: `samePair` de `core/pairing.ts`; `Pair`, `MatchResult`, `PairStanding`, `SeasonConfig`, `EntryId` de `core/types.ts`
- Produces: `computeStandings(pairs: Pair[], matches: MatchResult[], config: SeasonConfig, snapshot: EntryId[]): PairStanding[]` — ordenada, con `position` empezando en 1.

**Qué NO hace esta tarea:** no reparte puntos (Task 9), no valida los resultados contra el formato, no toca el ranking de temporada.

**Criterios de orden, del spec 2.3:**

```
1. partidos ganados            desc
2. diferencia de sets          desc   (sólo si setsToWin > 1)
3. diferencia de games         desc
4. resultado entre las empatadas
5. la pareja cuyo mejor jugador esté más arriba en el snapshot
```

**Cuidado con el paso 4: NO se puede meter dentro de un comparador de `sort`.**

El resultado entre parejas empatadas es circular en un triple empate: A le gana a B, B le gana a C, y C le gana a A. Un comparador que devuelve "A antes que B" y "B antes que C" y "C antes que A" **no es transitivo**, y `Array.prototype.sort` con un comparador así devuelve cualquier cosa — el resultado depende del algoritmo interno y del orden de entrada. Sería un bug intermitente, de los peores de encontrar.

La forma correcta, y la que implementa esta tarea:

1. Ordenar por los criterios **objetivos** (pasos 1 a 3), que sí son transitivos.
2. **Agrupar** las parejas que quedaron exactamente iguales.
3. Dentro de cada grupo: si son **exactamente 2**, corta el resultado entre ellas. Si son **3 o más**, o si el partido entre las 2 no resolvió, corta el snapshot directo.

Es exactamente lo que dice el spec cuando aclara que en un `2-2-2` el resultado entre parejas "es circular y no resuelve".

- [ ] **Step 1: Escribir los tests que fallan**

Create `core/standings.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeStandings } from './standings'
import type { MatchResult, Pair, SeasonConfig } from './types'

const SNAPSHOT = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2']

const PAIRS: Pair[] = [
  { a: 'a1', b: 'a2' },
  { a: 'b1', b: 'b2' },
  { a: 'c1', b: 'c2' },
  { a: 'd1', b: 'd2' },
]

const CONFIG: SeasonConfig = {
  squadSize: 8,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
  points: [10, 6, 3, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  mastersSize: 4,
  tiebreakSnapshotEvery: 3,
}

function match(left: number, right: number, gamesA: number, gamesB: number): MatchResult {
  const pairA = PAIRS[left]
  const pairB = PAIRS[right]
  if (pairA === undefined || pairB === undefined) throw new Error('bad test fixture')
  return { round: 1, pairA, pairB, sets: [{ gamesA, gamesB }] }
}

function order(standings: ReturnType<typeof computeStandings>): string[] {
  return standings.map((row) => row.pair.a)
}

describe('computeStandings', () => {
  it('ranks by matches won, most first', () => {
    // A wins 3, B wins 2, C wins 1, D wins 0  →  3-2-1-0
    const matches = [
      match(0, 1, 4, 2), match(0, 2, 4, 1), match(0, 3, 4, 0),
      match(1, 2, 4, 2), match(1, 3, 4, 1),
      match(2, 3, 4, 3),
    ]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    expect(order(standings)).toEqual(['a1', 'b1', 'c1', 'd1'])
    expect(standings.map((row) => row.position)).toEqual([1, 2, 3, 4])
  })

  it('breaks a two-way tie on games difference', () => {
    // A and B both win 2. A is +6 on games, B is +2.
    const matches = [
      match(0, 1, 2, 4), match(0, 2, 4, 0), match(0, 3, 4, 0),
      match(1, 2, 4, 3), match(1, 3, 3, 4),
      match(2, 3, 4, 2),
    ]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    expect(standings[0]?.pair.a).toBe('a1')
    expect(standings[1]?.pair.a).toBe('b1')
  })

  it('breaks a two-way tie on the head to head when games difference is equal', () => {
    // A and B both win 2 and both finish +4 on games. B beat A 4-1.
    const matches = [
      match(0, 1, 1, 4), match(0, 2, 4, 0), match(0, 3, 4, 1),
      match(1, 2, 4, 1), match(1, 3, 2, 4),
      match(2, 3, 4, 2),
    ]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    expect(standings[0]?.won).toBe(standings[1]?.won)
    expect(standings[0]?.gamesDiff).toBe(standings[1]?.gamesDiff)
    expect(standings[0]?.pair.a).toBe('b1')
    expect(standings[1]?.pair.a).toBe('a1')
  })

  it('falls back to the snapshot on a three-way tie, where the head to head is circular', () => {
    // A beats B, B beats C, C beats A — and all three beat D. Every match 4-3,
    // so A, B and C finish level on wins and on games difference too.
    const matches = [
      match(0, 1, 4, 3), match(1, 2, 4, 3), match(0, 2, 3, 4),
      match(0, 3, 4, 3), match(1, 3, 4, 3), match(2, 3, 4, 3),
    ]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    // Circular head to head resolves nothing, so the snapshot cuts: a1 < b1 < c1.
    expect(standings.map((row) => row.pair.a)).toEqual(['a1', 'b1', 'c1', 'd1'])
  })

  it('gives the same order no matter how the pairs arrive', () => {
    const matches = [
      match(0, 1, 4, 3), match(1, 2, 4, 3), match(0, 2, 3, 4),
      match(0, 3, 4, 3), match(1, 3, 4, 3), match(2, 3, 4, 3),
    ]
    const straight = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    const reversed = computeStandings([...PAIRS].reverse(), matches, CONFIG, SNAPSHOT)
    expect(reversed.map((row) => row.pair.a)).toEqual(straight.map((row) => row.pair.a))
  })

  it('always produces a total order: no two pairs share a position', () => {
    const matches = [
      match(0, 1, 4, 3), match(0, 2, 4, 3), match(0, 3, 4, 3),
      match(1, 2, 4, 3), match(1, 3, 4, 3),
      match(2, 3, 4, 3),
    ]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    expect(new Set(standings.map((row) => row.position)).size).toBe(PAIRS.length)
  })

  it('counts played, won and games difference per pair', () => {
    const matches = [match(0, 1, 4, 2)]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    const rowA = standings.find((row) => row.pair.a === 'a1')
    const rowB = standings.find((row) => row.pair.a === 'b1')
    expect(rowA?.played).toBe(1)
    expect(rowA?.won).toBe(1)
    expect(rowA?.gamesDiff).toBe(2)
    expect(rowB?.won).toBe(0)
    expect(rowB?.gamesDiff).toBe(-2)
  })

  it('ignores matches that have not been played yet', () => {
    const pairA = PAIRS[0]
    const pairB = PAIRS[1]
    if (pairA === undefined || pairB === undefined) throw new Error('bad test fixture')
    const matches: MatchResult[] = [{ round: 1, pairA, pairB, sets: [] }]
    const standings = computeStandings(PAIRS, matches, CONFIG, SNAPSHOT)
    expect(standings.every((row) => row.played === 0)).toBe(true)
  })

  it('adds a sets difference step when a match needs more than one set', () => {
    const multiSet: SeasonConfig = {
      ...CONFIG,
      matchFormat: { setsToWin: 2, gamesPerSet: 6, tieBreak: true },
    }
    const pairA = PAIRS[0]
    const pairB = PAIRS[1]
    if (pairA === undefined || pairB === undefined) throw new Error('bad test fixture')
    const matches: MatchResult[] = [
      {
        round: 1,
        pairA,
        pairB,
        sets: [
          { gamesA: 6, gamesB: 4 },
          { gamesA: 3, gamesB: 6 },
          { gamesA: 6, gamesB: 3 },
        ],
      },
    ]
    const standings = computeStandings(PAIRS, matches, multiSet, SNAPSHOT)
    const rowA = standings.find((row) => row.pair.a === 'a1')
    expect(rowA?.won).toBe(1)
    expect(rowA?.setsDiff).toBe(1)
  })

  it('ranks six pairs as happily as four', () => {
    const sixPairs: Pair[] = [
      ...PAIRS,
      { a: 'e1', b: 'e2' },
      { a: 'f1', b: 'f2' },
    ]
    const standings = computeStandings(sixPairs, [], CONFIG, [...SNAPSHOT, 'e1', 'e2', 'f1', 'f2'])
    expect(standings).toHaveLength(6)
    expect(standings.map((row) => row.position)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('does not mutate the pairs it receives', () => {
    const input = [...PAIRS]
    computeStandings(input, [], CONFIG, SNAPSHOT)
    expect(input).toEqual(PAIRS)
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test core/standings.test.ts`
Expected: FAIL — `Failed to resolve import "./standings"`.

- [ ] **Step 3: Escribir la implementación**

Create `core/standings.ts`:

```typescript
import { samePair } from './pairing'
import type { EntryId, MatchResult, Pair, PairStanding, SeasonConfig } from './types'

interface Tally {
  pair: Pair
  played: number
  won: number
  setsWon: number
  setsLost: number
  gamesWon: number
  gamesLost: number
}

/**
 * The matchday table. Ranks pairs by matches won, then games difference, then
 * the head to head between the tied pairs, and finally the snapshot.
 *
 * That last step almost never fires, but it has to exist: in a three-way 2-2-2
 * the head to head is circular and resolves nothing, and without a final cut
 * three pairs would be left arguing over first place.
 */
export function computeStandings(
  pairs: Pair[],
  matches: MatchResult[],
  config: SeasonConfig,
  snapshot: EntryId[],
): PairStanding[] {
  const tallies = pairs.map<Tally>((pair) => ({
    pair,
    played: 0,
    won: 0,
    setsWon: 0,
    setsLost: 0,
    gamesWon: 0,
    gamesLost: 0,
  }))

  const find = (pair: Pair): Tally | undefined =>
    tallies.find((tally) => samePair(tally.pair, pair))

  for (const match of matches) {
    if (match.sets.length === 0) continue // not played yet
    const left = find(match.pairA)
    const right = find(match.pairB)
    if (left === undefined || right === undefined) continue

    let setsA = 0
    let setsB = 0
    let gamesA = 0
    let gamesB = 0
    for (const set of match.sets) {
      gamesA += set.gamesA
      gamesB += set.gamesB
      if (set.gamesA > set.gamesB) setsA++
      else if (set.gamesB > set.gamesA) setsB++
    }

    left.played++
    right.played++
    left.setsWon += setsA
    left.setsLost += setsB
    right.setsWon += setsB
    right.setsLost += setsA
    left.gamesWon += gamesA
    left.gamesLost += gamesB
    right.gamesWon += gamesB
    right.gamesLost += gamesA
    if (setsA > setsB) left.won++
    else if (setsB > setsA) right.won++
  }

  const snapshotRank = new Map(snapshot.map((id, index) => [id, index]))
  const OUTSIDE = Number.MAX_SAFE_INTEGER
  const bestPlayerRank = (pair: Pair): number =>
    Math.min(snapshotRank.get(pair.a) ?? OUTSIDE, snapshotRank.get(pair.b) ?? OUTSIDE)

  const usesSetsDiff = config.matchFormat.setsToWin > 1

  // Step one: the objective criteria, which are transitive and safe to sort with.
  const byObjective = [...tallies].sort((left, right) =>
    compareObjective(left, right, usesSetsDiff),
  )

  // Step two: group whatever came out exactly level.
  const groups: Tally[][] = []
  for (const tally of byObjective) {
    const current = groups[groups.length - 1]
    const head = current?.[0]
    if (current !== undefined && head !== undefined && compareObjective(head, tally, usesSetsDiff) === 0) {
      current.push(tally)
    } else {
      groups.push([tally])
    }
  }

  // Step three: break each group. The head to head only applies to a group of
  // exactly two — with three it is circular and resolves nothing, so the
  // snapshot cuts. Never feed the head to head into a comparator: it is not
  // transitive, and sort would return garbage.
  const sorted = groups.flatMap((group) => {
    if (group.length === 1) return group
    if (group.length === 2) {
      const [first, second] = group
      if (first !== undefined && second !== undefined) {
        const head = headToHead(first.pair, second.pair, matches)
        if (head !== 0) return head < 0 ? [first, second] : [second, first]
      }
    }
    return [...group].sort((left, right) => bestPlayerRank(left.pair) - bestPlayerRank(right.pair))
  })

  return sorted.map((tally, index) => ({
    pair: tally.pair,
    played: tally.played,
    won: tally.won,
    setsDiff: tally.setsWon - tally.setsLost,
    gamesDiff: tally.gamesWon - tally.gamesLost,
    position: index + 1,
  }))
}

/** Matches won, then sets difference when the format has more than one set, then games. */
function compareObjective(left: Tally, right: Tally, usesSetsDiff: boolean): number {
  if (right.won !== left.won) return right.won - left.won
  if (usesSetsDiff) {
    const leftSets = left.setsWon - left.setsLost
    const rightSets = right.setsWon - right.setsLost
    if (rightSets !== leftSets) return rightSets - leftSets
  }
  return right.gamesWon - right.gamesLost - (left.gamesWon - left.gamesLost)
}

/** Negative when left beat right, positive when right beat left, zero otherwise. */
function headToHead(left: Pair, right: Pair, matches: MatchResult[]): number {
  for (const match of matches) {
    if (match.sets.length === 0) continue
    const leftIsA = samePair(match.pairA, left) && samePair(match.pairB, right)
    const leftIsB = samePair(match.pairA, right) && samePair(match.pairB, left)
    if (!leftIsA && !leftIsB) continue

    let setsA = 0
    let setsB = 0
    for (const set of match.sets) {
      if (set.gamesA > set.gamesB) setsA++
      else if (set.gamesB > set.gamesA) setsB++
    }
    if (setsA === setsB) return 0
    const aWon = setsA > setsB
    if (leftIsA) return aWon ? -1 : 1
    return aWon ? 1 : -1
  }
  return 0
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test core/standings.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add core/standings.ts core/standings.test.ts
git commit -m "feat: compute matchday standings with the full tiebreak chain"
```

---

### Task 9: Puntos de la fecha

**Files:**
- Create: `core/awards.ts`
- Test: `core/awards.test.ts`

**Interfaces:**
- Consumes: `PairStanding`, `SeasonConfig`, `Award`, `EntryId` de `core/types.ts`
- Produces: `computeAwards(standings: PairStanding[], config: SeasonConfig, guestId: EntryId | null): Award[]`

**Qué NO hace esta tarea:** no calcula la tabla, no acumula el ranking de temporada, no persiste nada.

- [ ] **Step 1: Escribir los tests que fallan**

Create `core/awards.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeAwards } from './awards'
import type { PairStanding, SeasonConfig } from './types'

const CONFIG: SeasonConfig = {
  squadSize: 12,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
  points: [10, 7, 5, 3, 2, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  mastersSize: 4,
  tiebreakSnapshotEvery: 3,
}

function standing(a: string, b: string, position: number): PairStanding {
  return { pair: { a, b }, played: 3, won: 0, setsDiff: 0, gamesDiff: 0, position }
}

describe('computeAwards', () => {
  it('gives both members of a pair exactly the same points', () => {
    const awards = computeAwards([standing('a1', 'a2', 1)], CONFIG, null)
    expect(awards).toHaveLength(2)
    expect(awards[0]?.points).toBe(10)
    expect(awards[1]?.points).toBe(10)
  })

  it('uses the leading values of the list for a four pair matchday', () => {
    const standings = [
      standing('a1', 'a2', 1),
      standing('b1', 'b2', 2),
      standing('c1', 'c2', 3),
      standing('d1', 'd2', 4),
    ]
    const byEntry = new Map(computeAwards(standings, CONFIG, null).map((a) => [a.entryId, a.points]))
    expect(byEntry.get('a1')).toBe(10)
    expect(byEntry.get('b1')).toBe(7)
    expect(byEntry.get('c1')).toBe(5)
    expect(byEntry.get('d1')).toBe(3)
  })

  it('uses the whole list for a six pair matchday', () => {
    const standings = [
      standing('a1', 'a2', 1),
      standing('b1', 'b2', 2),
      standing('c1', 'c2', 3),
      standing('d1', 'd2', 4),
      standing('e1', 'e2', 5),
      standing('f1', 'f2', 6),
    ]
    const byEntry = new Map(computeAwards(standings, CONFIG, null).map((a) => [a.entryId, a.points]))
    expect(byEntry.get('a1')).toBe(10)
    expect(byEntry.get('f1')).toBe(1)
  })

  it('pays ten for the win regardless of how many pairs played', () => {
    const four = computeAwards([standing('a1', 'a2', 1)], CONFIG, null)
    const six = computeAwards(
      [standing('a1', 'a2', 1), standing('b1', 'b2', 2)],
      CONFIG,
      null,
    )
    expect(four[0]?.points).toBe(10)
    expect(six[0]?.points).toBe(10)
  })

  it('never awards zero, so turning up always beats staying home', () => {
    const standings = Array.from({ length: 6 }, (_, i) => standing(`p${i}a`, `p${i}b`, i + 1))
    for (const award of computeAwards(standings, CONFIG, null)) {
      expect(award.points).toBeGreaterThan(0)
    }
  })

  it('skips the guest, who is not in the championship', () => {
    const awards = computeAwards([standing('a1', 'guest', 1)], CONFIG, 'guest')
    expect(awards).toHaveLength(1)
    expect(awards[0]?.entryId).toBe('a1')
  })

  it('still pays the guest partner in full', () => {
    const awards = computeAwards([standing('a1', 'guest', 1)], CONFIG, 'guest')
    expect(awards[0]?.points).toBe(10)
  })

  it('records the position alongside the points', () => {
    const awards = computeAwards([standing('a1', 'a2', 3)], CONFIG, null)
    expect(awards[0]?.position).toBe(3)
  })

  it('throws when the standings are longer than the points list', () => {
    const tooMany = Array.from({ length: 7 }, (_, i) => standing(`p${i}a`, `p${i}b`, i + 1))
    expect(() => computeAwards(tooMany, CONFIG, null)).toThrow(/puntos/)
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test core/awards.test.ts`
Expected: FAIL — `Failed to resolve import "./awards"`.

- [ ] **Step 3: Escribir la implementación**

Create `core/awards.ts`:

```typescript
import type { Award, EntryId, PairStanding, SeasonConfig } from './types'

/**
 * Points for a finished matchday. Both members of a pair always take the same
 * amount, and a shorter matchday simply uses the leading values of the list,
 * so winning pays ten whether eight or twelve turned up.
 *
 * The guest gets nothing: they are not in the championship. Their partner is
 * paid in full — they played and earned it.
 */
export function computeAwards(
  standings: PairStanding[],
  config: SeasonConfig,
  guestId: EntryId | null,
): Award[] {
  if (standings.length > config.points.length) {
    throw new Error(
      `La fecha tiene ${standings.length} parejas pero la lista de puntos sólo tiene ${config.points.length} valores.`,
    )
  }

  const awards: Award[] = []
  for (const row of standings) {
    const points = config.points[row.position - 1]
    if (points === undefined) {
      throw new Error(`No hay puntos definidos para la posición ${row.position}.`)
    }
    for (const entryId of [row.pair.a, row.pair.b]) {
      if (entryId === guestId) continue
      awards.push({ entryId, position: row.position, points })
    }
  }
  return awards
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test core/awards.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add core/awards.ts core/awards.test.ts
git commit -m "feat: award matchday points by pair position"
```

---

### Task 10: Ranking de temporada

**Files:**
- Create: `core/ranking.ts`
- Test: `core/ranking.test.ts`

**Interfaces:**
- Consumes: `orderByPoints` de `core/order.ts`; `Award`, `RankingRow`, `SeasonConfig`, `EntryId` de `core/types.ts`
- Produces: `computeRanking(awardsByMatchday: Map<number, Award[]>, squad: EntryId[], config: SeasonConfig, snapshot: EntryId[]): RankingRow[]`

**Qué NO hace esta tarea:** no calcula la tabla de la fecha, no construye la cadena de snapshots (recibe el vigente), no clasifica al Masters.

- [ ] **Step 1: Escribir los tests que fallan**

Create `core/ranking.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeRanking } from './ranking'
import type { Award, SeasonConfig } from './types'

const SQUAD = ['p1', 'p2', 'p3', 'p4']
const SNAPSHOT = ['p1', 'p2', 'p3', 'p4']

const CONFIG: SeasonConfig = {
  squadSize: 8,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
  points: [10, 6, 3, 1],
  regularMatchdays: 10,
  countBestOf: 3,
  mastersSize: 4,
  tiebreakSnapshotEvery: 3,
}

function award(entryId: string, points: number): Award {
  return { entryId, position: 1, points }
}

describe('computeRanking', () => {
  it('adds up every award when there are fewer matchdays than countBestOf', () => {
    const awards = new Map([
      [1, [award('p1', 10)]],
      [2, [award('p1', 6)]],
    ])
    const rows = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(rows.find((row) => row.entryId === 'p1')?.points).toBe(16)
  })

  it('keeps only the best countBestOf results', () => {
    const awards = new Map([
      [1, [award('p1', 10)]],
      [2, [award('p1', 1)]],
      [3, [award('p1', 6)]],
      [4, [award('p1', 3)]],
    ])
    const row = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT).find((r) => r.entryId === 'p1')
    expect(row?.points).toBe(19) // 10 + 6 + 3, dropping the 1
    expect(row?.counted).toEqual([10, 6, 3])
    expect(row?.discarded).toEqual([1])
  })

  it('gives a player with no awards zero points', () => {
    const rows = computeRanking(new Map(), SQUAD, CONFIG, SNAPSHOT)
    expect(rows.every((row) => row.points === 0)).toBe(true)
    expect(rows).toHaveLength(4)
  })

  it('includes every squad member even if they never played', () => {
    const awards = new Map([[1, [award('p1', 10)]]])
    const rows = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(rows.map((row) => row.entryId).sort()).toEqual([...SQUAD].sort())
  })

  it('ignores awards from anyone outside the squad, like a guest', () => {
    const awards = new Map([[1, [award('p1', 10), award('guest', 10)]]])
    const rows = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(rows.map((row) => row.entryId)).not.toContain('guest')
  })

  it('sorts by points, highest first', () => {
    const awards = new Map([
      [1, [award('p1', 1), award('p2', 10), award('p3', 6)]],
    ])
    const rows = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(rows.map((row) => row.entryId)).toEqual(['p2', 'p3', 'p1', 'p4'])
  })

  it('breaks ties with the snapshot', () => {
    const awards = new Map([[1, [award('p3', 10), award('p2', 10)]]])
    const rows = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(rows[0]?.entryId).toBe('p2')
    expect(rows[1]?.entryId).toBe('p3')
  })

  it('sums two awards from the same matchday, which should not happen but must not silently drop one', () => {
    const awards = new Map([[1, [award('p1', 10), award('p1', 6)]]])
    const row = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT).find((r) => r.entryId === 'p1')
    expect(row?.counted.length).toBe(2)
  })

  it('is deterministic', () => {
    const awards = new Map([[1, [award('p1', 10), award('p2', 10)]]])
    const first = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT)
    const second = computeRanking(awards, SQUAD, CONFIG, SNAPSHOT)
    expect(first).toEqual(second)
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test core/ranking.test.ts`
Expected: FAIL — `Failed to resolve import "./ranking"`.

- [ ] **Step 3: Escribir la implementación**

Create `core/ranking.ts`:

```typescript
import { orderByPoints } from './order'
import type { Award, EntryId, RankingRow, SeasonConfig } from './types'

/**
 * The season table. Only each player's best countBestOf results count, so
 * missing a date or two does not knock anyone out of the race.
 *
 * Anyone outside the squad is ignored: guests collect no awards, and awards
 * that name them are dropped here as a second line of defence.
 */
export function computeRanking(
  awardsByMatchday: Map<number, Award[]>,
  squad: EntryId[],
  config: SeasonConfig,
  snapshot: EntryId[],
): RankingRow[] {
  const inSquad = new Set(squad)
  const collected = new Map<EntryId, number[]>(squad.map((id) => [id, []]))

  for (const awards of awardsByMatchday.values()) {
    for (const award of awards) {
      if (!inSquad.has(award.entryId)) continue
      collected.get(award.entryId)?.push(award.points)
    }
  }

  const rows = new Map<EntryId, RankingRow>()
  for (const entryId of squad) {
    const all = [...(collected.get(entryId) ?? [])].sort((left, right) => right - left)
    const counted = all.slice(0, config.countBestOf)
    const discarded = all.slice(config.countBestOf)
    rows.set(entryId, {
      entryId,
      points: counted.reduce((sum, value) => sum + value, 0),
      counted,
      discarded,
    })
  }

  const points = new Map([...rows].map(([entryId, row]) => [entryId, row.points]))
  return orderByPoints(squad, points, snapshot).map((entryId) => {
    const row = rows.get(entryId)
    if (row === undefined) {
      throw new Error(`Falta la fila del ranking de ${entryId}.`)
    }
    return row
  })
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test core/ranking.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add core/ranking.ts core/ranking.test.ts
git commit -m "feat: compute season ranking with best N of M"
```

---

### Task 11: Cadena de snapshots

**Files:**
- Create: `core/snapshots.ts`
- Test: `core/snapshots.test.ts`

**Interfaces:**
- Consumes: `computeRanking` de `core/ranking.ts`; `Award`, `SeasonConfig`, `EntryId` de `core/types.ts`
- Produces: `snapshotForMatchday(matchdayNumber: number, seedOrder: EntryId[], awardsByMatchday: Map<number, Award[]>, config: SeasonConfig): EntryId[]`

**Qué NO hace esta tarea:** no persiste snapshots — se recalculan siempre desde los awards y el orden inicial. No calcula la tabla ni reparte puntos.

**La regla, del spec 2.1.1:**

```
snapshot(0) = orden inicial consensuado por el grupo
snapshot(i) = ranking al cierre de la fecha i*k, desempatado con snapshot(i-1)

el vigente en la fecha f  =  snapshot( floor((f-1) / k) )
```

Con `k = 3`: fechas 1-3 usan el snapshot 0, fechas 4-6 el snapshot 1, fechas 7-9 el 2, la 10 el 3.

- [ ] **Step 1: Escribir los tests que fallan**

Create `core/snapshots.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { snapshotForMatchday } from './snapshots'
import type { Award, SeasonConfig } from './types'

const SEED = ['p1', 'p2', 'p3', 'p4']

const CONFIG: SeasonConfig = {
  squadSize: 8,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
  points: [10, 6, 3, 1],
  regularMatchdays: 10,
  countBestOf: 10,
  mastersSize: 4,
  tiebreakSnapshotEvery: 3,
}

function award(entryId: string, points: number): Award {
  return { entryId, position: 1, points }
}

describe('snapshotForMatchday', () => {
  it('uses the seed order for the first k matchdays', () => {
    const awards = new Map([[1, [award('p4', 10)]]])
    for (const matchday of [1, 2, 3]) {
      expect(snapshotForMatchday(matchday, SEED, awards, CONFIG)).toEqual(SEED)
    }
  })

  it('refreshes from the table at the close of matchday k', () => {
    const awards = new Map([
      [1, [award('p4', 10)]],
      [2, [award('p4', 10)]],
      [3, [award('p4', 10)]],
    ])
    expect(snapshotForMatchday(4, SEED, awards, CONFIG)[0]).toBe('p4')
  })

  it('keeps the same snapshot across a whole block of k matchdays', () => {
    const awards = new Map([[1, [award('p4', 10)]], [2, [award('p4', 10)]], [3, [award('p4', 10)]]])
    const fourth = snapshotForMatchday(4, SEED, awards, CONFIG)
    expect(snapshotForMatchday(5, SEED, awards, CONFIG)).toEqual(fourth)
    expect(snapshotForMatchday(6, SEED, awards, CONFIG)).toEqual(fourth)
  })

  it('only counts matchdays up to the cut, ignoring later ones', () => {
    const awards = new Map([
      [1, [award('p4', 10)]],
      [2, [award('p4', 10)]],
      [3, [award('p4', 10)]],
      [4, [award('p1', 10)]],
      [5, [award('p1', 10)]],
    ])
    // The snapshot for matchday 5 is the table at the close of matchday 3.
    expect(snapshotForMatchday(5, SEED, awards, CONFIG)[0]).toBe('p4')
  })

  it('always returns a total order: no player appears twice', () => {
    const awards = new Map([[1, [award('p1', 10), award('p2', 10), award('p3', 10), award('p4', 10)]]])
    const snapshot = snapshotForMatchday(4, SEED, awards, CONFIG)
    expect(new Set(snapshot).size).toBe(SEED.length)
  })

  it('orders a pair that always ties, because the previous snapshot already did', () => {
    // p3 and p4 win everything together: identical points, every single matchday.
    const awards = new Map([
      [1, [award('p3', 10), award('p4', 10)]],
      [2, [award('p3', 10), award('p4', 10)]],
      [3, [award('p3', 10), award('p4', 10)]],
    ])
    const snapshot = snapshotForMatchday(4, SEED, awards, CONFIG)
    expect(snapshot.indexOf('p3')).toBeLessThan(snapshot.indexOf('p4'))
  })

  it('includes every squad member', () => {
    const snapshot = snapshotForMatchday(7, SEED, new Map(), CONFIG)
    expect([...snapshot].sort()).toEqual([...SEED].sort())
  })

  it('reproduces the same snapshot when an old matchday is recalculated', () => {
    const awards = new Map([[1, [award('p4', 10)]], [2, [award('p4', 10)]], [3, [award('p4', 10)]]])
    const first = snapshotForMatchday(4, SEED, awards, CONFIG)
    const again = snapshotForMatchday(4, SEED, awards, CONFIG)
    expect(again).toEqual(first)
  })

  it('follows the chain across several refreshes', () => {
    const awards = new Map([
      [1, [award('p4', 10)]], [2, [award('p4', 10)]], [3, [award('p4', 10)]],
      [4, [award('p3', 10)]], [5, [award('p3', 10)]], [6, [award('p3', 10)]],
    ])
    expect(snapshotForMatchday(7, SEED, awards, CONFIG)[0]).toBe('p4') // 30 vs 30, seed cuts
    expect(snapshotForMatchday(7, SEED, awards, CONFIG)).toHaveLength(4)
  })

  it('handles a refresh interval of one', () => {
    const everyMatchday = { ...CONFIG, tiebreakSnapshotEvery: 1 }
    const awards = new Map([[1, [award('p4', 10)]]])
    expect(snapshotForMatchday(2, SEED, awards, everyMatchday)[0]).toBe('p4')
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test core/snapshots.test.ts`
Expected: FAIL — `Failed to resolve import "./snapshots"`.

- [ ] **Step 3: Escribir la implementación**

Create `core/snapshots.ts`:

```typescript
import { computeRanking } from './ranking'
import type { Award, EntryId, SeasonConfig } from './types'

/**
 * The tiebreak order in force for a given matchday.
 *
 * A snapshot stores positions, not points: it is a permutation of the squad,
 * and in a permutation no two players can share a place. That is why it always
 * cuts, and why no further criterion is needed underneath.
 *
 * Nothing is stored. The chain is rebuilt from the awards and the seed order
 * every time, which is what makes reopening an old matchday reproduce exactly
 * the order it had back then.
 */
export function snapshotForMatchday(
  matchdayNumber: number,
  seedOrder: EntryId[],
  awardsByMatchday: Map<number, Award[]>,
  config: SeasonConfig,
): EntryId[] {
  const every = config.tiebreakSnapshotEvery
  const refreshes = Math.floor((matchdayNumber - 1) / every)

  let snapshot = [...seedOrder]
  for (let step = 1; step <= refreshes; step++) {
    const closesAfter = step * every
    const upToCut = new Map(
      [...awardsByMatchday].filter(([number]) => number <= closesAfter),
    )
    // Each link is the table at that cut, tiebroken with the previous link.
    snapshot = computeRanking(upToCut, seedOrder, config, snapshot).map((row) => row.entryId)
  }
  return snapshot
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test core/snapshots.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add core/snapshots.ts core/snapshots.test.ts
git commit -m "feat: rebuild the tiebreak snapshot chain from awards"
```

---

### Task 12: Masters

**Files:**
- Create: `core/masters.ts`
- Test: `core/masters.test.ts`

**Interfaces:**
- Consumes: `MASTERS_SIZE` de `core/constants.ts`; `RankingRow`, `Pair`, `EntryId`, `MatchResult` de `core/types.ts`
- Produces:
  ```typescript
  type MastersFour = [EntryId, EntryId, EntryId, EntryId]
  function mastersQualifiers(ranking: RankingRow[]): MastersFour
  function mastersFixture(four: MastersFour): Array<{ pairA: Pair; pairB: Pair }>
  function mastersChampion(four: MastersFour, matches: MatchResult[]): EntryId
  ```

**Qué NO hace esta tarea:** no calcula el ranking anual (lo recibe), no reparte puntos, no maneja tamaños de Masters distintos de 4.

**El formato, del spec 2.7:**

```
Partido 1:   1º + 4º   vs   2º + 3º
Partido 2:   1º + 3º   vs   2º + 4º
Partido 3:   1º + 2º   vs   3º + 4º
```

Cada uno juega una vez con cada uno. El formato sólo admite dos desenlaces: alguien gana los 3, o tres empatan en 2 y uno queda en 0. El triple empate se corta por posición en el ranking anual.

- [ ] **Step 1: Escribir los tests que fallan**

Create `core/masters.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mastersQualifiers, mastersFixture, mastersChampion, type MastersFour } from './masters'
import type { MatchResult, Pair, RankingRow } from './types'

function row(entryId: string, points: number): RankingRow {
  return { entryId, points, counted: [points], discarded: [] }
}

const RANKING: RankingRow[] = [row('p1', 50), row('p2', 40), row('p3', 30), row('p4', 20), row('p5', 10)]
const FOUR: MastersFour = ['p1', 'p2', 'p3', 'p4']

function played(pairA: Pair, pairB: Pair, aWins: boolean): MatchResult {
  return {
    round: 1,
    pairA,
    pairB,
    sets: [aWins ? { gamesA: 4, gamesB: 1 } : { gamesA: 1, gamesB: 4 }],
  }
}

describe('mastersQualifiers', () => {
  it('takes the top four of the ranking', () => {
    expect(mastersQualifiers(RANKING)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('throws when fewer than four players finished the season', () => {
    expect(() => mastersQualifiers(RANKING.slice(0, 3))).toThrow(/4/)
  })

  it('trusts the ranking order, which already resolved its own ties', () => {
    const tied = [row('p2', 40), row('p1', 40), row('p3', 30), row('p4', 20)]
    expect(mastersQualifiers(tied)[0]).toBe('p2')
  })
})

describe('mastersFixture', () => {
  it('builds the three rotating matches', () => {
    const fixture = mastersFixture(FOUR)
    expect(fixture).toHaveLength(3)
    expect(fixture[0]).toEqual({ pairA: { a: 'p1', b: 'p4' }, pairB: { a: 'p2', b: 'p3' } })
    expect(fixture[1]).toEqual({ pairA: { a: 'p1', b: 'p3' }, pairB: { a: 'p2', b: 'p4' } })
    expect(fixture[2]).toEqual({ pairA: { a: 'p1', b: 'p2' }, pairB: { a: 'p3', b: 'p4' } })
  })

  it('has everyone partner everyone exactly once', () => {
    const partners = new Map<string, string[]>()
    for (const { pairA, pairB } of mastersFixture(FOUR)) {
      for (const pair of [pairA, pairB]) {
        partners.set(pair.a, [...(partners.get(pair.a) ?? []), pair.b])
        partners.set(pair.b, [...(partners.get(pair.b) ?? []), pair.a])
      }
    }
    for (const player of FOUR) {
      const seen = partners.get(player) ?? []
      expect(seen).toHaveLength(3)
      expect(new Set(seen).size).toBe(3)
      expect(seen).not.toContain(player)
    }
  })

  it('gives everyone three matches', () => {
    const played = new Map<string, number>()
    for (const { pairA, pairB } of mastersFixture(FOUR)) {
      for (const id of [pairA.a, pairA.b, pairB.a, pairB.b]) {
        played.set(id, (played.get(id) ?? 0) + 1)
      }
    }
    expect([...played.values()]).toEqual([3, 3, 3, 3])
  })
})

describe('mastersChampion', () => {
  it('crowns the player who won all three', () => {
    const fixture = mastersFixture(FOUR)
    // p1 is in pairA of every match, so pairA winning three times means p1 wins three.
    const matches = fixture.map((m) => played(m.pairA, m.pairB, true))
    expect(mastersChampion(FOUR, matches)).toBe('p1')
  })

  it('breaks a three-way tie with the annual ranking position', () => {
    const fixture = mastersFixture(FOUR)
    const [first, second, third] = fixture
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('bad test fixture')
    }
    // p4 loses all three, so p1, p2 and p3 all finish on two wins:
    //   match 1  (p1,p4) vs (p2,p3)  →  p2 and p3 win
    //   match 2  (p1,p3) vs (p2,p4)  →  p1 and p3 win
    //   match 3  (p1,p2) vs (p3,p4)  →  p1 and p2 win
    const matches = [
      played(first.pairA, first.pairB, false),
      played(second.pairA, second.pairB, true),
      played(third.pairA, third.pairB, true),
    ]
    // p1 was first in the annual ranking, so the tie goes their way.
    expect(mastersChampion(FOUR, matches)).toBe('p1')
  })

  it('prefers the better ranked player when two finish level', () => {
    const fixture = mastersFixture(FOUR)
    const first = fixture[0]
    if (first === undefined) throw new Error('bad test fixture')
    // Only one match played: p1 and p4 each on one win, everyone else on zero.
    // p1 is ranked first, so p1 takes it.
    const matches = [played(first.pairA, first.pairB, true)]
    expect(mastersChampion(FOUR, matches)).toBe('p1')
  })

  it('falls back to the ranking when nothing has been played', () => {
    expect(mastersChampion(FOUR, [])).toBe('p1')
  })

  it('ignores matches that have not been played', () => {
    const fixture = mastersFixture(FOUR)
    const first = fixture[0]
    if (first === undefined) throw new Error('bad test fixture')
    const matches: MatchResult[] = [{ round: 1, pairA: first.pairA, pairB: first.pairB, sets: [] }]
    expect(mastersChampion(FOUR, matches)).toBe('p1')
  })

  it('only ever produces a clean sweep or a three-way tie', () => {
    const fixture = mastersFixture(FOUR)
    for (let mask = 0; mask < 8; mask++) {
      const matches = fixture.map((m, i) => played(m.pairA, m.pairB, (mask & (1 << i)) !== 0))
      const wins = new Map<string, number>(FOUR.map((id) => [id, 0]))
      for (const match of matches) {
        const winner = match.sets[0] !== undefined && match.sets[0].gamesA > match.sets[0].gamesB
          ? match.pairA
          : match.pairB
        wins.set(winner.a, (wins.get(winner.a) ?? 0) + 1)
        wins.set(winner.b, (wins.get(winner.b) ?? 0) + 1)
      }
      const tally = [...wins.values()].sort((a, b) => b - a)
      // Verified over all eight possible outcomes: a clean sweep or a three-way
      // tie, never anything in between. This is why the head to head cannot cut.
      expect(['3,1,1,1', '2,2,2,0']).toContain(tally.join(','))
    }
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test core/masters.test.ts`
Expected: FAIL — `Failed to resolve import "./masters"`.

- [ ] **Step 3: Escribir la implementación**

Create `core/masters.ts`:

```typescript
import { MASTERS_SIZE } from './constants'
import type { EntryId, MatchResult, Pair, RankingRow } from './types'

export type MastersFour = [EntryId, EntryId, EntryId, EntryId]

/** The top four of the annual ranking, in ranking order. */
export function mastersQualifiers(ranking: RankingRow[]): MastersFour {
  if (ranking.length < MASTERS_SIZE) {
    throw new Error(`Hacen falta ${MASTERS_SIZE} jugadores para el Masters, hay ${ranking.length}.`)
  }
  const [first, second, third, fourth] = ranking
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined
  ) {
    throw new Error('El ranking no tiene suficientes filas para el Masters.')
  }
  return [first.entryId, second.entryId, third.entryId, fourth.entryId]
}

/**
 * Three matches with rotating partners, so everyone plays once with everyone.
 * This is what separates two players who spent the season winning together and
 * therefore finished on identical points.
 */
export function mastersFixture(four: MastersFour): Array<{ pairA: Pair; pairB: Pair }> {
  const [one, two, three, fourth] = four
  return [
    { pairA: { a: one, b: fourth }, pairB: { a: two, b: three } },
    { pairA: { a: one, b: three }, pairB: { a: two, b: fourth } },
    { pairA: { a: one, b: two }, pairB: { a: three, b: fourth } },
  ]
}

/**
 * The champion of the year.
 *
 * The format only allows two outcomes: someone wins all three, or three players
 * tie on two and one is left on zero. The head to head cannot break that tie —
 * everyone played with and against everyone — so the cut is the annual ranking:
 * finishing higher does not hand you the title, but it settles any tie in your
 * favour, which is what makes the regular season worth something.
 */
export function mastersChampion(four: MastersFour, matches: MatchResult[]): EntryId {
  const wins = new Map<EntryId, number>(four.map((id) => [id, 0]))
  const rank = new Map<EntryId, number>(four.map((id, index) => [id, index]))

  for (const match of matches) {
    if (match.sets.length === 0) continue
    let setsA = 0
    let setsB = 0
    for (const set of match.sets) {
      if (set.gamesA > set.gamesB) setsA++
      else if (set.gamesB > set.gamesA) setsB++
    }
    if (setsA === setsB) continue
    const winner = setsA > setsB ? match.pairA : match.pairB
    for (const id of [winner.a, winner.b]) {
      if (!wins.has(id)) continue
      wins.set(id, (wins.get(id) ?? 0) + 1)
    }
  }

  const OUTSIDE = Number.MAX_SAFE_INTEGER
  const champion = [...four].sort((left, right) => {
    const winDiff = (wins.get(right) ?? 0) - (wins.get(left) ?? 0)
    if (winDiff !== 0) return winDiff
    return (rank.get(left) ?? OUTSIDE) - (rank.get(right) ?? OUTSIDE)
  })[0]

  if (champion === undefined) {
    throw new Error('No se pudo determinar el campeón del Masters.')
  }
  return champion
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test core/masters.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add core/masters.ts core/masters.test.ts
git commit -m "feat: qualify, schedule and decide the masters"
```

---

### Task 13: La config contada en castellano

**Files:**
- Create: `core/narrate.ts`
- Test: `core/narrate.test.ts`

**Interfaces:**
- Consumes: `SeasonConfig` de `core/types.ts`
- Produces: `narrateRules(config: SeasonConfig): Array<{ title: string; body: string }>` — los bloques de la página de reglas generados desde la config.

**Qué NO hace esta tarea:** no renderiza HTML, no sanitiza el texto libre del admin (eso pasa en la capa de UI, plan 3), no lee de la base.

**Por qué existe:** si el admin escribiera a mano *"el campeón suma 10 puntos"* y después cambiara la config a 12, el texto quedaría mintiendo. Todo lo que la app puede derivar de la config, lo deriva.

- [ ] **Step 1: Escribir los tests que fallan**

Create `core/narrate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { narrateRules } from './narrate'
import type { SeasonConfig } from './types'

const CONFIG: SeasonConfig = {
  squadSize: 12,
  matchFormat: { setsToWin: 1, gamesPerSet: 4, tieBreak: true },
  points: [10, 7, 5, 3, 2, 1],
  regularMatchdays: 10,
  countBestOf: 8,
  mastersSize: 4,
  tiebreakSnapshotEvery: 3,
}

function bodyOf(config: SeasonConfig, title: string): string {
  const block = narrateRules(config).find((section) => section.title === title)
  if (block === undefined) throw new Error(`No hay bloque "${title}"`)
  return block.body
}

describe('narrateRules', () => {
  it('returns a block per topic', () => {
    const titles = narrateRules(CONFIG).map((section) => section.title)
    expect(titles).toEqual([
      'El torneo',
      'La fecha',
      'Los puntos',
      'Cómo se arman las parejas',
      'Los desempates',
      'El Masters',
    ])
  })

  it('states how many matchdays there are and how many count', () => {
    const body = bodyOf(CONFIG, 'El torneo')
    expect(body).toContain('10 fechas')
    expect(body).toContain('8 mejores')
  })

  it('describes the match format from the config', () => {
    expect(bodyOf(CONFIG, 'La fecha')).toContain('4 games')
  })

  it('lists every points value', () => {
    const body = bodyOf(CONFIG, 'Los puntos')
    for (const value of CONFIG.points) {
      expect(body).toContain(String(value))
    }
  })

  it('follows the config when the points change, instead of a stale copy', () => {
    const richer = { ...CONFIG, points: [12, 9, 6, 4, 2, 1] }
    const body = bodyOf(richer, 'Los puntos')
    expect(body).toContain('el 1º, 12')
    expect(body).not.toContain('el 1º, 10')
  })

  it('states the snapshot refresh interval', () => {
    expect(bodyOf(CONFIG, 'Los desempates')).toContain('3 fechas')
  })

  it('states the masters size', () => {
    expect(bodyOf(CONFIG, 'El Masters')).toContain('4 mejores')
  })

  it('describes a multi-set format when configured that way', () => {
    const bestOfThree = {
      ...CONFIG,
      matchFormat: { setsToWin: 2, gamesPerSet: 6, tieBreak: true },
    }
    expect(bodyOf(bestOfThree, 'La fecha')).toContain('6 games')
  })

  it('never leaves a placeholder in the output', () => {
    for (const section of narrateRules(CONFIG)) {
      expect(section.body).not.toMatch(/undefined|NaN|\{\{/)
      expect(section.body.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test core/narrate.test.ts`
Expected: FAIL — `Failed to resolve import "./narrate"`.

- [ ] **Step 3: Escribir la implementación**

Create `core/narrate.ts`:

```typescript
import { MAX_PLAYERS, MIN_PLAYERS } from './constants'
import type { SeasonConfig } from './types'

export interface RulesSection {
  title: string
  body: string
}

/**
 * The rules page, told from the config.
 *
 * Everything the app can derive, it derives. If the admin wrote "the winner
 * takes 10 points" by hand and then changed the config to 12, the page would
 * be lying — and a rules page that disagrees with the app is worse than none.
 *
 * The output is in Spanish because the group reads it.
 */
export function narrateRules(config: SeasonConfig): RulesSection[] {
  const { points, matchFormat, regularMatchdays, countBestOf, tiebreakSnapshotEvery, mastersSize } =
    config

  return [
    {
      title: 'El torneo',
      body:
        `El campeonato son ${regularMatchdays} fechas. Para cada jugador cuentan sus ` +
        `${countBestOf} mejores resultados, así que se puede faltar alguna vez sin quedar ` +
        `afuera de la pelea. El año cierra con un Masters entre los ${mastersSize} mejores.`,
    },
    {
      title: 'La fecha',
      body:
        `Cada fecha la juegan los que confirman, entre ${MIN_PLAYERS} y ${MAX_PLAYERS}. ` +
        `Se arman parejas con todos y juegan todos contra todos. ` +
        describeFormat(matchFormat) +
        ` Si el número de confirmados da impar, se suma un invitado para poder armar las parejas: ` +
        `el invitado no suma puntos, pero su compañero sí.`,
    },
    {
      title: 'Los puntos',
      body:
        `Los dos integrantes de una pareja suman siempre lo mismo, según dónde terminó la pareja: ` +
        points.map((value, index) => `${ordinal(index + 1)}, ${value}`).join('; ') +
        `. Cuando juegan menos parejas se usan los primeros valores, así ganar la fecha ` +
        `siempre suma ${points[0] ?? 0}. Nadie suma 0 por presentarse: si salir último diera ` +
        `lo mismo que faltar, convendría faltar.`,
    },
    {
      title: 'Cómo se arman las parejas',
      body:
        `Las parejas se arman con la tabla del campeonato: se ordena a los presentes por puntos ` +
        `y se junta al primero con el último, al segundo con el anteúltimo, y así. ` +
        `Ninguna pareja se repite dos fechas seguidas, con una sola excepción: la pareja que ` +
        `gana una fecha se mantiene junta en la siguiente. Después se separa, gane o pierda, ` +
        `así que toda pareja campeona juega exactamente 2 fechas junta.`,
    },
    {
      title: 'Los desempates',
      body:
        `En la tabla de la fecha, si dos parejas ganan la misma cantidad de partidos, corta la ` +
        `diferencia de games, después el partido entre ellas. ` +
        `En la tabla del campeonato, si dos jugadores tienen los mismos puntos corta el orden ` +
        `de desempate: una lista del mejor al peor que arranca en el orden que consensuó el ` +
        `grupo y se actualiza cada ${tiebreakSnapshotEvery} fechas con la tabla de ese momento.`,
    },
    {
      title: 'El Masters',
      body:
        `Los ${mastersSize} mejores del año juegan una jornada final de 3 partidos con ` +
        `compañeros rotativos: cada uno juega una vez con cada uno. Se cuentan los partidos ` +
        `ganados de forma individual. Si hay empate, gana el que llegó mejor posicionado en el ` +
        `ranking anual.`,
    },
  ]
}

function describeFormat(format: SeasonConfig['matchFormat']): string {
  const setWord = format.setsToWin === 1 ? 'un set' : `${format.setsToWin} sets ganados`
  const tie = format.tieBreak ? ' con tie-break' : ''
  return `Cada partido se define a ${setWord} de ${format.gamesPerSet} games${tie}.`
}

function ordinal(position: number): string {
  const words: Record<number, string> = {
    1: 'el 1º',
    2: 'el 2º',
    3: 'el 3º',
    4: 'el 4º',
    5: 'el 5º',
    6: 'el 6º',
  }
  return words[position] ?? `el ${position}º`
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test core/narrate.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add core/narrate.ts core/narrate.test.ts
git commit -m "feat: narrate the season rules from the config"
```

---

### Task 14: Una fecha entera, de punta a punta

**Files:**
- Create: `core/matchday.test.ts`
- Modify: ninguno

**Interfaces:**
- Consumes: todo lo anterior
- Produces: nada de código nuevo. Es la red de seguridad que prueba que las piezas encajan.

**Qué NO hace esta tarea:** no agrega funciones ni refactoriza. Si un test de acá falla, se arregla el módulo que corresponde — no se escribe un módulo nuevo de "orquestación". Esa orquestación vive en la capa de datos, plan 2.

- [ ] **Step 1: Escribir el test de integración**

Create `core/matchday.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildPairs } from './pairing'
import { buildFixture } from './fixture'
import { computeStandings } from './standings'
import { computeAwards } from './awards'
import { computeRanking } from './ranking'
import { snapshotForMatchday } from './snapshots'
import { defaultConfig } from './config'
import type { Award, MatchResult, Pair, SeasonConfig } from './types'

const SQUAD = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']
const CONFIG: SeasonConfig = defaultConfig(8)

/** Plays a whole matchday: pairs, fixture, results, table, points. */
function playMatchday(
  present: string[],
  points: Map<string, number>,
  snapshot: string[],
  previousPairs: Pair[],
  defenders: Pair | null,
  defendersAlreadyRepeated: boolean,
  config: SeasonConfig,
): { pairs: Pair[]; awards: Award[]; champion: Pair } {
  const pairs = buildPairs({
    present,
    points,
    snapshot,
    defenders,
    defendersAlreadyRepeated,
    previousPairs,
    guestId: null,
  })

  const fixture = buildFixture(pairs.length)
  const matches: MatchResult[] = []
  let round = 1
  for (const roundMatches of fixture) {
    for (const [left, right] of roundMatches) {
      const pairA = pairs[left]
      const pairB = pairs[right]
      if (pairA === undefined || pairB === undefined) continue
      // Lower index wins, so results are deterministic and the table is spread out.
      matches.push({ round, pairA, pairB, sets: [{ gamesA: 4, gamesB: left < right ? 1 : 2 }] })
    }
    round++
  }

  const standings = computeStandings(pairs, matches, config, snapshot)
  const awards = computeAwards(standings, config, null)
  const winner = standings[0]
  if (winner === undefined) throw new Error('la fecha no produjo tabla')
  return { pairs, awards, champion: winner.pair }
}

describe('a full matchday, end to end', () => {
  it('runs eight players from pairs to points', () => {
    const { pairs, awards } = playMatchday(
      SQUAD, new Map(), SQUAD, [], null, false, CONFIG,
    )
    expect(pairs).toHaveLength(4)
    expect(awards).toHaveLength(8)
    expect(awards.every((award) => award.points > 0)).toBe(true)
  })

  it('gives both members of every pair the same points', () => {
    const { pairs, awards } = playMatchday(SQUAD, new Map(), SQUAD, [], null, false, CONFIG)
    const byEntry = new Map(awards.map((award) => [award.entryId, award.points]))
    for (const pair of pairs) {
      expect(byEntry.get(pair.a)).toBe(byEntry.get(pair.b))
    }
  })

  it('runs twelve players just as happily', () => {
    const twelve = [...SQUAD, 'p9', 'p10', 'p11', 'p12']
    const config = defaultConfig(12)
    const { pairs, awards } = playMatchday(twelve, new Map(), twelve, [], null, false, config)
    expect(pairs).toHaveLength(6)
    expect(awards).toHaveLength(12)
  })

  it('keeps the champions together for exactly two matchdays', () => {
    const first = playMatchday(SQUAD, new Map(), SQUAD, [], null, false, CONFIG)
    const pointsAfterFirst = tally([first.awards])

    const second = playMatchday(
      SQUAD, pointsAfterFirst, SQUAD, first.pairs, first.champion, false, CONFIG,
    )
    expect(second.pairs.some((pair) => sameAs(pair, first.champion))).toBe(true)

    const pointsAfterSecond = tally([first.awards, second.awards])
    const third = playMatchday(
      SQUAD, pointsAfterSecond, SQUAD, second.pairs, first.champion, true, CONFIG,
    )
    expect(third.pairs.some((pair) => sameAs(pair, first.champion))).toBe(false)
  })

  it('never repeats a pair from the immediately previous matchday', () => {
    let previousPairs: Pair[] = []
    let points = new Map<string, number>()
    const everyAward: Award[][] = []

    for (let matchday = 1; matchday <= 6; matchday++) {
      const snapshot = snapshotForMatchday(
        matchday, SQUAD, new Map(everyAward.map((a, i) => [i + 1, a])), CONFIG,
      )
      const result = playMatchday(SQUAD, points, snapshot, previousPairs, null, false, CONFIG)
      for (const built of result.pairs) {
        expect(previousPairs.some((old) => sameAs(old, built))).toBe(false)
      }
      previousPairs = result.pairs
      everyAward.push(result.awards)
      points = tally(everyAward)
    }
  })

  it('builds a ranking that adds up across a whole season', () => {
    const everyAward: Award[][] = []
    let previousPairs: Pair[] = []
    let points = new Map<string, number>()

    for (let matchday = 1; matchday <= 10; matchday++) {
      const snapshot = snapshotForMatchday(
        matchday, SQUAD, new Map(everyAward.map((a, i) => [i + 1, a])), CONFIG,
      )
      const result = playMatchday(SQUAD, points, snapshot, previousPairs, null, false, CONFIG)
      previousPairs = result.pairs
      everyAward.push(result.awards)
      points = tally(everyAward)
    }

    const awardsByMatchday = new Map(everyAward.map((awards, i) => [i + 1, awards]))
    const snapshot = snapshotForMatchday(11, SQUAD, awardsByMatchday, CONFIG)
    const ranking = computeRanking(awardsByMatchday, SQUAD, CONFIG, snapshot)

    expect(ranking).toHaveLength(8)
    expect(new Set(ranking.map((row) => row.entryId)).size).toBe(8)
    for (const row of ranking) {
      expect(row.counted.length).toBe(CONFIG.countBestOf)
      expect(row.discarded.length).toBe(10 - CONFIG.countBestOf)
    }
    for (let i = 1; i < ranking.length; i++) {
      const above = ranking[i - 1]
      const below = ranking[i]
      if (above === undefined || below === undefined) continue
      expect(above.points).toBeGreaterThanOrEqual(below.points)
    }
  })

  it('replays a whole season identically', () => {
    const run = () => {
      const everyAward: Award[][] = []
      let previousPairs: Pair[] = []
      let points = new Map<string, number>()
      for (let matchday = 1; matchday <= 5; matchday++) {
        const snapshot = snapshotForMatchday(
          matchday, SQUAD, new Map(everyAward.map((a, i) => [i + 1, a])), CONFIG,
        )
        const result = playMatchday(SQUAD, points, snapshot, previousPairs, null, false, CONFIG)
        previousPairs = result.pairs
        everyAward.push(result.awards)
        points = tally(everyAward)
      }
      return everyAward
    }
    expect(run()).toEqual(run())
  })
})

function tally(rounds: Award[][]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const awards of rounds) {
    for (const award of awards) {
      totals.set(award.entryId, (totals.get(award.entryId) ?? 0) + award.points)
    }
  }
  return totals
}

function sameAs(left: Pair, right: Pair): boolean {
  return (left.a === right.a && left.b === right.b) || (left.a === right.b && left.b === right.a)
}
```

- [ ] **Step 2: Correr todos los tests**

Run: `npm test`
Expected: PASS — toda la suite, incluidos los 7 nuevos.

Si alguno falla, el bug está en el módulo que corresponda, no en este archivo. Arreglalo ahí.

- [ ] **Step 3: Verificar los tipos**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add core/matchday.test.ts
git commit -m "test: run a full season end to end through core"
```

---

## Aparecidos

Cosas que salieron durante la implementación y **no** se hicieron, para no ensanchar las tareas. Anotalas acá con una línea y seguí.

- _(vacío al empezar)_

---

## Qué queda afuera de este plan, a propósito

Todo esto está en el spec y **no** se implementa acá. Va en los planes 2 a 4.

| Fuera de alcance | Dónde va |
|---|---|
| Schema de Supabase, migraciones, RLS | Plan 2 |
| Auth: email y contraseña, Google, reclamo de asiento | Plan 2 |
| Validar resultados contra `matchFormat` al guardar | Plan 2 (es validación de borde, no de dominio) |
| **Derivar el contexto de la fecha anterior** (quiénes son los defensores, si ya repitieron, qué parejas hubo) | Plan 2 — **hueco encontrado en la revisión final.** El spec 3.3 dice que quién es la pareja defensora se **deriva siempre, nunca se guarda**. Pero `buildPairs` los recibe por parámetro y nada en `core/` los calcula. Si eso termina implementado en la capa de Supabase, la regla del campeón defensor —el diferencial del formato— queda fuera del núcleo probado. Va como función pura en `core/`, no en el acceso a datos. |
| **La tabla de puntos que arma las parejas es el ranking (mejores N), no la suma cruda** | Plan 2 — **ambigüedad encontrada en la revisión final.** El spec 2.5 paso 4 dice "ordenar el pool por la tabla de puntos", y la tabla aplica mejores N de M (2.1). `snapshots.ts` lo hace bien (pasa por `computeRanking`); el harness de integración usa una suma cruda. Con `countBestOf: 8` de 10 fechas, desde la fecha 9 divergen. Plan 2 tiene que usar el ranking. |
| **¿Uno o varios invitados por fecha?** | Plan 2 — **decisión pendiente.** `core/` toma un `guestId` único; el schema de 3.2 modela invitados como filas `entries` con `kind = GUEST` y no limita la cantidad. O el schema lo restringe con un unique, o las firmas pasan a tomar un conjunto. Decidirlo ahora que es un cambio de firma y no una migración. |
| **Racha de defensas como estadística** | Plan 3 — el spec 2.4 dice que la racha se guarda como estadística, no como puntos. Ningún módulo la calcula y no estaba deferida. Va con la pantalla de Estadísticas. |
| **Mover al invitado en el orden** | Plan 4 — el spec 2.6 dice que el admin puede moverlo si conoce al tipo. `core/` lo pone último y acepta el orden que le den; la UI tiene que ofrecer el arrastre. |
| **Llamar a `validateConfig` en el borde, siempre** | Plan 2 — **requisito descubierto revisando la Task 11.** `validateConfig` **devuelve** errores, no los tira, así que sólo protege a quien los mira. Con `tiebreakSnapshotEvery = 0`, `Math.floor((f-1)/0)` da `Infinity` y `snapshotForMatchday` **entra en un loop infinito** en vez de fallar. No se agrega un guard dentro de `core/` — el contrato es que la config se valida antes de entrar. Pero ese contrato tiene que ser una decisión explícita del borde, no un supuesto. |
| **Rechazar un set con games iguales** (ej. `4-4`) | Plan 2 — **requisito descubierto revisando la Task 8.** `SetScore` sólo guarda `gamesA`/`gamesB`, así que un set empatado no suma para nadie: la pareja juega, no gana, y el head-to-head devuelve 0. Es un empate silencioso en un deporte que no tiene empates. `core/standings.ts` hace lo correcto al no inventar un ganador; **el borde tiene que impedir que ese dato entre.** |
| Cerrar la fecha en una transacción | Plan 2 |
| Reabrir una fecha cerrada | Plan 2 |
| Sanitizar el markdown del admin | Plan 3 |
| Las 13 pantallas | Planes 3 y 4 |
| Decidir el tamaño de la fecha desde las asistencias | Plan 4 (es flujo de UI; `core` recibe los presentes ya resueltos) |
| Elegir a quién reemplaza el invitado | No existe: el invitado es un lugar extra, no un reemplazo |

## Criterio de terminado

- [ ] `npm test` en verde, sin tests saltados
- [ ] `npm run typecheck` sin errores
- [ ] Ningún archivo de `core/` importa nada fuera de `core/`
- [ ] Ningún archivo de `core/` usa `Date`, `Math.random`, `fetch` ni `process`
- [ ] La sección "Aparecidos" está revisada y lo que valga la pena quedó como tarea de otro plan
