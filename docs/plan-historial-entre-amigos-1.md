# Historial entre amigos — Plan 1: amistades y el historial de torneo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar a alguien con cuenta como amigo y ver, en su perfil, todos los partidos de torneo que jugaron —juntos y en contra—, en cualquier disciplina y cualquier temporada.

**Architecture:** Una tabla `friendships` nueva y una vista `match_participants` que aplana partido → jugadores. El historial es un self-join de esa vista filtrado por dos jugadores. **No se toca ni una tabla del torneo.** La vista es `security_invoker`, así que la RLS que ya existe se evalúa como quien consulta: nadie puede leer un partido de una temporada en la que no está.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5.7 strict, Supabase (Postgres + RLS), Tailwind v4, vitest.

**Spec:** `docs/historial-entre-amigos.md` — el plan discute contra ese documento; quien ejecute lee los dos.

## Global Constraints

- **TDD estricto.** El test que falla va primero y hay que **verlo fallar** por el motivo correcto. Un test que pasa antes de la implementación no está probando nada.
- **Los cuatro gates, en cada tarea:** `npm test` · `npm run test:db` · `npm run typecheck` · `npm run build`. `build` no es opcional: `docs/estado.md` registra dos roturas de producción que pasaron con tests y typecheck en verde.
- `db/test/env.ts` se niega a correr la suite de base si `NEXT_PUBLIC_SUPABASE_URL` no es local. **Nunca se puentea, se debilita ni se rodea.**
- Las migraciones son append-only. La próxima es la **`0070`**.
- **`core/` no se toca.** Nada de esto alimenta tablas de posiciones, premios ni rankings.
- **`season_public_rules` (`0007`/`0022`) está VIVA EN PRODUCCIÓN.** No se toca.
- Toda tabla nueva necesita **las dos cosas**: `grant` a `authenticated`/`service_role` **y** `revoke all … from anon`. Ver `0002_rls.sql` y `0009_anon_surface.sql`.
- Los comentarios de migración van en el registro de la casa: encabezado que explica **por qué**, no qué. Presupuestá comentarios ~1:1 con código.
- Este plan es la **rebanada 1 de 3**. Fuera de alcance: partidos casuales (plan 2), amigos sin cuenta y fusión (plan 3).

---

## Estructura de archivos

| archivo | responsabilidad |
|---|---|
| `supabase/migrations/0070_friendships.sql` | la tabla, su RLS y sus permisos |
| `supabase/migrations/0071_match_participants.sql` | la vista que aplana partido → jugador |
| `db/friends.ts` | escrituras y lecturas de amistades e historial |
| `db/friends.db.test.ts` | la suite contra la base |
| `app/amigos/page.tsx` | la lista de amigos y las solicitudes |
| `app/amigos/[playerId]/page.tsx` | el perfil del amigo con el historial |
| `app/amigos/historial.tsx` | el componente del historial, sin leer nada |
| `app/amigos/historial.unit.test.ts` | su suite unitaria |

---

### Task 1: La tabla `friendships`

**Files:**
- Create: `supabase/migrations/0070_friendships.sql`
- Create: `db/friends.db.test.ts`

**Interfaces:**
- Consumes: `public.my_player_id()` (`0006_my_player_id.sql`), `public.players`.
- Produces: tabla `public.friendships (id, player_a, player_b, requested_by, accepted_at, created_at)`. Invariante: `player_a < player_b` siempre, así que hay **una sola fila por par** y una amistad con uno mismo es imposible.

- [ ] **Step 1: Write the failing test**

