# Historial entre amigos — Plan 2a: el partido de torneo, con su detalle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el perfil de un amigo liste cada partido que jugaron —con fecha, torneo, resultado y marcador— en vez de mostrar dos contadores.

**Architecture:** Ninguna tabla nueva y **ninguna migración**. Los datos ya están: `matchdays.played_on` tiene la fecha y `match_sets` el marcador. `historyWith` pasa de una consulta a tres, todas acotadas, y la regla de quién ganó se **extrae** de `computeStandings` a una función pura de `core/` en vez de copiarse.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5.7 strict, Supabase (RLS), Tailwind v4, vitest.

**Spec:** `docs/historial-entre-amigos.md` — **§4.4 manda sobre esta rebanada.** El plan discute contra ese documento; quien ejecute lee los dos.

## Global Constraints

- **TDD estricto.** El test que falla va primero y hay que **verlo fallar** por el motivo correcto.
- **Los cuatro gates, en cada tarea:** `npm test` · `npm run test:db` · `npm run typecheck` · `npm run build`.
- `db/test/env.ts` se niega a correr la suite de base si la URL no es local. **Nunca se puentea.**
- **Los tests que ejercitan permisos van por cliente autenticado**, nunca `adminClient()` — `service_role` saltea RLS por diseño. En el plan 1 ese error dejó pasar dos agujeros Critical con los cuatro gates en verde.
- **PostgREST corta cada select en `max_rows = 1000` SIN avisar** (`supabase/config.toml:18`). La lección está en `db/read.ts:341-348` y el guard ya vive en `db/friends.ts`. **Cada consulta nueva de este plan necesita el suyo.**
- `season_public_rules` (`0007`/`0022`) está viva en producción. No se toca.
- **Esta rebanada no agrega ninguna migración.** Si te parece que hace falta una, parate y reportalo: es señal de que el plan está mal, no de que falte una tabla.
- Fuera de alcance: los partidos casuales (plan 2b), y los amigos sin cuenta y el mapeo (plan 3).

---

## Estructura de archivos

| archivo | responsabilidad |
|---|---|
| `core/standings.ts` | **modificar** — extraer la regla de quién ganó a una función exportada |
| `core/index.ts` | **modificar** — exportarla |
| `core/standings.test.ts` | **modificar** — tests de la función extraída |
| `db/friends.ts` | **modificar** — `SharedMatch` con detalle; `historyWith` en tres consultas |
| `db/friends.db.test.ts` | **modificar** — el detalle verificado contra la base |
| `app/amigos/historial.tsx` | **reescribir** — la lista cronológica |
| `app/amigos/historial.unit.test.ts` | **reescribir** — sus fixtures cambian de forma |

---

### Task 1: La regla de quién ganó, extraída y no copiada

**Files:**
- Modify: `core/standings.ts:126-153` (el loop de `computeStandings`)
- Modify: `core/index.ts`
- Modify: `core/standings.test.ts`

**Interfaces:**
- Produces: `export function tallySets(sets: readonly SetScore[]): { setsA: number; setsB: number; gamesA: number; gamesB: number }` en `core/standings.ts`, exportada por `core/index.ts`.
- Consumes: nada nuevo.

**Por qué extraer y no copiar.** `db/friends.ts` necesita saber quién ganó un partido. Esa regla ya existe, inline, adentro del loop de `computeStandings` (`core/standings.ts:131-142`): se cuentan los sets ganados por lado —gana el set quien hizo más games— y gana el partido quien ganó más sets; iguales es empate.

El propio archivo documenta a dónde lleva copiarla. `core/standings.ts:18`: *"Eran TRES copias de `setsToWin > 1` en tres lugares"*. Una segunda opinión sobre quién ganó un partido es la peor clase de deriva: las dos pantallas se ven bien y dicen cosas distintas.

**Esto NO cambia comportamiento.** Es un refactor puro: `computeStandings` tiene que seguir dando exactamente lo mismo, y sus tests actuales son el pin que lo prueba.

- [ ] **Step 1: Correr la suite de `core/` ANTES de tocar nada, y anotar el número**

Run: `npx vitest run core/standings.test.ts`
Anotá cuántos pasan. Ese número no puede bajar ni subir al terminar esta tarea: es un refactor.

- [ ] **Step 2: Write the failing test**

En `core/standings.test.ts`:

