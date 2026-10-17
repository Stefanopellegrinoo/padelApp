# Historial entre amigos — Plan 2b: el partido casual

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ## ⚠ Leer antes de ejecutar
>
> **Este plan se escribió ANTES de que 2a corriera.** Sus interfaces —el tipo
> `SharedMatch`, la firma de `historyWith`, la forma de `historial.tsx`— son las
> que 2a *va a producir*, no las que existen hoy.
>
> **Primer paso obligatorio: abrir `db/friends.ts` y `app/amigos/historial.tsx`
> y comparar contra lo que este plan asume.** Donde difieran, manda el código y
> hay que corregir el plan. En el plan 1, tres suposiciones sobre código todavía
> no escrito resultaron falsas —una de ellas no compilaba— y las encontró quien
> implementaba, no quien planeó.
>
> **Y por eso este plan es a propósito menos granular que 2a.** Las tareas 1 y 2
> están al detalle porque no dependen de nada que 2a vaya a cambiar: la
> migración y la RLS se sostienen solas. Las tareas 3 y 4 están al nivel de
> decisiones y criterios, no de código paso a paso, porque escribir los pasos
> finos contra una `historial.tsx` que todavía no existe sería inventar. **Cuando
> 2a esté hecho, este plan se completa leyendo el código real** — y ese trabajo
> es de minutos, no de una sesión.

**Goal:** Cargar un partido jugado fuera de todo torneo —el FIFA del sábado— y que aparezca en la misma lista que los partidos de torneo.

**Architecture:** Una tabla nueva (`0072`) con la forma que el partido casual necesita de verdad, y una cuarta consulta en `historyWith` que se mezcla con las otras al leer. `SharedMatch` pasa a ser una unión discriminada. **El modelo del torneo no se toca.**

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5.7 strict, Supabase (RLS), Tailwind v4, vitest.

**Spec:** `docs/historial-entre-amigos.md` — **§4 entero manda acá**, en particular §4.2 (la forma), §4.3 (no hay campo de penales), §4.4 (la pantalla) y §4.5 (la puerta de amistad aceptada). Y §3 para quién puede escribir.

## Global Constraints

- **TDD estricto.** Test que falla primero, visto fallar por el motivo correcto.
- **Los cuatro gates en cada tarea:** `npm test` · `npm run test:db` · `npm run typecheck` · `npm run build`.
- `db/test/env.ts` nunca se puentea ni se debilita.
- **Los tests de permisos van por cliente autenticado**, jamás `adminClient()`.
- **PostgREST corta en `max_rows = 1000` sin avisar.** Toda consulta nueva lleva su guard.
- **La identidad se DERIVA de `auth.uid()`/`my_player_id()`, nunca se recibe.**
- Toda tabla nueva necesita **las dos**: `grant` a `authenticated`/`service_role` **y** `revoke all … from anon`.
- Migraciones append-only. La próxima es la **`0072`**.
- `core/` no se toca: un partido casual no alimenta tablas de posiciones, premios ni rankings.
- `season_public_rules` está viva en producción. No se toca.
- Fuera de alcance: amigos sin cuenta y el mapeo (plan 3), y el pádel casual de a cuatro (§7).

---

## Estructura de archivos

| archivo | responsabilidad |
|---|---|
| `supabase/migrations/0072_casual_matches.sql` | la tabla, su RLS y sus permisos |
| `db/friends.ts` | la unión discriminada, las escrituras, la cuarta consulta |
| `db/friends.db.test.ts` | la suite contra la base |
| `app/amigos/historial.tsx` | filas de partido casual en la lista de 2a |
| `app/amigos/historial.unit.test.ts` | sus tests |
| `app/amigos/[playerId]/cargar.tsx` | el formulario |
| `app/amigos/actions.ts` | las server actions de cargar, editar y borrar |

---

### Task 1: La tabla `casual_matches`

**Files:**
- Create: `supabase/migrations/0072_casual_matches.sql`
- Modify: `db/friends.db.test.ts`

**Interfaces:**
- Consumes: `public.players`, `public.friendships` (`0070`), `public.my_player_id()`.
- Produces: `public.casual_matches`.

**La forma sale de §4.2 y nada más entra:**