En `db/friends.db.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { adminClient } from './test/admin'
import { createTestUser } from './test/users'

async function playerIdOf(userId: string): Promise<string> {
  const db = adminClient()
  const { data, error } = await db.from('players').select('id').eq('user_id', userId).single()
  if (error) throw new Error(error.message)
  return data.id
}

describe('friendships', () => {
  it('guarda una sola fila por par, con los jugadores ordenados', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] = [await playerIdOf(uno.userId), await playerIdOf(dos.userId)].sort()

    const db = adminClient()
    const { error } = await db
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: a })
    expect(error).toBeNull()

    const { error: repetida } = await db
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: b })
    expect(repetida?.code).toBe('23505')
  })

  it('rechaza una amistad con uno mismo', async () => {
    const uno = await createTestUser()
    const a = await playerIdOf(uno.userId)

    const db = adminClient()
    const { error } = await db
      .from('friendships')
      .insert({ player_a: a, player_b: a, requested_by: a })
    expect(error?.code).toBe('23514')
  })

  it('rechaza el par desordenado, para que no entren dos filas del mismo par', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] = [await playerIdOf(uno.userId), await playerIdOf(dos.userId)].sort()

    const db = adminClient()
    const { error } = await db
      .from('friendships')
      .insert({ player_a: b, player_b: a, requested_by: a })
    expect(error?.code).toBe('23514')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db -- db/friends.db.test.ts`
Expected: FAIL — `relation "public.friendships" does not exist` (código `42P01`).

- [ ] **Step 3: Write the migration**

En `supabase/migrations/0070_friendships.sql`:

```sql
-- La amistad, que es lo único que este plan agrega al modelo.
--
-- UNA fila por par, no dos. `player_a < player_b` hace las dos cosas de una:
-- fuerza un orden canónico —así el unique de abajo alcanza para que no entren
-- la fila (a,b) y la (b,a)— y prohíbe la amistad con uno mismo, porque `a < a`
-- es falso. Sin el orden, evitar el duplicado pedía un índice sobre
-- expresiones y una comprobación en cada escritura.
--
-- `accepted_at` en null ES el estado pendiente. Un enum de estados acá sería
-- tres valores para representar un booleano con fecha, y la fecha se quiere
-- igual.
create table public.friendships (
  id           uuid primary key default gen_random_uuid(),
  player_a     uuid not null references public.players on delete cascade,
  player_b     uuid not null references public.players on delete cascade,
  requested_by uuid not null references public.players on delete cascade,
  accepted_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint friendships_ordered check (player_a < player_b),
  constraint friendships_unique  unique (player_a, player_b),
  constraint friendships_requester_is_a_member check (requested_by in (player_a, player_b))
);

create index friendships_by_player_a on public.friendships (player_a);
create index friendships_by_player_b on public.friendships (player_b);

alter table public.friendships enable row level security;

-- ── permisos ────────────────────────────────────────────────────────────────
-- LAS DOS COSAS, y este repo ya se comió las dos por separado:
--
-- 1. El CLI de Supabase no le da DML a los roles de la API: sin este `grant`,
--    `authenticated` recibe 42501 y toda la RLS de abajo es decorativa
--    (0002_rls.sql lo documenta).
-- 2. Supabase Cloud SÍ le otorga a `anon` select/insert/update/delete sobre
--    cada tabla nueva del schema public — medido en producción, no supuesto
--    (0009_anon_surface.sql). En local no pasa, así que sin este `revoke` el
--    agujero aparece recién en la nube.
grant select, insert, update, delete on public.friendships to authenticated;
grant all on public.friendships to service_role;
revoke all on public.friendships from anon;

-- ── políticas ───────────────────────────────────────────────────────────────
-- `my_player_id()` (0006) y no un join contra `players`: `players.user_id` no
-- tiene SELECT otorgado a `authenticated` a propósito, para que nadie pueda
-- correlacionar auth.uid() con un jugador desde una consulta directa.
create policy friendships_read on public.friendships
  for select to authenticated
  using (public.my_player_id() in (player_a, player_b));

-- Pedir: sólo en nombre propio. Sin esto, cualquiera inventa una amistad
-- entre dos terceros.
create policy friendships_request on public.friendships
  for insert to authenticated
  with check (
    public.my_player_id() = requested_by
    and public.my_player_id() in (player_a, player_b)
  );

-- Aceptar: la contraparte, nunca quien pidió. El `using` mira la fila como
-- está y el `with check` la fila como queda.
create policy friendships_accept on public.friendships
  for update to authenticated
  using (public.my_player_id() in (player_a, player_b) and public.my_player_id() <> requested_by)
  with check (public.my_player_id() in (player_a, player_b));

-- Borrar: cualquiera de los dos, en cualquier momento. Rechazar una solicitud
-- y dejar de ser amigos son la misma operación.
create policy friendships_delete on public.friendships
  for delete to authenticated
  using (public.my_player_id() in (player_a, player_b));
```