```typescript
import { tallySets } from './standings'

describe('tallySets', () => {
  it('cuenta el set para quien hizo más games, y suma los games de los dos', () => {
    expect(tallySets([{ gamesA: 6, gamesB: 3 }])).toEqual({
      setsA: 1, setsB: 0, gamesA: 6, gamesB: 3,
    })
  })

  it('con dos sets repartidos no gana nadie el partido, y los games se acumulan', () => {
    expect(tallySets([{ gamesA: 6, gamesB: 4 }, { gamesA: 2, gamesB: 6 }])).toEqual({
      setsA: 1, setsB: 1, gamesA: 8, gamesB: 10,
    })
  })

  it('un set igualado no le suma a ninguno de los dos', () => {
    // Con marcador abierto y empate permitido esto es un resultado guardable
    // (0034 condicionó `match_sets_no_draw` a `allows_draw`).
    expect(tallySets([{ gamesA: 2, gamesB: 2 }])).toEqual({
      setsA: 0, setsB: 0, gamesA: 2, gamesB: 2,
    })
  })

  it('sin sets no cuenta nada', () => {
    expect(tallySets([])).toEqual({ setsA: 0, setsB: 0, gamesA: 0, gamesB: 0 })
  })
})
```

> El nombre exacto del tipo del set (`SetScore` arriba) hay que tomarlo de `core/types.ts` — **leelo antes de escribir la firma**, no inventes uno.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run core/standings.test.ts -t tallySets`
Expected: FAIL — `tallySets is not a function`.

- [ ] **Step 4: Extraer la función y usarla en `computeStandings`**

Sacá las cuatro variables y el loop interno de `computeStandings` a `tallySets`, y hacé que `computeStandings` la llame. **El cuerpo del loop de `computeStandings` no cambia de significado**: sigue sumando `setsWon`/`setsLost`/`gamesWon`/`gamesLost` y decidiendo `won`/`drawn` con los mismos comparadores.

Dejá un comentario en `tallySets` que diga que es la única definición de "quién ganó un set" en el proyecto, y por qué (el precedente de las tres copias, `core/standings.ts:18`).

Exportala en `core/index.ts` — `db/` sólo puede importar de ahí.

- [ ] **Step 5: Run tests to verify**

Run: `npx vitest run core/`
Expected: los 4 tests nuevos en verde, **y el número de Step 1 exactamente igual**. Si un test de `computeStandings` cambió de resultado, el refactor cambió comportamiento: volvé atrás.

- [ ] **Step 6: Verificar la pureza de `core/`**

Run: `rg -n 'from .\.\./|from .@/' core/standings.ts core/index.ts`
Expected: sin resultados. `core/` no importa nada de afuera.

- [ ] **Step 7: Four gates and commit**

```bash
npm test && npm run test:db && npm run typecheck && npm run build
git add core/standings.ts core/index.ts core/standings.test.ts
git commit -m "refactor(core): quién ganó un set queda en un solo lugar"
```

---

### Task 2: `historyWith` trae el detalle

**Files:**
- Modify: `db/friends.ts`
- Modify: `db/friends.db.test.ts`

**Interfaces:**
- Consumes: `tallySets` de `@/core` (Task 1), la vista `match_participants` (`0071`), `my_player_id()`.
- Produces:

```typescript
export interface SharedMatch {
  matchId: string
  matchdayId: string
  /** `true` si jugaron del mismo lado; `false` si se enfrentaron. */
  together: boolean
  /** `matchdays.played_on`. `null` si la fecha no lo tiene cargado. */
  playedOn: string | null
  /** El número de fecha, para ordenar cuando `playedOn` es null. */
  matchdayNumber: number
  /** `'REGULAR'` o `'MASTERS'`. */
  matchdayKind: string
  /** El nombre del torneo, para que la fila diga de dónde salió. */
  seasonName: string
  /**
   * Qué te pasó A VOS en ese partido. `null` cuando todavía no se cargó el
   * resultado — una fecha abierta tiene partidos sin sets.
   */
  outcome: 'won' | 'lost' | 'drew' | null
  /** Games tuyos y del otro lado, en el orden en que los mira quien consulta. */
  score: { mine: number; theirs: number } | null
}
```

**`together` y `outcome` conviven, y no se pisan.** Si jugaron de compañeros, `outcome` es lo que le pasó a **la pareja de los dos**; si se enfrentaron, es lo que te pasó a vos contra él. La pantalla lo dice con palabras (Task 3), no con un signo.

- [ ] **Step 1: Write the failing test**

En `db/friends.db.test.ts`, apoyándote en los helpers que ya existen en ese archivo (`unaFechaJugada`, `dosFechasConYContra` — **leelos antes**):

```typescript
it('trae la fecha, el torneo y el resultado de cada partido', async () => {
  const admin = await createTestUser()
  const otro = await createTestUser()
  const { enContra, seasonName } = await dosFechasConYContra({ admin, otro })

  const historia = await historyWith(admin.client, otro.playerId)
  const partido = historia.find((m) => m.matchId === enContra)

  expect(partido?.seasonName).toBe(seasonName)
  expect(partido?.matchdayNumber).toBe(1)
  expect(partido?.outcome).not.toBeNull()
  expect(partido?.score).not.toBeNull()
  // El marcador se mira desde quien consulta: los games propios primero.
  expect(partido!.score!.mine + partido!.score!.theirs).toBeGreaterThan(0)
})