```sql
create table public.casual_matches (
  id          uuid primary key default gen_random_uuid(),
  player_a    uuid not null references public.players on delete cascade,
  player_b    uuid not null references public.players on delete cascade,
  sport       text not null check (length(trim(sport)) > 0),
  played_on   date not null,
  -- Quién ganó es un dato PROPIO, nunca deducido del marcador: un 2-2 que
  -- termina con ganador se definió por penales, y ninguna cuenta sobre el
  -- marcador puede decir eso (diseño §4.2, §4.3). `null` = empataron.
  winner      uuid references public.players,
  score_a     int,
  score_b     int,
  team_a      text,
  team_b      text,
  created_by  uuid not null references public.players,
  updated_by  uuid not null references public.players,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint casual_ordered      check (player_a < player_b),
  constraint casual_winner_plays check (winner is null or winner in (player_a, player_b)),
  constraint casual_score_pair   check ((score_a is null) = (score_b is null))
);
```

**Por qué cada restricción, y no se sacan sin leer esto:**

- `player_a < player_b` — mismo truco que `friendships` (`0070:12-22`): orden canónico y, de paso, imposibilita un partido contra uno mismo.
- `casual_winner_plays` — el ganador tiene que ser uno de los dos. Sin esto se puede guardar que ganó un tercero.
- `casual_score_pair` — o están los dos números o ninguno. Un marcador a medias no es un marcador.
- **NO hay campo de penales**, y es deliberado (§4.3): empate en el marcador con `winner` no nulo ya lo dice, y guardarlo aparte sólo permite un registro que se contradice solo.

**RLS — esto es terreno nuevo, leelo entero antes de escribirlo.** Toda política de este repo se apoya en la temporada (`is_participant`, `is_season_admin`). Acá no hay temporada.

- **Leer**: `my_player_id() in (player_a, player_b)`.
- **Insertar**: los tres a la vez —
  1. `my_player_id() in (player_a, player_b)`
  2. `created_by = my_player_id()` **y** `updated_by = my_player_id()`
  3. **existe una amistad ACEPTADA entre los dos** (§4.5). Sin esto cualquiera fabrica historial contra el `playerId` de cualquiera, y esa persona lo ve, porque la lectura del historial está abierta a propósito. **Es un canal de acoso, no una formalidad.**
- **Actualizar**: cualquiera de los dos, con `updated_by = my_player_id()` en el `with check`.
- **Borrar**: cualquiera de los dos (§3.3).

**Y las columnas de identidad se congelan con un grant de columna, no con política**, porque `with check` no puede comparar la fila nueva contra la vieja — la lección está escrita en `0070:50-56`:

```sql
grant select, insert, delete on public.casual_matches to authenticated;
grant update (sport, played_on, winner, score_a, score_b, team_a, team_b, updated_by, updated_at)
  on public.casual_matches to authenticated;
grant all on public.casual_matches to service_role;
revoke all on public.casual_matches from anon;
```

Así `player_a`, `player_b`, `created_by` y `created_at` no son escribibles después del insert **ni queriendo**.

- [ ] **Step 1: Write the failing tests**

Cinco, todos por cliente **autenticado** salvo el andamiaje:

1. Dos amigos aceptados pueden cargar un partido.
2. **Sin amistad aceptada, el insert se rechaza** — el que cierra §4.5.
3. Con la solicitud **pendiente** (no aceptada), también se rechaza.
4. Un tercero no ve el partido de otros dos.
5. Nadie puede mover `player_a` con un update.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:db -- db/friends.db.test.ts`
Expected: FAIL — la tabla no existe.

- [ ] **Step 3: Write the migration**

Encabezado en el registro de la casa: explica **por qué**, no qué. Presupuestá comentarios ~1:1 con código. El párrafo sobre §4.5 —por qué el insert exige amistad aceptada y el read no— es el más importante del archivo: es lo que le explica al que venga que la asimetría es deliberada.

- [ ] **Step 4: Apply and run**

Run: `npm run db:reset && npm run test:db -- db/friends.db.test.ts`
Expected: PASS.

- [ ] **Step 5: Romper la puerta a propósito**

Sacá del `with check` del insert la condición de amistad aceptada, `db:reset`, y corré.
Expected: **el test 2 y el 3 FALLAN**. Si pasan, no están probando la puerta. Restaurá y `db:reset`.

- [ ] **Step 6: Four gates and commit**

```bash
npm run db:types && npm test && npm run test:db && npm run typecheck && npm run build
git add supabase/migrations/0072_casual_matches.sql db/friends.db.test.ts db/database.types.ts
git commit -m "feat(db): el partido casual, con la puerta de amistad aceptada para escribirlo"
```

---

### Task 2: `SharedMatch` se parte en dos, y `historyWith` mezcla

**Files:**
- Modify: `db/friends.ts`
- Modify: `db/friends.db.test.ts`

**Interfaces:**
- Produces:

```typescript
export type SharedMatch =
  | ({ kind: 'tournament' } & TournamentMatch)
  | ({ kind: 'casual' } & CasualMatch)