- [ ] **Step 4: Apply the migration and run the test**

Run: `npm run db:reset && npm run test:db -- db/friends.db.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Regenerate types and run all four gates**

Run: `npm run db:types && npm test && npm run test:db && npm run typecheck && npm run build`
Expected: todo verde. `npm test` y `build` no deberían moverse.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0070_friendships.sql db/friends.db.test.ts db/database.types.ts
git commit -m "feat(db): la amistad, una fila por par y con sus permisos completos"
```

---

### Task 2: La RLS de `friendships`, rota a propósito

**Files:**
- Modify: `db/friends.db.test.ts`

**Interfaces:**
- Consumes: la tabla de la Task 1, `db/test/users.ts` (`createTestUser` devuelve un cliente autenticado).
- Produces: nada nuevo. Esta tarea sólo prueba.

Existe como tarea propia por la lección que `docs/estado.md` deja escrita: *"un test de permisos en verde no prueba nada hasta que lo ves fallar"*. La suite de RLS del Plan 2 pasaba sus 13 tests y aun así se podía apagar RLS entera en 7 de 10 tablas sin que nada se pusiera rojo.

- [ ] **Step 1: Write the failing test**

Agregá a `db/friends.db.test.ts`:

```typescript
describe('friendships — RLS', () => {
  it('un tercero no ve la amistad ajena', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const ajeno = await createTestUser()
    const [a, b] = [await playerIdOf(uno.userId), await playerIdOf(dos.userId)].sort()

    await adminClient().from('friendships').insert({ player_a: a, player_b: b, requested_by: a })

    const { data } = await ajeno.client.from('friendships').select('id')
    expect(data).toEqual([])
  })

  it('nadie puede inventar una amistad entre dos terceros', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const ajeno = await createTestUser()
    const [a, b] = [await playerIdOf(uno.userId), await playerIdOf(dos.userId)].sort()

    const { error } = await ajeno.client
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: a })
    expect(error?.code).toBe('42501')
  })

  it('quien pidió no puede aceptar su propia solicitud', async () => {
    const uno = await createTestUser()
    const dos = await createTestUser()
    const [a, b] = [await playerIdOf(uno.userId), await playerIdOf(dos.userId)].sort()
    const pidio = (await playerIdOf(uno.userId)) === a ? uno : dos

    const { data: fila } = await adminClient()
      .from('friendships')
      .insert({ player_a: a, player_b: b, requested_by: a })
      .select('id')
      .single()

    const { data } = await pidio.client
      .from('friendships')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', fila!.id)
      .select('id')
    expect(data).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests and watch them pass, then BREAK the policy**

Run: `npm run test:db -- db/friends.db.test.ts`
Expected: PASS, 6/6.

Ahora probá que la suite se entera. Comentá la política `friendships_read` en `0070`, corré `npm run db:reset` y volvé a correr.
Expected: **el primer test FALLA**. Si pasa, el test no está probando la política y hay que rehacerlo.

Restaurá la política y `npm run db:reset` de nuevo.

- [ ] **Step 3: Run all four gates**

Run: `npm test && npm run test:db && npm run typecheck && npm run build`
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add db/friends.db.test.ts
git commit -m "test(db): la RLS de amistades, vista fallar antes de darla por buena"
```

---

### Task 3: La vista `match_participants`

**Files:**
- Create: `supabase/migrations/0071_match_participants.sql`
- Modify: `db/friends.db.test.ts`