it('un partido sin resultado cargado sale con outcome y score en null', async () => {
  const admin = await createTestUser()
  const otro = await createTestUser()
  // Una fecha ABIERTA con parejas generadas y sin resultados. Si el helper
  // existente sólo sabe cerrar fechas, extendelo con una bandera; no
  // insertes filas de `matches` a mano.
  const { matchId } = await unaFechaAbiertaConLosDos({ admin, otro })

  const historia = await historyWith(admin.client, otro.playerId)
  const partido = historia.find((m) => m.matchId === matchId)

  expect(partido?.outcome).toBeNull()
  expect(partido?.score).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db -- db/friends.db.test.ts`
Expected: FAIL — `seasonName` no existe en el tipo / es `undefined`.

- [ ] **Step 3: Implement**

`historyWith` pasa de una consulta a **tres**, en este orden:

1. **Participantes** — la que ya existe, sin cambios. Da los `matchId` compartidos y de qué lado estuvo cada uno.
2. **Las fechas y su torneo**, para los `matchdayId` que salieron de (1):
   ```typescript
   .from('matchdays')
   .select('id, number, kind, played_on, seasons(name)', { count: 'exact' })
   .in('id', matchdayIds)
   ```
3. **Los sets**, para los `matchId` compartidos:
   ```typescript
   .from('match_sets')
   .select('match_id, games_a, games_b', { count: 'exact' })
   .in('match_id', matchIds)
   ```

**Las tres llevan el guard de truncado**, igual que la primera: `count: 'exact'`, un `.order()` para que el corte sea reproducible, y un throw si `data.length < count`. Copiá el registro del guard que ya está en el archivo.

**No es un N+1**: son tres consultas de tamaño acotado, no una por partido. `pairsAndMatchesOf` (`db/read.ts:985`) es el antipatrón a no repetir.

Para el resultado: agrupá los sets por `match_id`, llamá a `tallySets`, y traducí a `outcome` **desde el lado del que consulta** — si mi lado es `'A'`, `setsA > setsB` es `'won'`. Sin sets, `outcome` y `score` son `null`.

**No reimplementes la regla**: si te falta algo que `tallySets` no da, extendé `tallySets` en `core/` con su test, no calcules aparte.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:db -- db/friends.db.test.ts`
Expected: PASS.

- [ ] **Step 5: Romper el guard a propósito**

Bajá `max_rows` en `supabase/config.toml` a `2`, `npm run db:reset`, y corré el test.
Expected: **falla con el mensaje del guard**, no con un conteo silenciosamente menor. Restaurá `max_rows`, `db:reset`, y confirmá con `git diff` que `config.toml` quedó igual.

Si el test **pasa** con `max_rows = 2`, el guard no está cubriendo esa consulta: arreglalo.

- [ ] **Step 6: Four gates and commit**

```bash
npm test && npm run test:db && npm run typecheck && npm run build
git add db/friends.ts db/friends.db.test.ts
git commit -m "feat(amigos): el historial trae fecha, torneo y resultado de cada partido"
```

---

### Task 3: La pantalla es una lista

**Files:**
- Rewrite: `app/amigos/historial.tsx`
- Rewrite: `app/amigos/historial.unit.test.ts`

**Interfaces:**
- Consumes: `SharedMatch` de `@/db/friends` (Task 2).
- Produces: el componente `Historial({ nombre, partidos })`, síncrono y sin leer nada.

**Lo que reemplaza y por qué.** Hoy la pantalla muestra *"Juntos 3 · En contra 12"*. Eso no fue una decisión de diseño: era lo único dibujable, porque `SharedMatch` no traía ni fecha ni marcador — el propio comentario del archivo (`historial.tsx:17-20`) lo dice. Con la Task 2 eso deja de ser cierto.

Manda `docs/historial-entre-amigos.md` §4.4, y la frase que la define es del dueño del producto: *"un historial para acordarte bien de cada partido que jugaste"*.

**La forma:** una lista, en orden cronológico **descendente** (lo último arriba: es lo que uno viene a mirar). Cada fila dice la fecha, el deporte o torneo, si jugaron juntos o en contra, y cómo salió.

**Ordenar:** por `playedOn` descendente. `playedOn` puede ser `null` —una fecha sin jugar todavía— así que el desempate es `matchdayNumber` descendente. Un orden que depende de un campo nullable y no lo dice es un orden inestable.

**Lo que NO se hace, y está en §4.4:** sumar nada a un contador. Si querés conservar un resumen arriba de la lista, que salga de la lista y no la reemplace.

- [ ] **Step 1: Write the failing test**

Reescribí `app/amigos/historial.unit.test.ts`:

```typescript
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Historial } from './historial'
import type { SharedMatch } from '@/db/friends'

const base: SharedMatch = {
  matchId: '1', matchdayId: 'f1', together: false,
  playedOn: '2026-08-14', matchdayNumber: 1, matchdayKind: 'REGULAR',
  seasonName: 'Los Jueves', outcome: 'won', score: { mine: 6, theirs: 3 },
}

describe('Historial', () => {
  it('lista cada partido con su fecha, su torneo y su marcador', () => {
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [base] }))
    expect(html).toContain('Los Jueves')
    expect(html).toContain('6')
    expect(html).toContain('3')
  })

  it('pone el más reciente primero', () => {
    const viejo = { ...base, matchId: 'v', playedOn: '2026-08-01', seasonName: 'Viejo' }
    const nuevo = { ...base, matchId: 'n', playedOn: '2026-08-20', seasonName: 'Nuevo' }
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [viejo, nuevo] }))
    expect(html.indexOf('Nuevo')).toBeLessThan(html.indexOf('Viejo'))
  })

  it('dice si jugaron juntos o en contra, en cada fila', () => {
    const juntos = { ...base, matchId: 'j', together: true }
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [juntos] }))
    expect(html).toContain('Juntos')
  })

  it('un partido sin resultado no inventa uno', () => {
    const sinJugar = { ...base, matchId: 's', outcome: null, score: null }
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [sinJugar] }))
    expect(html).not.toContain('Ganaste')
    expect(html).not.toContain('Perdiste')
  })

  it('con un amigo sin partidos dice qué falta, no una tabla vacía', () => {
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [] }))
    expect(html).toContain('Todavía no jugaron')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/amigos/historial.unit.test.ts`
Expected: FAIL — el componente todavía dibuja contadores.

- [ ] **Step 3: Implement**

Reescribí `Historial`. Registro de la casa, copiado de `rules-body.tsx`: `text-[13.5px]`, `text-[26px]`, `rounded-field`, `border-line`, `font-[550]`, `font-extrabold`, `tracking-[-.03em]`, `text-muted`. **No queda una sola medida redondeada de Tailwind en esta app** (`docs/estado.md`) — no introduzcas la primera.

El copy es castellano y para quien juega, no para quien programa. "Ganaste 6-3", no "outcome: won".

**Sacá el IIFE dentro del ternario JSX** que tiene hoy el archivo: es un patrón que no existe en ningún otro `.tsx` de la app (hallazgo diferido del plan 1). Las constantes van arriba del `return`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/amigos/historial.unit.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Four gates**

```bash
npm test && npm run test:db && npm run typecheck && npm run build
```
Reportá el número real de rutas; no lo trates como criterio de aprobación.

- [ ] **Step 6: Verlo en el navegador**

`npm run dev` (puede tomar un puerto distinto de 3000 — leé su salida). Entrá con dos cuentas que hayan jugado un torneo y abrí el perfil.

**Cruzá lo que dice la pantalla contra `psql`**, no contra lo que esperabas: la fecha, el marcador y quién ganó. Una pantalla que responde 200 y miente es el modo de falla documentado de este repo. Parala cuando termines.

- [ ] **Step 7: Commit**

```bash
git add app/amigos/historial.tsx app/amigos/historial.unit.test.ts
git commit -m "feat(amigos): el historial lista cada partido, no dos contadores"
```

---

## Lo que este plan NO hace

- **No agrega partidos casuales.** Es el plan 2b, y es el que introduce la unión discriminada en `SharedMatch` — acá el tipo se queda plano a propósito: una unión de un solo miembro es ruido, y el compilador va a forzar la unión cuando de verdad haya dos formas.
- **No agrega migraciones.** Los datos ya existen.
- **No toca el modelo del torneo**, ni `season_public_rules`, ni `match_participants`.
- **No resuelve** las dos preguntas abiertas de `docs/historial-entre-amigos.md` §8.