```

donde `TournamentMatch` es **exactamente** lo que 2a dejó (leelo, no lo reconstruyas de memoria) y

```typescript
export interface CasualMatch {
  matchId: string
  playedOn: string
  sport: string
  /** Qué te pasó A VOS. `'drew'` cuando no hubo ganador. */
  outcome: 'won' | 'lost' | 'drew'
  score: { mine: number; theirs: number } | null
  teams: { mine: string | null; theirs: string | null }
  /** Nombres, no ids: la pantalla los muestra (§3.2). */
  createdBy: string
  updatedBy: string
}
```

**`together` no existe en el casual**, y es correcto: son dos personas, siempre enfrentadas (§7). No le pongas un `together: false` de relleno — un campo que siempre vale lo mismo es ruido que después alguien lee como si significara algo.

- [ ] **Step 1: Write the failing test**

Un test que carga un casual y un partido de torneo entre los mismos dos, y asierta que `historyWith` devuelve los dos, cada uno con su `kind`, y **ordenados por fecha descendente entre sí** — la mezcla es el punto de la tarea.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `kind` no existe.

- [ ] **Step 3: Implement**

`historyWith` suma una cuarta consulta contra `casual_matches` —con su guard de truncado— y mezcla. El orden final por `playedOn` descendente sobre las dos fuentes.

Los nombres de `created_by`/`updated_by` salen del mismo camino que ya usa `friendsOf` para `display_name`; no inventes un segundo.

**El compilador es tu aliado acá**: al volverse unión, cada lugar que lee `.matchdayId` o `.together` va a romper. Esa lista de errores **es** el inventario de lo que hay que tocar.

- [ ] **Step 4-6:** verificar, cuatro gates, commit.

---

### Task 3: La lista muestra las dos clases

**Files:**
- Modify: `app/amigos/historial.tsx`
- Modify: `app/amigos/historial.unit.test.ts`

Cada fila ramifica por `kind`. La de torneo queda **exactamente como la dejó 2a** —si cambia, es una regresión— y la casual muestra deporte, marcador, equipos si los hay, y quién la cargó.

**La línea de autoría se muestra siempre**, y es la que hace funcionar la regla de §3.2: la app no arbitra, pero para que dos amigos puedan discutir un resultado tienen que poder ver que alguien lo cambió.

Tests: una fila de cada clase en la misma lista, el orden entre las dos, la fila casual sin marcador, y la fila casual editada por el otro mostrando su nombre.

---

### Task 4: Cargar, editar y borrar

**Files:**
- Create: `app/amigos/[playerId]/cargar.tsx`
- Modify: `app/amigos/actions.ts`
- Modify: `db/friends.ts`, `db/friends.db.test.ts`

**El formulario, y el detalle que sale de §4.3:** cuando el marcador queda **empatado**, la app **pregunta** *"¿quedó empatado o ganó alguien?"*. No lo asume. El empate es una respuesta tan válida como la otra, y ésa es la única forma en que "ganó por penales" entra al sistema sin un campo que lo diga.

**El deporte es texto con sugerencias de lo que ya usaste** (§4.1) — la consulta sale de los `sport` distintos que ya cargó quien escribe. No hay tabla de deportes.

Las server actions derivan al llamador de `auth.uid()`, nunca lo reciben.

Editar y borrar los puede hacer cualquiera de los dos (§3.1, §3.3), y toda escritura setea `updated_by`. **Ese es el riesgo real de esta tarea**: si un camino de escritura se olvida de setearlo, la garantía de §3.2 se pudre en silencio y la pantalla muestra un autor viejo sin que nada falle. Un test por cada camino de escritura.

Y al final, el navegador: cargar un FIFA con un amigo, verlo aparecer en la lista, editarlo desde la otra cuenta, y confirmar que la línea de autoría cambia. **Cruzado contra `psql`.**

---

## Lo que este plan NO hace

- **No detecta duplicados** (§3.4). Si los dos cargan el mismo sábado, aparece dos veces y se borra a mano. Detectarlos pediría adivinar si dos partidos parecidos son el mismo, y adivinar es justo lo que este diseño se saca de encima.
- **No hace casuales de a cuatro** (§7).
- **No toca `core/`**, ni el modelo del torneo, ni `season_public_rules`.
- **No resuelve** las dos preguntas abiertas de §8.