**Interfaces:**
- Consumes: `public.matches`, `public.pairs`, `public.entries`.
- Produces: vista `public.match_participants (match_id, matchday_id, pair_id, side, player_id)` — una fila por persona por partido. `side` es `'A'` o `'B'`.

**Dos cosas que esta vista existe para resolver, y las dos están medidas en `docs/historial-entre-amigos.md` §5:**

1. `pairs.entry_b` es **nullable** con disciplinas de a uno. Un `inner join` sobre esa columna borra en silencio todos los partidos individuales. Acá se une con `e.id = p.entry_a or e.id = p.entry_b`, que con null simplemente no matchea esa mitad en vez de descartar la fila.
2. `security_invoker` evita tener que escribir una función `security definer` que reciba los dos jugadores por parámetro — que sería una fuga: saltearía RLS y dejaría pedir el historial de dos personas cualesquiera.

- [ ] **Step 1: Write the failing test**

Agregá a `db/friends.db.test.ts` (usá `createSeason` y los helpers de `db/test/factories.ts`, igual que `db/discipline.db.test.ts`):

```typescript
import { createSeason } from './test/factories'

describe('match_participants', () => {
  it('devuelve los cuatro jugadores de un partido de parejas, con su lado', async () => {
    const admin = await createTestUser()
    const { matchId, entryIds } = await unaFechaJugada({ admin, pairSize: 2 })

    const { data, error } = await adminClient()
      .from('match_participants')
      .select('match_id, side, player_id')
      .eq('match_id', matchId)
    if (error) throw new Error(error.message)

    expect(data).toHaveLength(4)
    expect(new Set(data!.map((f) => f.side))).toEqual(new Set(['A', 'B']))
  })

  it('NO pierde el partido de a uno, donde entry_b viene en null', async () => {
    const admin = await createTestUser()
    const { matchId } = await unaFechaJugada({ admin, pairSize: 1 })

    const { data } = await adminClient()
      .from('match_participants')
      .select('match_id, side')
      .eq('match_id', matchId)

    expect(data).toHaveLength(2)
  })

  it('no le muestra a un tercero los partidos de una temporada ajena', async () => {
    const admin = await createTestUser()
    const ajeno = await createTestUser()
    const { matchId } = await unaFechaJugada({ admin, pairSize: 2 })

    const { data } = await ajeno.client
      .from('match_participants')
      .select('match_id')
      .eq('match_id', matchId)
    expect(data).toEqual([])
  })
})
```

> `unaFechaJugada` es un helper local que hay que escribir en este mismo archivo: crea una temporada con `createSeason`, abre una fecha, genera parejas y devuelve un `matchId`. Mirá `db/discipline.db.test.ts` y `db/test/factories.ts` para el andamiaje exacto — la suite ya arma temporadas así en varios archivos.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db -- db/friends.db.test.ts`
Expected: FAIL — `relation "public.match_participants" does not exist`.

- [ ] **Step 3: Write the migration**

En `supabase/migrations/0071_match_participants.sql`:

```sql
-- Partido → personas. Una fila por jugador por partido, con el lado en el que
-- estuvo. Es lo único que hace falta para responder "todos los partidos entre
-- X e Y": un self-join sobre esta vista, filtrando por dos player_id.
--
-- ── POR QUÉ UNA VISTA `security_invoker` Y NO UNA FUNCIÓN ───────────────────
--
-- La forma natural sería `friend_match_history(p_jugador_a, p_jugador_b)`
-- `security definer`. Es una FUGA: security definer saltea RLS, así que
-- cualquiera podría pedir el historial de dos personas cualesquiera. La
-- convención del repo lo evita derivando la identidad de auth.uid() del lado
-- del servidor (claim_seat, my_player_id), pero acá hacen falta DOS personas y
-- sólo una es el caller.
--
-- Con `security_invoker = on` la RLS de matches/pairs/entries se evalúa como
-- QUIEN CONSULTA. La vista no puede devolver un partido de una temporada en la
-- que el caller no participa, y no hay parámetro que falsificar. El agujero no
-- se tapa: no se cava.
--
-- ── POR QUÉ `or` Y NO UN JOIN A CADA COLUMNA ───────────────────────────────
--
-- `pairs.entry_b` es NULLABLE con disciplinas de a uno (0028_side_size.sql:68).
-- Un `join entries on e.id = p.entry_b` descarta la fila entera cuando es null,
-- o sea que borra TODOS los partidos individuales del historial — con la suite
-- en verde, porque hoy nada mira esto. Con `or`, la mitad nula simplemente no
-- matchea y el partido sobrevive con sus dos jugadores.
create view public.match_participants
with (security_invoker = on) as
  select m.id          as match_id,
         m.matchday_id as matchday_id,
         p.id          as pair_id,
         case when p.id = m.pair_a then 'A' else 'B' end as side,
         e.player_id   as player_id
    from public.matches m
    join public.pairs   p on p.id = m.pair_a or p.id = m.pair_b
    join public.entries e on e.id = p.entry_a or e.id = p.entry_b
   where e.player_id is not null;

-- Mismo par que toda tabla y vista nueva de este repo. `anon` no tiene nada
-- que hacer acá: la única superficie pública del sistema es Reglas.
grant select on public.match_participants to authenticated, service_role;
revoke all on public.match_participants from anon;
```

- [ ] **Step 4: Apply and run**

Run: `npm run db:reset && npm run test:db -- db/friends.db.test.ts`
Expected: PASS, 9/9.

- [ ] **Step 5: Break the nullable case on purpose**

Cambiá el `or` del join a `entries` por `join public.entries e on e.id = p.entry_a`, corré `db:reset` y la suite.
Expected: **el test de a uno FALLA** (devuelve 1 fila en vez de 2) y el de parejas también. Eso prueba que el test cubre exactamente la trampa que motivó la vista. Restaurá.

- [ ] **Step 6: Run all four gates and commit**

```bash
npm run db:types && npm test && npm run test:db && npm run typecheck && npm run build
git add supabase/migrations/0071_match_participants.sql db/friends.db.test.ts db/database.types.ts
git commit -m "feat(db): partido → personas, con la RLS de quien consulta y sin perder el juego de a uno"
```

---

### Task 4: `db/friends.ts` — pedir, aceptar, listar, y el historial

**Files:**
- Create: `db/friends.ts`
- Modify: `db/friends.db.test.ts`

**Interfaces:**
- Consumes: `friendships` (Task 1), `match_participants` (Task 3), `EdgeError` y el patrón de `db/discipline.ts`.
- Produces:
  - `requestFriendship(supabase, friendPlayerId: string): Promise<void>`
  - `acceptFriendship(supabase, friendshipId: string): Promise<void>`
  - `friendsOf(supabase): Promise<Friend[]>` donde `Friend = { friendshipId: string; playerId: string; displayName: string; accepted: boolean; theyAsked: boolean }`
  - `historyWith(supabase, friendPlayerId: string): Promise<SharedMatch[]>` donde `SharedMatch = { matchId: string; matchdayId: string; together: boolean }`

`together` es la respuesta a §5.3 del diseño: con un amigo se juega **de compañero** (mismo lado) o **en contra** (lados distintos), y las dos son "partidos con Juan".

- [ ] **Step 1: Write the failing test**

```typescript
import { historyWith, requestFriendship } from './friends'

describe('historyWith', () => {
  it('distingue los partidos jugados juntos de los jugados en contra', async () => {
    const admin = await createTestUser()
    const otro = await createTestUser()
    // Una temporada donde los dos juegan: una fecha los pone en la MISMA
    // pareja, otra en parejas ENFRENTADAS. Ver el helper de la Task 3.
    const { juntos, enContra } = await dosFechasConYContra({ admin, otro })

    const historia = await historyWith(admin.client, await playerIdOf(otro.userId))

    expect(historia.find((m) => m.matchId === juntos)?.together).toBe(true)
    expect(historia.find((m) => m.matchId === enContra)?.together).toBe(false)
  })

  it('no devuelve nada de una temporada en la que el caller no está', async () => {
    const ajeno = await createTestUser()
    const admin = await createTestUser()
    const otro = await createTestUser()
    await dosFechasConYContra({ admin, otro })

    const historia = await historyWith(ajeno.client, await playerIdOf(otro.userId))
    expect(historia).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db -- db/friends.db.test.ts`
Expected: FAIL — `Cannot find module './friends'`.

- [ ] **Step 3: Write the implementation**

En `db/friends.ts`:

```typescript
import { EdgeError } from './errors'
import type { Client } from './client'

export interface SharedMatch {
  matchId: string
  matchdayId: string
  /** `true` si jugaron del mismo lado; `false` si se enfrentaron. */
  together: boolean
}

/**
 * Todos los partidos de torneo entre el caller y `friendPlayerId`.
 *
 * UNA consulta, no una por fecha. `pairsAndMatchesOf` (db/read.ts:985) se
 * llama hoy adentro de un loop por fecha; acá eso sería un N+1 que crece con
 * cada temporada que jugaron juntos.
 *
 * No hace falta chequear que sean amigos ni que el caller sea quien dice: la
 * vista es `security_invoker`, así que la RLS de `matches` ya limita esto a
 * las temporadas en las que el caller participa (0071).
 */
export async function historyWith(
  supabase: Client,
  friendPlayerId: string,
): Promise<SharedMatch[]> {
  // La identidad del caller se DERIVA, no se recibe. Recibirla por parámetro
  // es el agujero que la vista evita: con dos ids libres, cualquiera pediría
  // el historial de dos terceros.
  const { data: me, error: idError } = await supabase.rpc('my_player_id')
  if (idError !== null) throw new EdgeError(`No se pudo identificar tu cuenta: ${idError.message}`)
  if (me === null) throw new EdgeError('Entrá con tu cuenta para ver el historial.')

  // UNA consulta. Trae las filas del caller y las del amigo, y el cruce se
  // hace acá: PostgREST no expresa un self-join, y hacer una consulta por
  // partido sería el N+1 que `pairsAndMatchesOf` (db/read.ts:985) ya tiene y
  // que acá crecería con cada temporada compartida.
  const { data, error } = await supabase
    .from('match_participants')
    .select('match_id, matchday_id, side, player_id')
    .in('player_id', [me, friendPlayerId])
  if (error !== null) throw new EdgeError(`No se pudo leer el historial: ${error.message}`)

  const porPartido = new Map<string, { matchdayId: string; mio?: string; suyo?: string }>()
  for (const fila of data ?? []) {
    const entrada = porPartido.get(fila.match_id) ?? { matchdayId: fila.matchday_id }
    if (fila.player_id === me) entrada.mio = fila.side
    if (fila.player_id === friendPlayerId) entrada.suyo = fila.side
    porPartido.set(fila.match_id, entrada)
  }

  // Sólo los partidos donde están LOS DOS. Un partido donde jugué yo y el
  // amigo no, o al revés, no es un partido entre nosotros.
  return [...porPartido.entries()]
    .filter(([, v]) => v.mio !== undefined && v.suyo !== undefined)
    .map(([matchId, v]) => ({
      matchId,
      matchdayId: v.matchdayId,
      together: v.mio === v.suyo,
    }))
}
```

> **Un caso que este código maneja y conviene no "simplificar" después:** con
> `friendPlayerId === me` todo partido saldría con `together: true`. No puede
> pasar —la tabla prohíbe la amistad con uno mismo (`friendships_ordered`)—
> pero la función es pública y no depende de esa tabla. Si alguien la llama
> así, devuelve todos tus partidos marcados como "juntos", que es una respuesta
> rara pero no una fuga.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:db -- db/friends.db.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `requestFriendship`, `acceptFriendship` y `friendsOf` con sus tests**

Mismo ciclo por cada una: test que falla, verlo fallar, implementar, verlo pasar. Seguí el registro de `db/discipline.ts:206-260` — `{ count: 'exact' }` en los updates y `count === 0` como "RLS no encontró nada", que es como esto falla en silencio.

Para `requestFriendship`, el orden canónico del par (`player_a < player_b`) lo calcula la función antes de insertar; la base lo exige con un `check` pero el error de la base no es un mensaje para el usuario.

- [ ] **Step 6: Run all four gates and commit**

```bash
npm test && npm run test:db && npm run typecheck && npm run build
git add db/friends.ts db/friends.db.test.ts
git commit -m "feat(db): pedir y aceptar amistades, y el historial de torneo con un amigo"
```

---

### Task 5: Las dos pantallas

**Files:**
- Create: `app/amigos/page.tsx`
- Create: `app/amigos/[playerId]/page.tsx`
- Create: `app/amigos/historial.tsx`
- Create: `app/amigos/historial.unit.test.ts`

**Interfaces:**
- Consumes: `friendsOf`, `historyWith`, `requestFriendship`, `acceptFriendship` (Task 4).
- Produces: las rutas `/amigos` y `/amigos/[playerId]`.

`historial.tsx` **no lee nada**: recibe `SharedMatch[]` por props. Es el mismo reparto que `rules-body.tsx` — la página lee, el componente dibuja — y es lo que lo hace testeable sin base.

- [ ] **Step 1: Write the failing unit test**

En `app/amigos/historial.unit.test.ts`:

```typescript
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { Historial } from './historial'

describe('Historial', () => {
  it('separa los que jugaron juntos de los que se enfrentaron', () => {
    const html = renderToStaticMarkup(
      Historial({
        nombre: 'Juan',
        partidos: [
          { matchId: '1', matchdayId: 'f1', together: true },
          { matchId: '2', matchdayId: 'f1', together: false },
          { matchId: '3', matchdayId: 'f2', together: false },
        ],
      }),
    )
    expect(html).toContain('Juntos 1')
    expect(html).toContain('En contra 2')
  })

  it('con un amigo sin partidos dice qué falta, no una tabla vacía', () => {
    const html = renderToStaticMarkup(Historial({ nombre: 'Juan', partidos: [] }))
    expect(html).toContain('Todavía no jugaron')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/amigos/historial.unit.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Implement `historial.tsx`, then the two pages**

Seguí los tokens del handoff: en toda la app **no queda una sola medida redondeada de Tailwind** (ver `docs/estado.md`), así que copiá el registro de `rules-body.tsx` — `text-[13.5px]`, `rounded-field`, `border-line`, `font-[550]`.

`app/amigos/[playerId]/page.tsx` es un Server Component: llama `historyWith` y le pasa el resultado a `Historial`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/amigos/historial.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Run all four gates**

Run: `npm test && npm run test:db && npm run typecheck && npm run build`
Expected: verde. **`build` tiene que subir de 20 rutas a 22** — si no subió, las páginas no se registraron.

- [ ] **Step 6: Walk it in a browser**

`npm run dev`, entrá con dos cuentas distintas, pedí y aceptá una amistad, y abrí el perfil.
La lección de este repo, escrita en `docs/estado.md`: *"una pantalla que tipa y compila puede estar mintiendo en cada línea"* — cinco defectos reales aparecieron en veinte minutos de navegador con las dos suites en verde.

- [ ] **Step 7: Commit**

```bash
git add app/amigos
git commit -m "feat(amigos): la lista de amigos y el historial de torneo con cada uno"
```

---

## Lo que este plan NO hace

- **No hay partidos casuales.** Todo lo que muestra el historial salió de un torneo. Es el plan 2.
- **No hay amigos sin cuenta ni fusión.** Las dos puntas de una amistad son `players` reales. Es el plan 3.
- **No toca `core/`, ni una tabla del torneo, ni `season_public_rules`.**
- **No resuelve** las cuatro preguntas abiertas de `docs/historial-entre-amigos.md` §8.
