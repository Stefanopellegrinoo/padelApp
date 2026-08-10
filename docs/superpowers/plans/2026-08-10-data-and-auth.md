# Plan 2 — datos y auth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el campeonato exista fuera de la memoria. Schema, permisos, cuentas, y las tres operaciones que mueven una fecha: armarla, cerrarla y reabrirla.

**Architecture:** Tres capas y una regla que las ordena.

```
core/     funciones puras. Ya existe. Este plan le agrega history.ts y le cambia
          dos firmas. Sigue sin base de datos, sin framework y sin Date
db/       una función por operación. Trae filas, se las da a core/, guarda lo
          que core/ devolvió. No decide nada del campeonato
app/      Next.js App Router. Pantallas de cuenta y de entrada al torneo
```

**La regla:** ninguna regla del campeonato se implementa en `db/`. Si aparece una decisión de dominio en la capa de datos —quién es el defensor, cuántos puntos paga el segundo, en qué orden van los invitados—, es que falta una función en `core/`.

**Tech Stack:** Next.js 15 (App Router), React 19, Supabase (Postgres + Auth), Tailwind v4, Vitest. Deploy en Vercel.

**Fuente de verdad de las reglas:** `docs/superpowers/specs/2026-08-09-padel-championship-design.md`.
**Fuente de verdad de las pantallas:** `docs/ui-screens.md` y `docs/padel_design/README.md`.

---

## Las tres decisiones que estaban abiertas

`docs/estado.md` dejó tres decisiones sin tomar porque su costo subía apenas existiera el schema. Están tomadas. **No se vuelven a discutir durante la ejecución**: si una tarea parece pedir lo contrario, es la tarea la que está mal escrita.

### 1. El contexto de la fecha anterior se deriva en `core/`

Módulo nuevo `core/history.ts`. Recibe las filas crudas de las dos fechas anteriores y devuelve las tres cosas que `buildPairs` pide hoy y nadie calcula: `defenders`, `defendersAlreadyRepeated`, `previousPairs`.

**No hace falta recomputar la tabla de la fecha anterior.** `awards` congela `position`, así que el campeón es la pareja que contiene un asiento con `position: 1`. Eso además resuelve gratis el caso de la pareja mixta: si ganó una pareja de jugador + invitado, el invitado no cobra award pero su compañero sí, así que la pareja se encuentra igual.

### 2. Varios invitados por fecha, y el admin decide si juegan juntos

El invitado deja de ser uno. Puede sumarse un equipo de invitados a una fecha: juegan, no suman puntos, es un amistoso adentro de la fecha.

**Lo que casi se nos pasa:** el armado no los deja juntos solo. `orderPool` mete a los invitados al final del orden y `buildPairs` empareja primero-con-último, así que dos invitados sueltos salen en **dos parejas mixtas**, no en una pareja de invitados. Que jueguen juntos es una regla nueva, no un efecto automático.

De ahí salen cinco cambios, todos ya aprobados:

| Qué cambia | Dónde |
|---|---|
| `PairingInput.guestId` pasa a `guestIds: EntryId[]`, en el orden que quiere el admin | `core/pairing.ts` |
| `PairingInput.fixedPairs: Pair[]` — parejas fijadas antes del sorteo. Los defensores **no** van ahí: tienen su propia resolución condicional | `core/pairing.ts` |
| `computeAwards` **compacta** las posiciones: los puntos se reparten sobre las parejas del torneo en su orden relativo. Una pareja 100% invitada no consume puesto | `core/awards.ts` |
| `Award.position` pasa a significar **posición del campeonato**, no lugar en la tabla de la fecha | `core/types.ts` |
| El campeón que defiende es la mejor pareja **del torneo**, no la invitada | `core/history.ts` |

Y una regla del grupo que va al borde: **como máximo un invitado puede jugar con un jugador del torneo.** El resto entra de a dos, en equipo. Es la traducción exacta de "el invitado es el que juega con el que quedó sin dupla".

### 3. La tabla que arma las parejas es el ranking, mejores N de M

`computeRanking(awards de las fechas cerradas, squad, config, snapshot)` y de ahí sale el `points` que recibe `buildPairs`. Nunca una suma cruda.

La razón que decide: `core/snapshots.ts:31` ya construye la cadena de desempate con `computeRanking`. Emparejar por suma cruda mezclaría dos bases —orden por una, desempate por otra— y eso no está en ningún spec. Además la tabla que ves en pantalla tiene que ser la que te empareja.

`core/matchday.test.ts:191` (`tally`) es la suma cruda. Queda arreglado en la Task 2.

---

## Global Constraints

- **Ningún cálculo del campeonato vive en `db/` ni en SQL.** Puntos, tablas, rankings, snapshots, parejas y campeones los calcula `core/` y nadie más.
  Un invariante del spec **sí** puede estar en SQL cuando además es un invariante de integridad, y hay exactamente cuatro: una sola fecha viva por temporada, un set no puede empatar, sólo se reabre la última fecha cerrada, y no se cierra con partidos sin cargar. Están ahí porque son la última línea, no la única: los cuatro tienen su chequeo en TypeScript con un mensaje que una persona puede leer.
- **`core/` sigue puro.** Nada de I/O, `Date`, `Math.random`, `fetch` ni `process`. Las funciones nuevas de este plan también.
- **Los identificadores son `EntryId`, nunca `playerId`.** Vale para las filas, para los tipos y para las firmas.
- **RLS prendida en todas las tablas, sin excepción.** Una tabla sin política es una tabla pública.
- **`validateConfig` se llama en todo borde que acepte una config**, y sus errores frenan la operación. Devuelve errores, no los tira: si nadie los mira, no protegen a nadie. Con `tiebreakSnapshotEvery: 0`, `snapshotForMatchday` entra en loop infinito.
- **Idioma.** Identificadores, archivos, comentarios, nombres de test, commits y nombres de columna: **inglés**. Todo string que lee una persona del grupo —mensajes de error de pantalla, `raise exception` de las funciones SQL, copys— en **castellano**. Los tests verifican esos textos.
- **Toda escritura pasa por una función de `db/`.** Ninguna pantalla arma un `.from(...).insert(...)` suelto.

## Sobre los conteos de tests

Cada tarea dice "Expected: PASS — N tests". **Ese número es orientativo: el bloque de código es la verdad.** Si no coincide, **no toques los tests**: reportá la discrepancia y seguí.

## Regla anti-scope-creep

Cada tarea lista **qué NO hace**. Si aparece algo que no está en sus pasos:

1. **No lo implementes.**
2. Anotalo al final del plan, en "Aparecidos".
3. Seguí con los pasos de la tarea.

## Sobre los bloques de código de este plan

Cuatro de los seis hallazgos importantes de la revisión final del Plan 1 venían del plan, no de quien implementaba. Así que:

- Los bloques de **`core/`, SQL y validación** están completos y son para transcribir. Un defecto ahí se propaga intacto.
- Los bloques de **pantalla** son contrato, no transcripción: rutas, campos, estados y **los textos exactos**. El JSX lo escribe quien implementa, contra `docs/padel_design/README.md`. Escribir JSX en el plan sería fingir precisión donde no la tengo.

---

## Estructura de archivos

```
app/
  layout.tsx                shell, fuente, tokens
  page.tsx                  landing
  registro/page.tsx
  login/page.tsx
  auth/actions.ts           server actions de cuenta
  auth/callback/route.ts    intercambio del code de Google
  unirse/[token]/page.tsx
  unirse/[token]/actions.ts
  globals.css               tokens del handoff

db/
  client.ts                 clientes de browser y de servidor
  database.types.ts         generado por la CLI, no se edita a mano
  errors.ts                 EdgeError
  validate.ts               validación de borde
  season.ts                 leer temporada, plantel, config
  matchday.ts               armar, abrir, cerrar y reabrir una fecha
  test/
    env.ts                  carga .env.local
    admin.ts                cliente con service role: arma la escena, no asserta
    users.ts                crea usuarios de prueba y sus clientes
    factories.ts            temporadas y planteles de prueba

core/
  history.ts                NUEVO — el contexto de la fecha anterior

supabase/
  migrations/
    0001_schema.sql
    0002_rls.sql
    0003_new_user.sql          alta de player al registrarse
    0004_claim_seat.sql        reclamo de asiento por link
    0005_matchday_moves.sql    abrir, cerrar y reabrir una fecha
  seed.sql                  una temporada de demo para poder mirar la app

middleware.ts
```

---

### Task 1: Cimientos

**Files:**
- Modify: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `next.config.ts`, `postcss.config.mjs`, `vitest.db.config.ts`, `.env.example`
- Create: `app/layout.tsx`, `app/globals.css`, `app/page.tsx`
- Create: `db/client.ts`, `middleware.ts`
- Create: `supabase/config.toml` (lo genera la CLI)

**Interfaces:**
- Consumes: nada
- Produces: `npm run dev` levanta, `npm test` sigue verde, `npm run test:db` corre contra Supabase local

**Qué NO hace esta tarea:** no crea tablas, no toca `core/`, no escribe pantallas de auth, no instala librería de componentes, de formularios, de validación ni de estado. Tailwind entra **sólo** con los tokens del handoff.

**Por qué Tailwind y por qué ahora.** Los planes 3 y 4 son trece pantallas. Escribir las tres de auth en CSS a mano y reescribirlas después es el peor de los dos mundos. Entra Tailwind v4 con los tokens del handoff como variables y nada más: sin componentes, sin plugins, sin preset.

- [ ] **Step 1: Dependencias**

```bash
npm install next@^15 react@^19 react-dom@^19 @supabase/supabase-js@^2 @supabase/ssr@^0.5
npm install -D @types/react @types/react-dom @types/node tailwindcss@^4 @tailwindcss/postcss@^4 postcss dotenv
npm install -D supabase
```

- [ ] **Step 2: `package.json` — scripts**

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:db": "vitest run --config vitest.db.config.ts",
    "typecheck": "tsc --noEmit",
    "db:start": "supabase start",
    "db:reset": "supabase db reset",
    "db:types": "supabase gen types typescript --local > db/database.types.ts"
  }
}
```

Dos suites separadas y no una con `projects`: `npm test` tiene que seguir corriendo sin Docker prendido. El día que los tests de base necesiten Docker para correr los unitarios, nadie corre los unitarios.

- [ ] **Step 3: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowJs": true,
    "incremental": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`noUncheckedIndexedAccess` se queda. Es la opción que obligó a `core/` a manejar el caso "no hay nada ahí" en vez de asumirlo.

- [ ] **Step 4: `next.config.ts` y `postcss.config.mjs`**

```typescript
import type { NextConfig } from 'next'

const config: NextConfig = {}

export default config
```

```javascript
export default {
  plugins: { '@tailwindcss/postcss': {} },
}
```

- [ ] **Step 5: `app/globals.css` — los tokens del handoff**

```css
@import 'tailwindcss';

@theme {
  --font-sans: Archivo, ui-sans-serif, system-ui, sans-serif;

  --color-bg: #ffffff;
  --color-surface: #f4f6f3;
  --color-chip: #eaefea;
  --color-line: #e4e9e5;
  --color-text: #10231a;
  --color-muted: #6b7a72;
  --color-accent: #0e5c3f;
  --color-accent-text: #ffffff;
  --color-accent-link: #0e5c3f;
  --color-live: #d1462f;
  --color-live-bg: #fbeae6;
  --color-up: #2f8a5b;
  --color-ok-bg: #e6f2ea;
  --color-down: #c0553a;
  --color-warn-bg: #f8ece4;

  --radius-field: 12px;
  --radius-card: 16px;
}

@media (prefers-color-scheme: dark) {
  @theme {
    --color-bg: #0d1512;
    --color-surface: #16201c;
    --color-chip: #1b2823;
    --color-line: #21302a;
    --color-text: #eaf2ee;
    --color-muted: #8ea298;
    --color-accent: #0f6b48;
    --color-accent-text: #dbf5e8;
    --color-accent-link: #34c08a;
    --color-live: #ff8368;
    --color-live-bg: #2a1a15;
    --color-up: #34c08a;
    --color-ok-bg: #12291f;
    --color-down: #ff9a6b;
    --color-warn-bg: #2a2016;
  }
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
}
```

**En oscuro `--accent` es fondo de bloque, nunca color de texto.** Para texto e íconos activos va `--accent-link`, que sobre fondo oscuro tiene la luminosidad que hace falta. Está en el handoff y es fácil de romper sin darse cuenta.

- [ ] **Step 6: `app/layout.tsx`**

Carga la fuente Archivo con `next/font/google` (pesos 400 a 800), aplica `globals.css`, `lang="es"`, `<meta name="viewport">` por defecto de Next. Nada más: la nav del torneo es del Plan 3.

- [ ] **Step 7: `db/client.ts` — NO en esta tarea**

El cliente tipado importa `./database.types`, que lo genera la CLI **a partir de las tablas**. Las tablas nacen en la Task 5, así que `db/client.ts` también. Acá sólo va el `middleware.ts`, que no necesita los tipos.

Queda escrito acá porque es la única inversión de dependencias del plan y es fácil de reintroducir sin querer. El bloque completo está en la Task 5, Step 4.

<details>
<summary>Adelanto del bloque, para saber qué va a existir (no lo escribas todavía)</summary>

```typescript
import { createBrowserClient, createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from './database.types'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function credentials(): { url: string; anonKey: string } {
  if (url === undefined || anonKey === undefined) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  }
  return { url, anonKey }
}

export function browserClient() {
  const { url, anonKey } = credentials()
  return createBrowserClient<Database>(url, anonKey)
}

export async function serverClient() {
  const { url, anonKey } = credentials()
  const store = await cookies()
  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return store.getAll()
      },
      // El tipo va escrito a mano: `createServerClient` tiene dos overloads —el
      // viejo `get/set/remove` y este `getAll/setAll`— y TypeScript no puede
      // propagar el tipo contextual del callback a través de firmas que no
      // coinciden. Sin la anotación, `toSet` queda `any` implícito y `tsc` corta.
      setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options)
        } catch {
          // Un Server Component no puede escribir cookies. El middleware ya
          // refrescó la sesión, así que acá no hay nada que hacer.
        }
      },
    },
  })
}
```

Las credenciales se leen y se validan **al llamar**, no al importar el módulo: un `throw` en tiempo de import rompe el build de Next antes de que nadie pueda leer el mensaje.

</details>

- [ ] **Step 8: `middleware.ts`**

```typescript
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of toSet) request.cookies.set(name, value)
          response = NextResponse.next({ request })
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options)
        },
      },
    },
  )

  // Refresca el token vencido y reescribe la cookie. Sin esta llamada, la
  // sesión se muere sola en cuanto expira el access token.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
```

- [ ] **Step 9: `.env.example` y `.gitignore`**

```bash
# .env.example — copiar a .env.local con los valores que imprime `supabase start`
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

A `.gitignore`: `.next/`, `.env.local`, `node_modules/`, `supabase/.temp/`.

**La service role key nunca se importa desde `app/`.** Vive sólo en `db/test/`. Es la llave que saltea RLS: si entra al bundle, la app queda sin permisos.

- [ ] **Step 10: Las dos suites**

**La convención de nombres es lo que las separa**, y es la parte que hay que respetar: `*.unit.test.ts` no toca la base y corre siempre; `*.db.test.ts` necesita Supabase levantado. Un test puro con nombre de test de base deja de correr el día que alguien no tiene Docker, y nadie se entera.

`vitest.config.ts` pasa a:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['core/**/*.test.ts', 'db/**/*.unit.test.ts'],
  },
})
```

`vitest.db.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['db/**/*.db.test.ts'],
    setupFiles: ['db/test/env.ts'],
    // Los tests comparten una base. Aislan por temporada, no por proceso.
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
```

```typescript
// db/test/env.ts
import { config } from 'dotenv'

config({ path: '.env.local' })
```

- [ ] **Step 11: Arrancar Supabase local**

```bash
npx supabase init
npm run db:start
```

Anotar en `.env.local` la URL, la anon key y la service role key que imprime.

- [ ] **Step 12: Verificar**

```bash
npm test          # los 145 de core/, verdes
npm run typecheck # sin db/client.ts todavía: no hay database.types que importar
npm run dev       # la landing levanta
```

**Expected: PASS — los 145 tests de `core/` siguen verdes.** Esta tarea no agrega tests: no agrega lógica.

```bash
git add -A
git commit -m "chore: set up next, supabase and tailwind alongside core"
```

---

### Task 2: `core/awards.ts` — invitados en plural y posiciones compactadas

**Files:**
- Modify: `core/awards.ts`, `core/types.ts`, `core/awards.test.ts`, `core/matchday.test.ts`

**Interfaces:**
- Consumes: `PairStanding`, `SeasonConfig`, `Award`, `EntryId` de `core/types.ts`
- Produces: `computeAwards(standings, config, guestIds: readonly EntryId[]): Award[]`

**Qué NO hace esta tarea:** no toca `pairing.ts` (eso es la Task 3), no toca `standings.ts` —la tabla de la fecha muestra a todas las parejas, invitadas incluidas, y eso está bien—, no decide quién es invitado, no valida el tamaño de la fecha.

**La regla que implementa:** una pareja hecha **sólo** de invitados está afuera del campeonato. Conserva su lugar en la tabla de la fecha, pero no consume un puesto que pague. Si la pareja invitada sale segunda, la pareja del torneo que salió tercera cobra como escolta. Sin esto, unos visitantes se llevarían los 10 puntos de un campeonato al que nadie los invitó.

- [ ] **Step 1: Escribir los tests que fallan**

`core/awards.test.ts` hoy tiene **un solo** helper, `standing(a, b, position)`, y no importa `defaultConfig`. Los bloques de abajo necesitan dos helpers más y un import. Agregarlos primero:

```typescript
import { defaultConfig } from './config'
import type { Pair, PairStanding } from './types'

const pair = (a: string, b: string): Pair => ({ a, b })

const table = (pairs: Pair[]): PairStanding[] =>
  pairs.map((p, index) => ({
    pair: p,
    played: 0,
    won: 0,
    setsDiff: 0,
    gamesDiff: 0,
    position: index + 1,
  }))
```

Y después el bloque nuevo:

```typescript
describe('computeAwards — invitados', () => {
  it('paga completo al compañero de un invitado', () => {
    const standings = table([pair('p1', 'g1'), pair('p2', 'p3')])
    const awards = computeAwards(standings, CONFIG, ['g1'])
    expect(awards.find((award) => award.entryId === 'p1')?.points).toBe(CONFIG.points[0])
    expect(awards.find((award) => award.entryId === 'g1')).toBeUndefined()
  })

  it('saltea a todos los invitados, no sólo al primero', () => {
    const standings = table([pair('p1', 'g1'), pair('p2', 'g2')])
    const awards = computeAwards(standings, CONFIG, ['g1', 'g2'])
    expect(awards.map((award) => award.entryId).sort()).toEqual(['p1', 'p2'])
  })

  it('no le da puesto a una pareja hecha sólo de invitados', () => {
    // La pareja invitada gana la fecha; los 10 puntos son igual del torneo.
    const standings = table([pair('g1', 'g2'), pair('p1', 'p2'), pair('p3', 'p4')])
    const awards = computeAwards(standings, CONFIG, ['g1', 'g2'])
    expect(awards).toHaveLength(4)
    expect(awards.find((award) => award.entryId === 'p1')?.points).toBe(CONFIG.points[0])
    expect(awards.find((award) => award.entryId === 'p1')?.position).toBe(1)
    expect(awards.find((award) => award.entryId === 'p3')?.points).toBe(CONFIG.points[1])
  })

  it('deja todo igual cuando la pareja invitada sale última', () => {
    const standings = table([pair('p1', 'p2'), pair('p3', 'p4'), pair('g1', 'g2')])
    const awards = computeAwards(standings, CONFIG, ['g1', 'g2'])
    expect(awards.find((award) => award.entryId === 'p1')?.position).toBe(1)
    expect(awards.find((award) => award.entryId === 'p3')?.position).toBe(2)
  })

  it('no depende del orden en que le pasen la tabla', () => {
    const standings = table([pair('p1', 'p2'), pair('p3', 'p4')])
    const reversed = [...standings].reverse()
    expect(computeAwards(reversed, CONFIG, [])).toEqual(computeAwards(standings, CONFIG, []))
  })

  it('falla cuando las parejas del torneo superan la lista de puntos', () => {
    const config = defaultConfig(8) // cuatro valores de puntos
    const standings = table([
      pair('p1', 'p2'),
      pair('p3', 'p4'),
      pair('p5', 'p6'),
      pair('p7', 'p8'),
      pair('p9', 'g1'),
    ])
    expect(() => computeAwards(standings, config, ['g1'])).toThrow(
      /5 parejas del torneo .* sólo tiene 4 valores/,
    )
  })
})
```

`table(pairs)` y `pair(a, b)` son helpers del propio archivo: `table` devuelve `PairStanding[]` con `position` correlativo desde 1 y el resto de los campos en 0.

**Expected: FAIL** — hoy la firma toma `guestId: EntryId | null`.

- [ ] **Step 2: `core/types.ts` — qué significa ahora `position`**

```typescript
export interface Award {
  entryId: EntryId
  /**
   * Position in the championship, not in the matchday table. A pair made only
   * of guests is skipped, so the two can differ: with a guest pair second, the
   * championship pair that came third is award position two.
   */
  position: number
  points: number
}
```

- [ ] **Step 3: `core/awards.ts`**

```typescript
import type { Award, EntryId, PairStanding, SeasonConfig } from './types'

/**
 * Points for a finished matchday. Both members of a pair always take the same
 * amount, and a shorter matchday simply uses the leading values of the list,
 * so winning pays ten whether eight or twelve turned up.
 *
 * Guests get nothing: they are not in the championship. Their partner is paid
 * in full — they played and earned it.
 *
 * A pair made only of guests is outside the championship altogether. It keeps
 * its place in the matchday table but consumes no paying position, so visitors
 * can never walk off with the ten points of a championship they are not in.
 */
export function computeAwards(
  standings: PairStanding[],
  config: SeasonConfig,
  guestIds: readonly EntryId[],
): Award[] {
  const guests = new Set(guestIds)
  const championshipMembers = (row: PairStanding): EntryId[] =>
    [row.pair.a, row.pair.b].filter((entryId) => !guests.has(entryId))

  // computeStandings already hands these over in order; sorting a copy by
  // position keeps the result honest for any other caller.
  const paying = [...standings]
    .sort((left, right) => left.position - right.position)
    .filter((row) => championshipMembers(row).length > 0)

  if (paying.length > config.points.length) {
    throw new Error(
      `La fecha tiene ${paying.length} parejas del torneo pero la lista de puntos sólo tiene ${config.points.length} valores.`,
    )
  }

  const awards: Award[] = []
  for (const [index, row] of paying.entries()) {
    const points = config.points[index]
    // Unreachable: paying.length is checked against points.length above, so
    // every index here is inside the list. Only to satisfy
    // noUncheckedIndexedAccess.
    if (points === undefined) {
      throw new Error(`No hay puntos definidos para la posición ${index + 1}.`)
    }
    for (const entryId of championshipMembers(row)) {
      awards.push({ entryId, position: index + 1, points })
    }
  }
  return awards
}
```

- [ ] **Step 4: Arreglar los llamadores**

Son **tres** cosas, y la tercera no es mecánica: es una decisión del plan.

**a) Los 10 llamadores viejos de `core/awards.test.ts`.** Están en las líneas 20, 33, 49, 55, 57, 67, 73, 79, 84 y 90. Ocho pasan `null` y dos pasan `'guest'`:

- `computeAwards(..., null)` → `computeAwards(..., [])`
- `computeAwards(..., 'guest')` → `computeAwards(..., ['guest'])`

**Esto no es cosmético y `npm test` no alcanza para detectarlo.** `new Set(null)` no tira: devuelve un set vacío, así que los ocho con `null` seguirían pasando. Pero `new Set('guest')` devuelve `Set{'g','u','e','s','t'}` —un string es iterable, carácter por carácter— y entonces `guests.has('guest')` da `false` y **el invitado cobra puntos**. El test `'skips the guest'` espera un award y recibe dos. `npm run typecheck` tira los 10 errores de una; correlo antes que los tests.

**b) El test `'records the position alongside the points'` (línea 83) hay que reescribirlo.** Hoy le pasa una sola fila con `position: 3` y espera `position: 3`. Con la compactación, una sola pareja del torneo cobra la posición 1: la salida es `1` y el test se pone rojo por la razón correcta. Reemplazarlo por uno que ejerza la semántica nueva:

```typescript
it('records the championship position, compacted from the table', () => {
  const awards = computeAwards(
    [standing('a1', 'a2', 1), standing('b1', 'b2', 2), standing('c1', 'c2', 3)],
    CONFIG,
    [],
  )
  expect(awards.find((award) => award.entryId === 'c1')?.position).toBe(3)
})
```

Es la única excepción a la regla de "no toques los tests": está autorizada acá, por escrito, y con el reemplazo dado. Cualquier otro test que se ponga rojo se reporta, no se edita.

**c) `tally` se va de `core/matchday.test.ts`.** El harness ordenaba el pool con una suma cruda acumulada; la decisión 3 dice que lo ordena el ranking. Reemplazar el helper por:

```typescript
function pointsFrom(everyAward: Award[][], config: SeasonConfig): Map<string, number> {
  const awardsByMatchday = new Map(everyAward.map((awards, index) => [index + 1, awards]))
  // El snapshot sólo decide el ORDEN de las filas, y de acá salen los valores:
  // cualquier permutación da el mismo Map. Va SQUAD porque es determinista.
  const ranking = computeRanking(awardsByMatchday, SQUAD, config, SQUAD)
  return new Map(ranking.map((row) => [row.entryId, row.points]))
}
```

y usarlo en las **cinco** llamadas que hoy usan `tally` — líneas 89, 96, 134, 150 y 183. Después borrar `tally`; si queda una sola llamada sin migrar, el borrado deja un `ReferenceError`.

Con `countBestOf: 8` de 10 fechas, `computeRanking` recién descarta cuando hay **más de 8** resultados, o sea desde el cierre de la fecha 9. Y como el sorteo de la fecha n se ordena con los awards de 1 a n−1, **el único sorteo de toda la temporada que cambia es el de la fecha 10**. Los loops de 6 y de 5 fechas ni se enteran.

Las aserciones del test de temporada completa son estructurales —`length`, `counted.length`, `discarded.length`, monotonía—, así que aguantan aunque cambie el emparejamiento de la última fecha. **Si aun así algo se pone rojo, no lo edites: reportalo.**

- [ ] **Step 5: Verificar**

```bash
npm test
npm run typecheck
```

**Expected: PASS — 6 tests nuevos en `awards.test.ts`, uno reescrito, y `matchday.test.ts` verde con el ranking.**

```bash
git add core/awards.ts core/types.ts core/awards.test.ts core/matchday.test.ts
git commit -m "feat: pay awards over championship pairs, skipping guest-only pairs"
```

---

### Task 3: `core/pairing.ts` — varios invitados y parejas fijas

**Files:**
- Modify: `core/pairing.ts`, `core/pairing.test.ts`, `core/matchday.test.ts`
- Modify: `core/index.ts`

**Interfaces:**
- Consumes: `allMatchings` de `core/matchings.ts`, `orderByPoints` de `core/order.ts`
- Produces:
  ```typescript
  interface PairingInput {
    present: EntryId[]
    points: Map<EntryId, number>
    snapshot: EntryId[]
    defenders: Pair | null
    defendersAlreadyRepeated: boolean
    previousPairs: Pair[]
    guestIds: EntryId[]
    fixedPairs: Pair[]
  }
  ```

**Qué NO hace esta tarea:** no decide quién asiste, no valida el tamaño de la fecha, no decide si los invitados van juntos —eso llega ya resuelto en `fixedPairs`—, no genera el fixture, no reparte puntos, no arma `PairingInput` desde ningún lado.

**Las dos reglas nuevas:**

```
guestIds    todos los invitados van al fondo del orden del pool, en el orden
            en que vengan. Reordenar la lista es cómo el admin mueve a un
            invitado (spec 2.6)

fixedPairs   parejas decididas antes del sorteo. Los defensores NO están acá:
             tienen su propia resolución condicional, que puede disolverlos
```

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `core/pairing.test.ts` (y cambiar el helper `input()` para que devuelva `guestIds: []` y `fixedPairs: []`):

```typescript
describe('buildPairs — varios invitados', () => {
  it('reparte dos invitados sueltos en dos parejas mixtas', () => {
    // Pool ordenado [p1..p6, g1, g2] → posiciones 1..8, idealSum 9. El único
    // armado con desbalance 0 es 1-8, 2-7, 3-6, 4-5: p1 con g2 y p2 con g1.
    const pairs = buildPairs(
      input({ present: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'g1', 'g2'], guestIds: ['g1', 'g2'] }),
    )
    expect(keys(pairs)).toEqual(['g1-p2', 'g2-p1', 'p3-p6', 'p4-p5'])
  })

  it('invertir el orden de los invitados invierte con quién le toca a cada uno', () => {
    const pairs = buildPairs(
      input({ present: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'g1', 'g2'], guestIds: ['g2', 'g1'] }),
    )
    expect(keys(pairs)).toEqual(['g1-p1', 'g2-p2', 'p3-p6', 'p4-p5'])
  })
})

describe('buildPairs — las parejas fijas', () => {
  it('deja junta a la pareja fija y la saca del pool', () => {
    const pairs = buildPairs(
      input({
        present: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'g1', 'g2'],
        guestIds: ['g1', 'g2'],
        fixedPairs: [{ a: 'g1', b: 'g2' }],
      }),
    )
    expect(keys(pairs)).toEqual(['g1-g2', 'p1-p6', 'p2-p5', 'p3-p4'])
  })

  it('convive con los defensores', () => {
    const pairs = buildPairs(
      input({
        present: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'g1', 'g2'],
        defenders: { a: 'p1', b: 'p2' },
        guestIds: ['g1', 'g2'],
        fixedPairs: [{ a: 'g1', b: 'g2' }],
      }),
    )
    expect(keys(pairs)).toContain('p1-p2')
    expect(keys(pairs)).toContain('g1-g2')
    expect(pairs).toHaveLength(4)
  })

  it('devuelve exactamente las fijas cuando no queda pool', () => {
    const pairs = buildPairs(
      input({
        present: ['g1', 'g2', 'g3', 'g4'],
        guestIds: ['g1', 'g2', 'g3', 'g4'],
        fixedPairs: [
          { a: 'g1', b: 'g2' },
          { a: 'g3', b: 'g4' },
        ],
      }),
    )
    expect(keys(pairs)).toEqual(['g1-g2', 'g3-g4'])
  })

  it('la pareja fija no está sujeta a la regla de no repetir', () => {
    // Repetir es una regla del campeonato. Una pareja que el admin fijó a
    // mano no la incumple: la eligió él.
    const pairs = buildPairs(
      input({
        present: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'g1', 'g2'],
        guestIds: ['g1', 'g2'],
        fixedPairs: [{ a: 'g1', b: 'g2' }],
        previousPairs: [{ a: 'g1', b: 'g2' }],
      }),
    )
    expect(keys(pairs)).toContain('g1-g2')
  })

  it('falla si una pareja fija incluye a alguien que no juega', () => {
    expect(() => buildPairs(input({ fixedPairs: [{ a: 'p1', b: 'p99' }] }))).toThrow(
      /p99, que no juega esta fecha/,
    )
  })

  it('falla si alguien está en dos parejas fijas', () => {
    expect(() =>
      buildPairs(
        input({
          fixedPairs: [
            { a: 'p1', b: 'p2' },
            { a: 'p2', b: 'p3' },
          ],
        }),
      ),
    ).toThrow(/p2 está en más de una pareja fija/)
  })

  it('falla si una pareja fija se solapa con los defensores', () => {
    expect(() =>
      buildPairs(input({ defenders: { a: 'p1', b: 'p2' }, fixedPairs: [{ a: 'p2', b: 'p3' }] })),
    ).toThrow(/p2 está en más de una pareja fija/)
  })
})
```

**`core/` acepta N invitados sueltos; el borde acepta uno.** No es contradicción, es la capa que corresponde: `buildPairs` es una función pura y su contrato general es "los invitados van al fondo, en este orden", que se prueba con dos. La regla del grupo —un solo invitado suelto, el resto en parejas trabadas— es una decisión del campeonato y vive en `assertLocksAndGuests` (Task 9). Consecuencia que conviene saber: **en el camino real de la app el ORDEN de `guestIds` nunca importa**, porque nunca hay dos sueltos en el pool. Importa el día que esa regla del borde se afloje, y por eso la lista es una lista.

**Por qué el bloque de invitados tiene sólo dos tests.** El caso de *un* invitado ya está cubierto por `pairing.test.ts:171-183`, que lo pone con 999 puntos y verifica que igual va al fondo. Agregar otro con un invitado sin puntos sería un test que pasa aunque borres la regla —`orderByPoints` ya manda al fondo a quien no está en el snapshot—, y agregar otro con 999 sería la misma prueba dos veces. Lo único que la Task 3 estrena es el caso de **varios**, y de eso son los dos tests.

**Los dos usan `toEqual` sobre el array completo, no `toContain`.** El contrato acá es el ORDEN, y `toContain` contesta "¿está?", nunca "¿dónde?". Es la lección que costó una ronda en el Plan 1.

**Expected: FAIL**

- [ ] **Step 2: `core/pairing.ts`**

Reemplazar la interfaz y las dos funciones privadas:

```typescript
export interface PairingInput {
  /**
   * Everyone playing this matchday, guests included. Must be even.
   *
   * Caller invariant: every present player except the guests is expected to
   * appear in `snapshot`. When two or more are missing from it, their relative
   * order falls back to the order they appear in here — so the caller must
   * supply a stable order for `present` or the pairing among those players can
   * change between calls with the same "who's here" set.
   */
  present: EntryId[]
  points: Map<EntryId, number>
  snapshot: EntryId[]
  /** Winners of the previous matchday, or null when there was none. */
  defenders: Pair | null
  /** True when the defenders already played their one repeat. */
  defendersAlreadyRepeated: boolean
  previousPairs: Pair[]
  /**
   * This matchday's guests, in the order the admin wants them. They all sit at
   * the tail of the pool, keeping that order among themselves.
   *
   * Careful with what that means for more than one: the balanced draw sends the
   * bottom of the order to the top of the table, so it is the LAST guest in this
   * list who lands on the table leader, not the first. Earlier in the list means
   * ranked higher, exactly like everywhere else in the order.
   */
  guestIds: EntryId[]
  /**
   * Pairs settled before the draw — a visiting team that came to play
   * together. The defenders are NOT listed here: they have their own rule,
   * which can dissolve them.
   */
  fixedPairs: Pair[]
}

export function buildPairs(input: PairingInput): Pair[] {
  const {
    present,
    points,
    snapshot,
    defenders,
    defendersAlreadyRepeated,
    previousPairs,
    guestIds,
    fixedPairs,
  } = input

  if (present.length === 0) {
    throw new Error('No se puede armar una fecha sin jugadores.')
  }
  if (present.length % 2 !== 0) {
    throw new Error(`Hacen falta jugadores en número par: hay ${present.length}.`)
  }

  const settled = resolveSettled(present, defenders, defendersAlreadyRepeated, fixedPairs)
  const taken = new Set(settled.flatMap((pair) => [pair.a, pair.b]))
  const pool = present.filter((entryId) => !taken.has(entryId))

  const ordered = orderPool(pool, points, snapshot, guestIds)
  const position = new Map(ordered.map((entryId, index) => [entryId, index + 1]))
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

  return [...settled, ...best]
}

/**
 * The pairs that are decided before the draw: the defending champions, when
 * their rule holds, and whatever the admin fixed by hand. Anything wrong here
 * is an invariant violation and fails loudly (spec 4.5) rather than quietly
 * pairing somebody twice.
 */
function resolveSettled(
  present: EntryId[],
  defenders: Pair | null,
  alreadyRepeated: boolean,
  fixedPairs: Pair[],
): Pair[] {
  const settled: Pair[] = []
  const taken = new Set<EntryId>()

  const take = (pair: Pair, what: string): void => {
    for (const entryId of [pair.a, pair.b]) {
      if (!present.includes(entryId)) {
        throw new Error(`${what} incluye a ${entryId}, que no juega esta fecha.`)
      }
      if (taken.has(entryId)) {
        throw new Error(`${entryId} está en más de una pareja fija.`)
      }
      taken.add(entryId)
    }
    settled.push(pair)
  }

  const defending = resolveDefenders(present, defenders, alreadyRepeated)
  if (defending !== null) take(defending, 'La pareja defensora')
  for (const pair of fixedPairs) take(pair, 'Una pareja fija')

  return settled
}

/**
 * Guests always sit at the tail, in the order they were given: nobody knows how
 * they play, so the bottom is the neutral spot. Reordering `guestIds` is how the
 * admin moves one of them (spec 2.6).
 *
 * With a single guest that is exactly what the spec asks for — the tail draws the
 * table leader. With several, the leader draws the LAST of them, because the tail
 * is the bottom of the order and the draw pairs the bottom with the top.
 */
function orderPool(
  pool: EntryId[],
  points: Map<EntryId, number>,
  snapshot: EntryId[],
  guestIds: EntryId[],
): EntryId[] {
  const inPool = new Set(pool)
  const guests = [...new Set(guestIds)].filter((entryId) => inPool.has(entryId))
  if (guests.length === 0) {
    return orderByPoints(pool, points, snapshot)
  }
  const isGuest = new Set(guests)
  const squad = pool.filter((entryId) => !isGuest.has(entryId))
  return [...orderByPoints(squad, points, snapshot), ...guests]
}
```

`resolveDefenders` y `imbalance` quedan como están. `samePair` también.

Tres detalles del bloque que valen la pena:

- `[...new Set(guestIds)]` no es adorno: un `guestIds` con un id repetido metería al mismo jugador dos veces en `ordered` y `allMatchings` armaría parejas con él consigo mismo.
- La pareja fija sale **antes** del pool en el array devuelto, igual que los defensores. La fecha se lee de arriba para abajo.
- Una pareja fija **no** pasa por el filtro de `previousPairs`. Repetir es una regla del sorteo, y esto no se sorteó.

- [ ] **Step 3: Arreglar los llamadores**

Tres lugares, no dos. El helper `input()` de `core/pairing.test.ts` es el obvio; los otros dos pasan `guestId` **como override** y no compilan contra un `Partial<PairingInput>` que ya no tiene ese campo:

- `core/pairing.test.ts:175` — `guestId: 'guest'` → `guestIds: ['guest']`
- `core/pairing.test.ts:181` — `guestId: null` → `guestIds: []`
- `core/matchday.test.ts` — `guestId: null` → `guestIds: [], fixedPairs: []`

Los dos de `pairing.test.ts` son el bloque `describe('buildPairs — the guest')`, que después del cambio sigue verde: con un solo invitado la salida es `guest-p1` igual.

- [ ] **Step 4: `core/index.ts`**

El bloque de comentario de `allMatchings` sigue valiendo. Nada que exportar de nuevo: `PairingInput` ya está exportado y cambió de forma sola.

- [ ] **Step 5: Verificar**

```bash
npm test
npm run typecheck
```

**Expected: PASS — 9 tests nuevos en `pairing.test.ts`.**

```bash
git add core/pairing.ts core/pairing.test.ts core/matchday.test.ts
git commit -m "feat: accept several guests and admin-settled pairs when drawing"
```

---

### Task 4: `core/history.ts` — el contexto de la fecha anterior

**Files:**
- Create: `core/history.ts`
- Test: `core/history.test.ts`
- Modify: `core/index.ts`

**Interfaces:**
- Consumes: `samePair` de `core/pairing.ts`; `Award`, `Pair` de `core/types.ts`
- Produces:
  ```typescript
  interface MatchdayHistory { pairs: Pair[]; awards: Award[] }
  interface PreviousContext {
    defenders: Pair | null
    defendersAlreadyRepeated: boolean
    previousPairs: Pair[]
  }
  function previousContext(last: MatchdayHistory | null, beforeLast: MatchdayHistory | null): PreviousContext
  ```

**Qué NO hace esta tarea:** no lee de la base, no decide si los defensores efectivamente quedan juntos —eso lo resuelve `buildPairs`, que es el único que sabe quién está presente—, no calcula la tabla de la fecha anterior, no arma el `PairingInput` completo.

**Este es el agujero que encontró la revisión final del Plan 1.** El spec 3.3 dice que quién es la pareja defensora se deriva siempre y nunca se guarda, pero `buildPairs` lo recibía por parámetro y nadie lo calculaba. Acá se calcula, en `core/`, donde se puede probar sin levantar nada.

**Cómo se deriva el campeón sin recomputar la tabla:** `awards` congela `position` al cerrar la fecha. El campeón es la pareja que contiene un asiento con `position: 1`. Y como una pareja hecha sólo de invitados no cobra award (Task 2), de acá nunca puede salir una: el campeonato lo gana una pareja del campeonato.

- [ ] **Step 1: Escribir los tests que fallan**

Create `core/history.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { previousContext, type MatchdayHistory } from './history'
import type { Award, Pair } from './types'

function history(pairs: Pair[], champion: Pair | null): MatchdayHistory {
  const awards: Award[] = []
  pairs.forEach((pair, index) => {
    const position = champion !== null && pair === champion ? 1 : index + 2
    for (const entryId of [pair.a, pair.b]) {
      if (entryId.startsWith('g')) continue // los invitados no cobran
      awards.push({ entryId, position, points: 10 - position })
    }
  })
  return { pairs, awards }
}

const A: Pair = { a: 'p1', b: 'p2' }
const B: Pair = { a: 'p3', b: 'p4' }
const C: Pair = { a: 'p5', b: 'p6' }

describe('previousContext', () => {
  it('no hay nada que heredar en la primera fecha', () => {
    expect(previousContext(null, null)).toEqual({
      defenders: null,
      defendersAlreadyRepeated: false,
      previousPairs: [],
    })
  })

  it('los defensores son la pareja que cobró la posición 1', () => {
    const context = previousContext(history([A, B, C], B), null)
    expect(context.defenders).toEqual(B)
    expect(context.defendersAlreadyRepeated).toBe(false)
  })

  it('devuelve todas las parejas de la fecha anterior', () => {
    expect(previousContext(history([A, B, C], A), null).previousPairs).toEqual([A, B, C])
  })

  it('marca que ya repitieron si también estuvieron juntos dos fechas atrás', () => {
    const context = previousContext(history([A, B, C], A), history([A, B, C], A))
    expect(context.defendersAlreadyRepeated).toBe(true)
  })

  it('no le importa el orden de los dos jugadores', () => {
    const flipped: Pair = { a: 'p2', b: 'p1' }
    const context = previousContext(history([A, B], A), history([flipped, C], flipped))
    expect(context.defendersAlreadyRepeated).toBe(true)
  })

  it('encuentra a una pareja mixta campeona por su compañero del torneo', () => {
    const mixed: Pair = { a: 'p1', b: 'g1' }
    const context = previousContext(history([mixed, B], mixed), null)
    expect(context.defenders).toEqual(mixed)
  })

  it('no hay defensores si la fecha anterior no cerró', () => {
    const context = previousContext({ pairs: [A, B], awards: [] }, null)
    expect(context.defenders).toBeNull()
    expect(context.previousPairs).toEqual([A, B])
  })

  it('falla si dos parejas dicen ser la posición 1', () => {
    const broken: MatchdayHistory = {
      pairs: [A, B],
      awards: [
        { entryId: 'p1', position: 1, points: 10 },
        { entryId: 'p3', position: 1, points: 10 },
      ],
    }
    expect(() => previousContext(broken, null)).toThrow(/2 parejas en la posición 1/)
  })

  it('falla si el ganador no está en ninguna pareja', () => {
    const broken: MatchdayHistory = {
      pairs: [A],
      awards: [{ entryId: 'p9', position: 1, points: 10 }],
    }
    expect(() => previousContext(broken, null)).toThrow(/0 parejas en la posición 1/)
  })
})
```

**Expected: FAIL** — el módulo no existe.

- [ ] **Step 2: `core/history.ts`**

```typescript
import { samePair } from './pairing'
import type { Award, Pair } from './types'

/** One closed matchday, as it was stored. */
export interface MatchdayHistory {
  pairs: Pair[]
  /** Frozen at close. Empty for a matchday that never closed. */
  awards: Award[]
}

/** What the draw of the next matchday needs to know about the ones before it. */
export interface PreviousContext {
  defenders: Pair | null
  defendersAlreadyRepeated: boolean
  previousPairs: Pair[]
}

/**
 * The champion-defender rule, derived from the two matchdays before this one.
 *
 * Nothing about it is stored (spec 3.3): `pairs` carries no defender flag,
 * because that would be duplicated state waiting to drift the first time
 * somebody reopens a matchday. Whether the defenders actually stay together is
 * not decided here — `buildPairs` decides that, since it is the one that knows
 * who turned up.
 *
 * `last` and `beforeLast` are the two matchdays immediately before, in that
 * order, or null when the season has not played that many — closed or not; a
 * matchday that never closed simply carries no awards, so it yields no
 * defenders while still contributing its pairs.
 */
export function previousContext(
  last: MatchdayHistory | null,
  beforeLast: MatchdayHistory | null,
): PreviousContext {
  if (last === null) {
    return { defenders: null, defendersAlreadyRepeated: false, previousPairs: [] }
  }

  const defenders = championsOf(last)
  const alreadyRepeated =
    defenders !== null && (beforeLast?.pairs ?? []).some((pair) => samePair(pair, defenders))

  return { defenders, defendersAlreadyRepeated: alreadyRepeated, previousPairs: last.pairs }
}

/**
 * The champions are whichever pair took championship position one in the frozen
 * awards. A pair made only of guests collects no award, so it can never come out
 * of here — which is the rule, not an accident.
 */
function championsOf(matchday: MatchdayHistory): Pair | null {
  const winners = new Set(
    matchday.awards.filter((award) => award.position === 1).map((award) => award.entryId),
  )
  // Corregido en la ronda de fix de la Task 4: devolver null acá tragaba en
  // silencio una fecha con awards rotos. `computeAwards` nunca emite awards sin
  // una posición 1, así que ese estado es dato corrupto y el spec §4.5 pide
  // fallar ruidosamente. Cuatro líneas más abajo el invariante hermano ya tiraba.
  if (winners.size === 0) {
    if (matchday.awards.length > 0) {
      throw new Error('La fecha anterior tiene awards pero ninguno en la posición 1.')
    }
    return null
  }

  const champions = matchday.pairs.filter(
    (pair) => winners.has(pair.a) || winners.has(pair.b),
  )
  if (champions.length !== 1) {
    throw new Error(
      `La fecha anterior tiene ${champions.length} parejas en la posición 1; tiene que haber exactamente una.`,
    )
  }
  return champions[0] ?? null
}
```

**Por qué `defendersAlreadyRepeated` es una comparación tan simple.** Basta preguntar si esa misma pareja existía en la fecha `n-2`, sin averiguar si allá también fue campeona. Eso es literalmente lo que pide el spec §2.5 paso 2 —"no estuvieron juntos también en la fecha anterior a esa"—, así que la comprobación corta es la comprobación completa.

**Ojo con la versión anterior de este párrafo,** que justificaba lo mismo diciendo que "una pareja sólo puede aparecer dos fechas seguidas si fue defensora". Eso es **falso** a nivel del contrato de `core/`: `resolveSettled` antepone las parejas fijas sin pasarlas por el filtro de `previousPairs`, así que un `fixedPairs` puede repetir una pareja que nunca defendió. El código igual da bien, porque la condición implementada nunca menciona "fue campeona" —pregunta por identidad de pareja, que es lo que manda el spec—. Queda anotado porque esa premisa falsa habilitaba una "optimización" futura a `fue campeona en n-2`, que **sí** estaría mal.

- [ ] **Step 3: `core/index.ts`**

```typescript
// ── El contexto que hereda una fecha de las anteriores ───────────────────────
// Quién defiende no se guarda nunca (spec 3.3): se deriva de las dos fechas
// previas, acá adentro y no en la capa de datos.
export type { MatchdayHistory, PreviousContext } from './history'
export { previousContext } from './history'
```

- [ ] **Step 4: Verificar**

```bash
npm test
npm run typecheck
```

**Expected: PASS — 9 tests nuevos en `history.test.ts`.**

```bash
git add core/history.ts core/history.test.ts core/index.ts
git commit -m "feat: derive the defending champions from the two previous matchdays"
```

---

### Task 5: El schema

**Files:**
- Create: `supabase/migrations/0001_schema.sql`
- Create: `supabase/seed.sql`
- Create: `db/database.types.ts` (generado), `db/client.ts`

**Interfaces:**
- Consumes: nada
- Produces: las diez tablas —las nueve del spec 3.2, más `pair_locks`—, con los invariantes que el SQL puede sostener solo; y el cliente tipado

**Qué NO hace esta tarea:** no escribe políticas de RLS (Task 6), no escribe funciones (Tasks 8, 11, 12, 13), no crea las 10 fechas de la temporada por adelantado.

**Cinco decisiones de schema que no están en el spec y hay que dejar escritas:**

1. **`seed_position` sirve para los dos tipos de asiento.** Para un `SQUAD` es su lugar en el orden inicial de la temporada; para un `GUEST`, su lugar entre los invitados de esa fecha. Es la misma idea —"tu lugar en un orden"— con dos alcances, y es lo que hace que reordenar invitados sea persistente en vez de depender del `created_at`.

   **Y trae una consecuencia para el Plan 4:** los dos índices únicos son parciales, y un índice parcial **no puede ser `deferrable`**. Un `update` que intercambia dos posiciones choca contra el índice a mitad de la sentencia. Reordenar —invitados o plantel— se hace en dos pasos dentro de una transacción: primero se corre todo el bloque fuera de rango (`seed_position + 1000`), después se escriben los valores finales. Queda anotado acá para que no se descubra el día que alguien arrastra un nombre.

2. **`pair_locks`** guarda las parejas que el admin traba antes del sorteo. Cubre las dos cosas con un solo mecanismo: el equipo de invitados que vino a jugar junto, y el invitado que el admin quiere poner con alguien en concreto (spec 2.6). Se eligió sobre una columna `guest_team` en `entries` justamente porque aquella sólo podía agrupar invitados entre sí, y dejaba la regla del spec sin implementar.

3. **`matchdays.kind`** distingue la jornada del Masters. El Masters reusa `pairs`, `matches` y `match_sets` sin cambiarles nada, y no escribe `awards`.

4. **Una sola fecha viva por temporada**, con un índice único parcial. Es la traducción exacta de "abrir fecha N sólo si no hay ninguna abierta" de `ui-screens.md`, y sale gratis.

5. **`check (games_a <> games_b)`.** El requisito "rechazar un set con games iguales" vive en la base y no sólo en TypeScript. Un `4-4` no le suma a nadie: la pareja juega, no gana, y el head-to-head devuelve 0. Es un empate silencioso en un deporte que no los tiene, y la última línea tiene que impedirlo aunque falle todo lo demás.

**Las fechas se crean de a una.** No se insertan las 10 al crear la temporada: la pantalla de Fechas dibuja las que faltan a partir de `regularMatchdays`, que está en la config. Insertarlas por adelantado chocaría con el índice de una sola fecha viva y llenaría la tabla de filas que no pasaron nada.

- [ ] **Step 1: `supabase/migrations/0001_schema.sql`**

```sql
-- ── players ──────────────────────────────────────────────────────────────────
-- Una persona en el sistema. Nace SIN cuenta: el admin tipea el nombre mucho
-- antes de que exista un usuario.
create table public.players (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) > 0),
  user_id      uuid unique references auth.users on delete cascade,
  created_at   timestamptz not null default now()
);

-- ── seasons ──────────────────────────────────────────────────────────────────
create table public.seasons (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) > 0),
  status           text not null default 'SETUP' check (status in ('SETUP', 'ACTIVE', 'FINISHED')),
  config           jsonb not null,
  rules_text       text not null default '',
  rules_updated_at timestamptz,
  -- gen_random_uuid es built-in desde Postgres 13: 122 bits de entropía sin
  -- depender de pgcrypto ni del schema `extensions`, que no existe fuera de
  -- Supabase y haría fallar la migración en cualquier Postgres pelado.
  invite_token     text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_by       uuid not null references auth.users on delete restrict,
  created_at       timestamptz not null default now()
);

-- ── matchdays ────────────────────────────────────────────────────────────────
create table public.matchdays (
  id        uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons on delete cascade,
  number    int  not null check (number >= 1),
  -- El Masters es una fecha más: 4 jugadores, 3 partidos, 6 parejas distintas,
  -- exactamente la forma que ya tienen `pairs` y `matches`. Lo único que NO usa
  -- es `awards`: el spec 2.7 dice que define al campeón del año, no que reparta
  -- puntos. Es columna y no `number = regularMatchdays + 1` porque
  -- `regularMatchdays` se edita con la temporada empezada (spec 2.9), y ahí el
  -- Masters cambiaría de fecha solo.
  kind      text not null default 'REGULAR' check (kind in ('REGULAR', 'MASTERS')),
  status    text not null default 'DRAFT' check (status in ('DRAFT', 'OPEN', 'CLOSED')),
  played_on date,
  closed_at timestamptz,
  unique (season_id, number),
  -- Para que un invitado quede atado a la temporada de su fecha y no a otra.
  unique (id, season_id)
);

-- Una fecha viva por temporada: no se abre la 4 con la 3 a medio cerrar.
create unique index matchdays_one_live    on public.matchdays (season_id) where status <> 'CLOSED';
create unique index matchdays_one_masters on public.matchdays (season_id) where kind = 'MASTERS';
create index matchdays_by_season on public.matchdays (season_id, number);

-- ── entries ──────────────────────────────────────────────────────────────────
-- El asiento. Los partidos referencian ESTO, nunca a un player: reclamar un
-- perfil tiene que ser un update, no reescribir la historia del campeonato.
create table public.entries (
  id            uuid primary key default gen_random_uuid(),
  season_id     uuid not null references public.seasons on delete cascade,
  player_id     uuid references public.players on delete set null,
  display_name  text not null default '',
  kind          text not null check (kind in ('SQUAD', 'GUEST')),
  -- SQUAD: su lugar en el orden inicial de la temporada.
  -- GUEST: su lugar entre los invitados de su fecha.
  seed_position int not null check (seed_position >= 0),
  matchday_id   uuid,
  created_at    timestamptz not null default now(),

  constraint entries_shape check (
    (kind = 'SQUAD' and matchday_id is null) or
    (kind = 'GUEST' and matchday_id is not null)
  ),
  -- El invitado puede existir sin nombre para poder generar las parejas; la
  -- fecha no se abre así (spec 2.6), pero eso lo controla el borde.
  constraint entries_squad_named check (kind = 'GUEST' or length(trim(display_name)) > 0),
  constraint entries_guest_matchday
    foreign key (matchday_id, season_id) references public.matchdays (id, season_id) on delete cascade,
  -- Ancla para que pairs, attendances, pair_locks y awards puedan atar cada
  -- asiento a SU temporada con una FK compuesta, en vez de una simple que
  -- deja mezclar entries de temporadas distintas en la misma fila.
  unique (id, season_id),
  -- Ancla para que attendances pueda exigir SQUAD con una FK en vez de un
  -- check: `kind` no es constante en la fila referenciante, así que sólo una
  -- referencia a esta columna lo puede fijar.
  unique (id, kind)
);

create unique index entries_seed        on public.entries (season_id, seed_position)   where kind = 'SQUAD';
create unique index entries_guest_order on public.entries (matchday_id, seed_position) where kind = 'GUEST';
create unique index entries_one_seat    on public.entries (season_id, player_id)       where player_id is not null;
create index entries_by_season on public.entries (season_id);

-- ── attendances ──────────────────────────────────────────────────────────────
-- Sólo para asientos SQUAD. El invitado no necesita fila: su propia existencia
-- como entry de esa fecha ya dice que juega.
create table public.attendances (
  id          uuid primary key default gen_random_uuid(),
  matchday_id uuid not null,
  entry_id    uuid not null,
  season_id   uuid not null,
  -- Existe como columna (no sólo como check) porque hace falta del lado
  -- "muchos" de una FK: es la mitad fija que, contra entries (id, kind),
  -- rechaza cualquier entry_id que sea GUEST.
  entry_kind  text not null default 'SQUAD' check (entry_kind = 'SQUAD'),
  status      text not null check (status in ('PLAYING', 'ABSENT')),
  unique (matchday_id, entry_id),
  -- La fecha de la asistencia tiene que ser de la MISMA temporada que la
  -- asistencia: sin esto, una fecha puede recibir presentismo de un asiento
  -- que ni siquiera existe en su temporada.
  foreign key (matchday_id, season_id) references public.matchdays (id, season_id) on delete cascade,
  foreign key (entry_id, season_id) references public.entries (id, season_id) on delete cascade,
  -- Esto —no el comentario de arriba de la tabla— es lo que de verdad hace
  -- que attendances sea SQUAD-only: un GUEST nunca tiene una fila de entries
  -- con kind = 'SQUAD', así que el insert lo rechaza en el borde de la base.
  foreign key (entry_id, entry_kind) references public.entries (id, kind)
);

-- ── pair_locks ───────────────────────────────────────────────────────────────
-- Parejas que el admin traba ANTES del sorteo: el equipo invitado que vino a
-- jugar junto, o el invitado que el admin quiere poner con alguien en concreto
-- (spec 2.6). Todavía no son parejas — son una restricción del armado —, y por
-- eso viven aparte de `pairs`.
--
-- Toda pareja trabada tiene que incluir a un invitado. Eso NO se puede escribir
-- como check porque `kind` vive en `entries`: lo impone el borde, y el motivo
-- es que dos del plantel trabados a mano saltearían la regla de no repetir, que
-- es el corazón del formato.
create table public.pair_locks (
  id          uuid primary key default gen_random_uuid(),
  matchday_id uuid not null,
  entry_a     uuid not null,
  entry_b     uuid not null,
  season_id   uuid not null,
  check (entry_a <> entry_b),
  -- Cubren la mitad de "nadie en dos parejas trabadas": alguien podría estar
  -- como entry_a de una y entry_b de otra. Esa mitad la valida el borde.
  unique (matchday_id, entry_a),
  unique (matchday_id, entry_b),
  -- La fecha del lock tiene que ser de la MISMA temporada que el lock.
  foreign key (matchday_id, season_id) references public.matchdays (id, season_id) on delete cascade,
  -- Cada mitad del lock tiene que ser un asiento de ESA temporada: sin esto
  -- se puede trabar a un invitado de esta fecha contra un asiento que vive
  -- en otra temporada.
  foreign key (entry_a, season_id) references public.entries (id, season_id) on delete cascade,
  foreign key (entry_b, season_id) references public.entries (id, season_id) on delete cascade
);

create index pair_locks_by_matchday on public.pair_locks (matchday_id);

-- ── pairs ────────────────────────────────────────────────────────────────────
create table public.pairs (
  id          uuid primary key default gen_random_uuid(),
  matchday_id uuid not null,
  season_id   uuid not null,
  -- NO cascade: dar de baja a un jugador no puede borrar las parejas de las
  -- fechas que ya se jugaron. `no action` y no `restrict` a propósito: se
  -- verifica al final de la sentencia, así que borrar la temporada entera
  -- —que arrastra fechas y asientos juntos— sigue funcionando.
  entry_a     uuid not null,
  entry_b     uuid not null,
  check (entry_a <> entry_b),
  -- Habilita la FK compuesta de matches.
  unique (id, matchday_id),
  -- La fecha de la pareja tiene que ser de la MISMA temporada que la pareja:
  -- sin esto, season_id es un campo suelto que un insert puede desalinear
  -- del matchday_id real.
  foreign key (matchday_id, season_id) references public.matchdays (id, season_id) on delete cascade,
  -- Cada mitad de la pareja tiene que ser un asiento de ESA temporada. Sin
  -- esto, una pareja puede nacer con un entry prestado de otra temporada, y
  -- esa fila vuelve indestructible a la temporada ajena: la FK la sigue
  -- necesitando viva aunque se la quiera borrar entera.
  foreign key (entry_a, season_id) references public.entries (id, season_id) on delete no action,
  foreign key (entry_b, season_id) references public.entries (id, season_id) on delete no action
);

create index pairs_by_matchday on public.pairs (matchday_id);

-- ── matches ──────────────────────────────────────────────────────────────────
create table public.matches (
  id          uuid primary key default gen_random_uuid(),
  matchday_id uuid not null references public.matchdays on delete cascade,
  round       int  not null check (round >= 1),
  pair_a      uuid not null,
  pair_b      uuid not null,
  check (pair_a <> pair_b),
  -- Un partido sólo enfrenta parejas de SU fecha. Sin esto, un bug de índices
  -- al escribir el fixture arma un round robin donde cada pareja juega contra
  -- quien no debe, y la tabla resultante se ve perfectamente normal.
  foreign key (pair_a, matchday_id) references public.pairs (id, matchday_id) on delete cascade,
  foreign key (pair_b, matchday_id) references public.pairs (id, matchday_id) on delete cascade
);

create index matches_by_matchday on public.matches (matchday_id, round);

-- ── match_sets ───────────────────────────────────────────────────────────────
create table public.match_sets (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches on delete cascade,
  set_number int  not null check (set_number >= 1),
  games_a    int  not null check (games_a >= 0),
  games_b    int  not null check (games_b >= 0),
  unique (match_id, set_number),
  -- En padel no hay empates. Un set igualado no le suma a nadie y el
  -- head-to-head devuelve 0: es un resultado que no puede entrar.
  constraint match_sets_no_draw check (games_a <> games_b)
);

-- ── awards ───────────────────────────────────────────────────────────────────
-- La única desnormalización del diseño, y tiene motivo: si el año que viene
-- cambian la tabla de puntos, el histórico no se mueve.
create table public.awards (
  id          uuid primary key default gen_random_uuid(),
  matchday_id uuid not null,
  -- Mismo motivo que en pairs: el histórico no se borra por dar de baja a
  -- alguien. Spec 2.9: las fechas cerradas no se alteran nunca.
  entry_id    uuid not null,
  season_id   uuid not null,
  -- Posición del CAMPEONATO: una pareja hecha sólo de invitados no ocupa
  -- puesto, así que puede no coincidir con el lugar en la tabla de la fecha.
  position    int not null check (position >= 1),
  points      int not null check (points > 0),
  unique (matchday_id, entry_id),
  -- La fecha del premio tiene que ser de la MISMA temporada que el premio.
  foreign key (matchday_id, season_id) references public.matchdays (id, season_id) on delete cascade,
  -- Mismo motivo que en pairs: preservar el histórico no puede volver
  -- indestructible a una temporada ajena que sólo prestó el entry.
  foreign key (entry_id, season_id) references public.entries (id, season_id) on delete no action
);

create index awards_by_matchday on public.awards (matchday_id);
```

- [ ] **Step 2: `supabase/seed.sql`**

Una temporada de demo para poder mirar la app con el ojo. Un usuario admin en `auth.users`, una `season` con la config por defecto de 8, ocho `entries` SQUAD con `seed_position` 0 a 7 y **ninguna reclamada**, para que la pantalla de Unirse tenga qué mostrar. El token de invitación fijo (`'demo'`) así el link es tipeable.

- [ ] **Step 3: Aplicar y verificar**

```bash
npm run db:reset
```

Y a mano, contra la base, comprobar que los invariantes muerden:

```sql
-- rechaza un set empatado
insert into match_sets (match_id, set_number, games_a, games_b) values (..., 1, 4, 4);
-- rechaza dos fechas vivas en la misma temporada
insert into matchdays (season_id, number, status) values (..., 2, 'DRAFT');
-- rechaza un invitado de una fecha de otra temporada
-- rechaza un partido que enfrenta una pareja de OTRA fecha
insert into matches (matchday_id, round, pair_a, pair_b) values (<fecha 4>, 1, <pareja de la fecha 3>, ...);
-- rechaza borrar un asiento que ya jugó una fecha cerrada
delete from entries where id = <alguien con awards>;
-- rechaza dos Masters en la misma temporada
-- pero SÍ deja borrar la temporada entera
delete from seasons where id = <la temporada>;
```

**Expected:** las seis primeras fallan con error de constraint, la última funciona. Anotar en el commit cuál error dio cada una. **La última no es un capricho:** es la que distingue `no action` de `restrict`, y si se escribió `restrict` va a fallar.

- [ ] **Step 4: Generar los tipos y escribir `db/client.ts`**

```bash
npm run db:types
```

Y recién ahora, con `db/database.types.ts` existiendo, el bloque de `db/client.ts` que la Task 1 dejó adelantado. Copiarlo de ahí tal cual.

**`npm run db:types` se vuelve a correr al final de las Tasks 8, 11, 12 y 13**, porque cada una agrega funciones SQL y `supabase.rpc('close_matchday', …)` no tipa hasta que aparecen en `Database['public']['Functions']`. Está anotado en cada una.

- [ ] **Step 5: Verificar**

```bash
npm run typecheck
```

```bash
git add supabase/migrations/0001_schema.sql supabase/seed.sql db/database.types.ts db/client.ts
git commit -m "feat: add the championship schema with its database invariants"
```

---

### Task 6: RLS

**Files:**
- Create: `supabase/migrations/0002_rls.sql`

**Interfaces:**
- Consumes: las tablas de la Task 5
- Produces: `is_participant(uuid)`, `is_season_admin(uuid)`, `matchday_season(uuid)` y una política por tabla y operación

**Qué NO hace esta tarea:** no escribe pantallas, no expone nada a `anon` —la página pública de reglas es del Plan 3 y se lleva su propia función—, no implementa el reclamo de asiento (Task 8).

**El modelo, en tres frases:**

- **Leer un torneo:** hay que participar de él. Ser el admin cuenta como participar.
- **Escribir un torneo:** hay que ser su admin. Sin excepciones; el reclamo de asiento sale por una función aparte, no por una política de update.
- **`anon` no ve nada.** Ni una fila.

**La objeción que se tuvo en cuenta.** La versión fácil era "cualquiera logueado lee todo", que alcanza para un grupo de amigos. Se descartó: con PostgREST, "lee todo" significa que un usuario cualquiera puede pedir la tabla `seasons` entera y llevarse **todos los `invite_token`**, o sea la llave para meterse en el torneo de cualquiera. El costo de evitarlo son dos funciones y un `exists`.

- [ ] **Step 1: `supabase/migrations/0002_rls.sql`**

```sql
-- ── helpers ──────────────────────────────────────────────────────────────────
-- security definer para que no dependan de las políticas de las tablas que
-- consultan: si `entries` sólo fuera legible por participantes, preguntar
-- "¿soy participante?" leyendo `entries` sería circular.
--
-- `search_path = ''` y todo calificado, no `= public`. Con `public` en el path,
-- `pg_temp` se sigue buscando PRIMERO para nombres de relación, así que un
-- `create temp table seasons(...)` desde una conexión directa haría que un
-- `from seasons` sin calificar resuelva a la tabla del atacante.

create or replace function public.is_participant(p_season uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.seasons s
    where s.id = p_season and s.created_by = (select auth.uid())
  ) or exists (
    select 1
      from public.entries e
      join public.players p on p.id = e.player_id
     where e.season_id = p_season and p.user_id = (select auth.uid())
  )
$$;

create or replace function public.is_season_admin(p_season uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.seasons s
    where s.id = p_season and s.created_by = (select auth.uid())
  )
$$;

create or replace function public.matchday_season(p_matchday uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select season_id from public.matchdays where id = p_matchday
$$;

create or replace function public.match_season(p_match uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.season_id
    from public.matchdays m
    join public.matches x on x.matchday_id = m.id
   where x.id = p_match
$$;

/* Un resultado sólo se toca con la fecha en juego. En DRAFT no hay partidos y
   en CLOSED los awards ya están congelados: escribir ahí deja la tabla
   histórica diciendo una cosa y los puntos otra, sin que nada falle. */
create or replace function public.match_is_open(p_match uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.matchdays m
      join public.matches x on x.matchday_id = m.id
     where x.id = p_match and m.status = 'OPEN'
  )
$$;

-- Postgres otorga EXECUTE a PUBLIC en toda función nueva, y Supabase además
-- tiene default privileges para anon. Un `revoke ... from anon` solo NO alcanza:
-- hay que sacarle el grant a PUBLIC. Sin esto, cualquiera sin cuenta ejecuta
-- estas funciones por PostgREST.
revoke execute on function
    public.is_participant(uuid),
    public.is_season_admin(uuid),
    public.matchday_season(uuid),
    public.match_season(uuid),
    public.match_is_open(uuid)
  from public, anon;

grant execute on function
    public.is_participant(uuid),
    public.is_season_admin(uuid),
    public.matchday_season(uuid),
    public.match_season(uuid),
    public.match_is_open(uuid)
  to authenticated;

-- ── prender RLS en todo ──────────────────────────────────────────────────────
alter table public.players     enable row level security;
alter table public.seasons     enable row level security;
alter table public.matchdays   enable row level security;
alter table public.entries     enable row level security;
alter table public.attendances enable row level security;
alter table public.pair_locks  enable row level security;
alter table public.pairs       enable row level security;
alter table public.matches     enable row level security;
alter table public.match_sets  enable row level security;
alter table public.awards      enable row level security;

-- ── players ──────────────────────────────────────────────────────────────────
-- Nadie inserta a mano: el trigger de alta lo hace (Task 7). Y nadie edita:
-- editarse el nombre es una pantalla del Plan 3, así que hasta entonces no hay
-- política de update — una política sin pantalla es superficie de ataque gratis.
create policy players_read on public.players
  for select to authenticated using (true);

-- `user_id` es el UUID de auth.users: es de la persona, no del grupo. Una
-- revocación de columna NO tiene efecto si el privilegio está otorgado a nivel
-- tabla, así que hay que revocar la tabla y volver a otorgar por columna.
revoke select on public.players from authenticated, anon;
grant  select (id, display_name, created_at) on public.players to authenticated;

-- ── seasons ──────────────────────────────────────────────────────────────────
create policy seasons_read on public.seasons
  for select to authenticated using (public.is_participant(id));

create policy seasons_insert on public.seasons
  for insert to authenticated with check (created_by = (select auth.uid()));

create policy seasons_update on public.seasons
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

create policy seasons_delete on public.seasons
  for delete to authenticated using (created_by = (select auth.uid()));

-- ── tablas con season_id propio ──────────────────────────────────────────────
create policy entries_read on public.entries
  for select to authenticated using (public.is_participant(season_id));

create policy entries_write on public.entries
  for all to authenticated
  using (public.is_season_admin(season_id))
  with check (public.is_season_admin(season_id));

create policy matchdays_read on public.matchdays
  for select to authenticated using (public.is_participant(season_id));

create policy matchdays_write on public.matchdays
  for all to authenticated
  using (public.is_season_admin(season_id))
  with check (public.is_season_admin(season_id));

-- ── tablas que llegan a la temporada por su fecha ────────────────────────────
create policy attendances_read on public.attendances
  for select to authenticated using (public.is_participant(public.matchday_season(matchday_id)));

create policy attendances_write on public.attendances
  for all to authenticated
  using (public.is_season_admin(public.matchday_season(matchday_id)))
  with check (public.is_season_admin(public.matchday_season(matchday_id)));

create policy pair_locks_read on public.pair_locks
  for select to authenticated using (public.is_participant(public.matchday_season(matchday_id)));

create policy pair_locks_write on public.pair_locks
  for all to authenticated
  using (public.is_season_admin(public.matchday_season(matchday_id)))
  with check (public.is_season_admin(public.matchday_season(matchday_id)));

create policy pairs_read on public.pairs
  for select to authenticated using (public.is_participant(public.matchday_season(matchday_id)));

create policy pairs_write on public.pairs
  for all to authenticated
  using (public.is_season_admin(public.matchday_season(matchday_id)))
  with check (public.is_season_admin(public.matchday_season(matchday_id)));

create policy matches_read on public.matches
  for select to authenticated using (public.is_participant(public.matchday_season(matchday_id)));

create policy matches_write on public.matches
  for all to authenticated
  using (public.is_season_admin(public.matchday_season(matchday_id)))
  with check (public.is_season_admin(public.matchday_season(matchday_id)));

create policy awards_read on public.awards
  for select to authenticated using (public.is_participant(public.matchday_season(matchday_id)));

create policy awards_write on public.awards
  for all to authenticated
  using (public.is_season_admin(public.matchday_season(matchday_id)))
  with check (public.is_season_admin(public.matchday_season(matchday_id)));

-- ── match_sets, que llega por el partido ─────────────────────────────────────
create policy match_sets_read on public.match_sets
  for select to authenticated using (public.is_participant(public.match_season(match_id)));

-- El `match_is_open` es lo que impide reescribir el resultado de una fecha ya
-- cerrada. Sin él, los awards congelados y la tabla que sale de match_sets
-- pueden decir cosas distintas y ninguna pantalla se rompe.
create policy match_sets_write on public.match_sets
  for all to authenticated
  using (public.is_season_admin(public.match_season(match_id)) and public.match_is_open(match_id))
  with check (public.is_season_admin(public.match_season(match_id)) and public.match_is_open(match_id));

-- ── el estado de la fecha lo mueven las funciones, no un PATCH ───────────────
-- Sin esto, `PATCH /matchdays?id=eq.X {"status":"OPEN"}` reabre cualquier fecha
-- salteando los controles de reopen_matchday y dejando los awards colgados.
-- Las políticas de arriba no lo frenan: PostgREST no distingue qué columna se
-- actualizó, que es el mismo motivo por el que el reclamo de asiento va por
-- función (Task 8).
revoke insert, update on public.matchdays from authenticated, anon;
grant  insert (season_id, number, played_on) on public.matchdays to authenticated;
grant  update (played_on)                    on public.matchdays to authenticated;
```

**Las tres funciones que mueven el estado pasan a `security definer` con chequeo explícito de admin** (Tasks 11, 12 y 13), porque con esta revocación un `invoker` ya no podría escribir `status`. Un `definer` sin chequeo sería un agujero; un `definer` que arranca con `if not is_season_admin(...) then raise` es más seguro que el `invoker`, porque además puede dar el mensaje correcto en vez de "la fecha no existe" (que es lo que devuelve un `for update` filtrado por RLS).

- [ ] **Step 2: `db/test/` — los andamios que usan las seis suites de base**

Ninguna de las seis suites `.db.test.ts` de este plan puede escribirse sin esto, así que se construye acá, una vez:

| Archivo | Qué expone |
|---|---|
| `db/test/env.ts` | ya existe (Task 1): carga `.env.local` |
| `db/test/admin.ts` | `adminClient()`, con `SUPABASE_SERVICE_ROLE_KEY`. **Saltea RLS**: es para armar la escena, nunca para asertar |
| `db/test/users.ts` | `createTestUser(email?)` → crea el usuario con la Admin API y devuelve un cliente autenticado más su `playerId`. Mail único por llamada |
| `db/test/factories.ts` | `createSeason({ admin, config?, squad? })` → temporada + plantel con `seed_position` correlativo, y devuelve los ids |

**El aislamiento es por temporada, no por proceso.** Cada test crea la suya; todo cuelga de `seasons` con `on delete cascade`, así que no hace falta truncar nada entre tests ni serializar la base. Es lo que permite que `db:reset` corra una sola vez.

- [ ] **Step 3: Los tests de RLS**

Create `db/rls.db.test.ts`. Es el archivo **más importante** de este plan: una política mal escrita no rompe ninguna pantalla, no tira ningún error y no aparece en ningún log. Sólo se nota cuando alguien mira lo que no tenía que mirar.

```typescript
describe('RLS — lectura', () => {
  it('un extraño no ve la temporada', async () => { /* data === [] */ })
  it('un extraño no ve el plantel', async () => {})
  it('un participante ve la temporada y el plantel', async () => {})
  it('nadie puede listar el invite_token de un torneo ajeno', async () => {})
  it('nadie puede leer el user_id de otro jugador', async () => {})
  it('anon no ve una sola fila de ninguna de las diez tablas', async () => {})
})

describe('RLS — escritura', () => {
  it('un participante no puede editar la temporada', async () => {})
  it('un participante no puede cargar un resultado', async () => {})
  it('el admin escribe todo lo de su torneo', async () => {})
  it('el admin de un torneo no escribe en el de otro', async () => {})
  it('nadie puede mover matchdays.status con un update directo', async () => {})
  it('no se puede cargar un resultado en una fecha cerrada', async () => {})
})

describe('RLS — funciones', () => {
  it('anon no puede ejecutar ninguna de las cinco helpers', async () => {
    // Tiene que fallar con "permission denied for function", NO con
    // cualquier error: un revoke mal escrito igual devuelve error por otro
    // motivo y el test pasaría en verde con el agujero abierto.
  })
})
```

**Dos formas de que este archivo se vuelva decorativo, las dos anotadas adentro:**

1. **Un `select` bloqueado por RLS devuelve lista vacía, no un error.** Un test que asserte "tiró error" pasa por la razón equivocada y seguiría pasando si la política desapareciera. Hay que asertar `data` vacío.
2. **Un test de permisos que asserta "tiró cualquier error" no prueba nada.** Postgres tiene mil motivos para fallar. Hay que asertar el código: `42501` para permisos.

- [ ] **Step 4: Verificar**

```bash
npm run db:reset && npm run test:db
```

**Expected: PASS — 13 tests.**

```bash
git add supabase/migrations/0002_rls.sql db/rls.db.test.ts db/test
git commit -m "feat: lock every table behind participation and admin policies"
```

---

### Task 7: Cuentas — registro, login y Google

**Files:**
- Create: `supabase/migrations/0003_new_user.sql`
- Create: `app/auth/actions.ts`, `app/auth/callback/route.ts`
- Create: `app/registro/page.tsx`, `app/login/page.tsx`
- Modify: `app/page.tsx` (la landing)
- Test: `db/auth.db.test.ts`

**Interfaces:**
- Consumes: `serverClient` de `db/client.ts`
- Produces: `signUp`, `signIn`, `signOut` como server actions; `/auth/callback` para Google

**Qué NO hace esta tarea:** no hay magic link —teniendo contraseña sería un tercer camino sin aporte—, no hay recuperación de contraseña implementada (el link existe y va a una pantalla que dice que llega pronto), no hay verificación de email obligatoria en local, no hay pantalla de "Mis torneos".

**El trigger de alta.** Un `user` de Supabase Auth no es un `player`. La app trabaja con `players`, así que hace falta uno por usuario, creado en el mismo momento. Un trigger sobre `auth.users` lo garantiza pase lo que pase: registro por formulario, por Google, o creado a mano desde el panel.

- [ ] **Step 1: `supabase/migrations/0003_new_user.sql`**

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.players (display_name, user_id)
  values (
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Jugador'
    ),
    new.id
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

`full_name` es el campo que manda Google; `display_name` el del formulario. Si no viene ninguno, el pedazo del mail antes de la arroba.

**Los dos `nullif` y el `'Jugador'` del final no son paranoia.** `auth.users.email` es nullable, y `players.display_name` es `not null` con un check de no-vacío. El trigger es `after insert` **dentro de la transacción del alta**: si tira, aborta el registro entero y el usuario ve "no pudimos crear la cuenta" para siempre, sin ninguna forma de que funcione. `split_part(NULL, '@', 1)` devuelve NULL y `split_part('', '@', 1)` devuelve `''`: los dos rompen.

- [ ] **Step 2: Escribir los tests que fallan**

Create `db/auth.db.test.ts`:

```typescript
describe('alta de cuenta', () => {
  it('crea un player al registrarse', async () => {})
  it('usa el display_name del formulario', async () => {})
  it('cae al pedazo del mail cuando no viene nombre', async () => {})
  it('un player por usuario, no dos', async () => {})
})
```

**Expected: FAIL**

- [ ] **Step 3: `app/auth/actions.ts`**

```typescript
'use server'

import { redirect } from 'next/navigation'
import { serverClient } from '@/db/client'

export interface FormState {
  error: string | null
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MIN_PASSWORD = 6

export async function signUp(_state: FormState, form: FormData): Promise<FormState> {
  const displayName = String(form.get('displayName') ?? '').trim()
  const email = String(form.get('email') ?? '').trim()
  const password = String(form.get('password') ?? '')

  if (displayName.length === 0) return { error: 'Escribí tu nombre.' }
  if (!EMAIL.test(email)) return { error: 'Escribí un mail válido, con @ y dominio.' }
  if (password.length < MIN_PASSWORD) return { error: `Mínimo ${MIN_PASSWORD} caracteres.` }

  const supabase = await serverClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  })
  if (error !== null) return { error: 'No pudimos crear la cuenta. Probá de nuevo.' }

  redirect('/')
}

export async function signIn(_state: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim()
  const password = String(form.get('password') ?? '')

  const supabase = await serverClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  // Un mensaje distinto para "no existe el mail" y para "la contraseña está
  // mal" le confirma a cualquiera qué mails están registrados. Uno solo.
  if (error !== null) return { error: 'Mail o contraseña incorrectos.' }

  redirect('/')
}

export async function signOut(): Promise<void> {
  const supabase = await serverClient()
  await supabase.auth.signOut()
  redirect('/')
}
```

**`redirect` tira una excepción para navegar.** Va afuera de cualquier `try/catch` que envuelva al cliente de Supabase, o el catch se come la navegación y la pantalla queda colgada sin decir nada.

- [ ] **Step 4: `app/auth/callback/route.ts`**

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { serverClient } from '@/db/client'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (code === null) {
    return NextResponse.redirect(`${origin}/login?error=google`)
  }

  const supabase = await serverClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error !== null) {
    return NextResponse.redirect(`${origin}/login?error=google`)
  }

  // `next` viene de la query, así que sólo se acepta una ruta relativa: un
  // `next=https://otro-sitio` lo convertiría en un redirector abierto.
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/'
  return NextResponse.redirect(`${origin}${target}`)
}
```

- [ ] **Step 5: Las pantallas**

Contrato, contra `docs/padel_design/README.md` sección "2. Registro / 3. Login". Los textos son parte del contrato:

| | Registro | Login |
|---|---|---|
| Título | "Creá tu cuenta" | "Entrá a tu cuenta" |
| Bajada | "Sólo para poder volver a entrar desde otro teléfono. Nada más." | "Con el mail que usaste cuando entraste al torneo." |
| Campos | Tu nombre, Mail, Contraseña | Mail, Contraseña |
| CTA | "Crear cuenta" | "Entrar" |
| Link cruzado | "Iniciar sesión" | "Crear cuenta" |
| Extra | legal al pie | "Olvidé mi contraseña" |

Errores exactos: `Escribí un mail válido, con @ y dominio.` · `Mínimo 6 caracteres.` · `Mail o contraseña incorrectos.`

El botón de Google va **arriba** del formulario, con separador. Llama a `signInWithOAuth({ provider: 'google', options: { redirectTo: <origin>/auth/callback } })` desde un client component.

Estados a dibujar: vacío · enviando · error de campo · error de Google.

- [ ] **Step 6: Google, a mano**

Configurar el provider en `supabase/config.toml` y las credenciales por variable de entorno. **Este camino no tiene test automático**: el consentimiento de Google no se puede guionar sin un navegador de verdad, y montar Playwright para un botón sería la cola moviendo al perro. Se verifica a mano y queda en el criterio de terminado como ítem de checklist, no como test.

- [ ] **Step 7: Verificar**

```bash
npm run db:reset && npm run test:db
npm run typecheck
```

**Expected: PASS — 4 tests.** Más, a mano: registrarse, salir, entrar, entrar con Google.

```bash
git add supabase/migrations/0003_new_user.sql app/auth app/registro app/login app/page.tsx db/auth.db.test.ts
git commit -m "feat: sign up, sign in and Google, with a player per account"
```

---

### Task 8: Unirse por link — el reclamo de asiento

**Files:**
- Create: `supabase/migrations/0004_claim_seat.sql`
- Create: `app/unirse/[token]/page.tsx`, `app/unirse/[token]/actions.ts`
- Test: `db/claim.db.test.ts`

**Interfaces:**
- Consumes: `seasons.invite_token`, `entries`
- Produces: `season_invite(p_token text)` y `claim_seat(p_token text, p_entry uuid)`

**Qué NO hace esta tarea:** no crea asientos nuevos (ver abajo), no desvincula un reclamo —eso es Ajustes, Plan 4—, no manda mails, no vence el token, no muestra el torneo después de entrar: redirige a `/` porque "Mis torneos" es del Plan 3.

**El reclamo va por función, no por política.** Una política de `update` sobre `entries` que dejara al jugador tocar su fila también lo dejaría cambiarse el nombre, moverse el `seed_position` o pisar el de otro: PostgREST no distingue qué columna se actualizó. Una función `security definer` hace exactamente una cosa y no hay forma de pedirle otra.

**Contradicción entre documentos, resuelta.** `ui-screens.md` (pantalla 4) ofrece un *"No estoy en la lista" → pide el nombre y crea un asiento nuevo*. El handoff de diseño no tiene ese botón: tiene la nota *"Si tu nombre no está o ya lo tomó otro, avisale a Marce."* **Gana el handoff**, y no por diseño: crear un asiento cambia el tamaño del plantel, y `points` tiene que tener exactamente `squadSize / 2` valores (spec 2.9). Un jugador entrando por un link dejaría la config inválida sin enterarse. Agregar gente es del admin, desde Ajustes, donde la app puede avisar que hay que revisar los puntos. Queda anotado en "Qué queda afuera".

- [ ] **Step 1: Escribir los tests que fallan**

Create `db/claim.db.test.ts`:

```typescript
describe('claim_seat', () => {
  it('ata el asiento al player del que llama', async () => {})
  it('rechaza un token que no existe', async () => {})
  it('rechaza un asiento que ya tiene dueño', async () => {})
  it('rechaza un asiento de otra temporada aunque el token sea válido', async () => {})
  it('rechaza al que ya tiene lugar en ese torneo', async () => {})
  it('no deja reclamar un asiento de invitado', async () => {})
  it('dos reclamos simultáneos del mismo asiento: uno solo entra', async () => {})
  it('anon recibe permission denied, no un error de negocio', async () => {
    // 42501. Con anon, auth.uid() es NULL y la función tira "Entrá con tu
    // cuenta…", así que un test que asserte "tiró error" pasa en verde con el
    // grant abierto. El código del error es lo único que distingue las dos.
  })
})

describe('season_invite', () => {
  it('devuelve los asientos con su estado de reclamado', async () => {})
  it('no devuelve el invite_token', async () => {})
  it('anon recibe permission denied', async () => {
    // Sin el revoke a PUBLIC, esta llamada devuelve el plantel entero de
    // cualquier torneo a cualquiera que tenga el link. No hay error de
    // negocio que la tape: o el grant está cerrado o no lo está.
  })
})
```

El test de simultaneidad se hace con dos `Promise.all` de dos clientes distintos. No es teatro: es el escenario real de un link pegado en un grupo de WhatsApp a las nueve de la noche.

**Expected: FAIL**

- [ ] **Step 2: `supabase/migrations/0004_claim_seat.sql`**

```sql
-- Lo que ve la pantalla de Unirse. security definer porque el que entra por el
-- link todavía no participa, así que las políticas de lectura no lo dejan ver
-- nada de esta temporada — que es justamente lo que viene a arreglar.
create or replace function public.season_invite(p_token text)
returns table (
  season_id    uuid,
  season_name  text,
  admin_name   text,
  squad_size   int,
  entry_id     uuid,
  display_name text,
  seed_position int,
  claimed      boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         s.name,
         admin.display_name,
         (select count(*)::int from public.entries e2
           where e2.season_id = s.id and e2.kind = 'SQUAD'),
         e.id,
         e.display_name,
         e.seed_position,
         e.player_id is not null
    from public.seasons s
    join public.players admin on admin.user_id = s.created_by
    join public.entries e on e.season_id = s.id and e.kind = 'SQUAD'
   where s.invite_token = p_token
   order by e.seed_position
$$;

-- `from public, anon`, no `from anon` solo: Postgres otorga EXECUTE a PUBLIC en
-- toda función nueva, así que revocarle a anon deja intacto el grant heredado y
-- cualquiera sin cuenta se lleva el plantel entero con sólo tener el token.
revoke execute on function public.season_invite(text) from public, anon;
grant  execute on function public.season_invite(text) to authenticated;

-- El reclamo. Devuelve la temporada para poder redirigir.
create or replace function public.claim_seat(p_token text, p_entry uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid;
  v_player uuid;
begin
  select id into v_season from public.seasons where invite_token = p_token;
  if v_season is null then
    raise exception 'El link de invitación no es válido.';
  end if;

  select id into v_player from public.players where user_id = (select auth.uid());
  if v_player is null then
    raise exception 'Entrá con tu cuenta antes de reclamar un lugar.';
  end if;

  if exists (select 1 from public.entries where season_id = v_season and player_id = v_player) then
    raise exception 'Ya tenés un lugar en este torneo.';
  end if;

  -- El `player_id is null` adentro del where es lo que hace atómico al
  -- reclamo: dos personas tocando el mismo asiento a la vez, y la segunda no
  -- encuentra fila.
  update public.entries
     set player_id = v_player
   where id = p_entry
     and season_id = v_season
     and kind = 'SQUAD'
     and player_id is null;

  if not found then
    raise exception 'Ese lugar ya lo reclamó otra persona.';
  end if;

  return v_season;
end;
$$;

revoke execute on function public.claim_seat(text, uuid) from public, anon;
grant  execute on function public.claim_seat(text, uuid) to authenticated;
```

El `exists` de "ya tenés lugar" tiene una ventana entre la consulta y el update. No importa: el índice único `entries_one_seat` la cierra. La consulta está para dar un mensaje claro en el 99,9% de los casos; el índice está para el 0,1% restante.

- [ ] **Step 3: La pantalla**

`app/unirse/[token]/page.tsx`, contra el handoff sección 4. Server component: si no hay sesión, redirige a `/registro?next=/unirse/{token}`.

- Kicker "Te invitaron a" + nombre del torneo
- Meta: `"{n} jugadores · {regularMatchdays} fechas · organiza {admin}"`
- Label "¿Cuál sos vos?" y la lista de asientos: **libre** (tocable) · **tomado** (opacidad .45, tag "Ya entró", no tocable) · **elegido** (borde `accent`, tag "Sos vos")
- CTA: "Elegí tu nombre" deshabilitado → "Entrar como {nombre}" al elegir
- Pie: "Si tu nombre no está o ya lo tomó otro, avisale a {admin}."

Estados: hay asientos libres · todos reclamados · ya tengo asiento (redirige) · token inválido.

- [ ] **Step 4: Corregir `docs/ui-screens.md`**

No es limpieza: `docs/estado.md` declara a `ui-screens.md` **fuente de verdad de la app**, y es el documento que va a leer quien dibuje esta pantalla en el Plan 3. Hoy dice lo contrario de lo que se acaba de decidir.

- Línea 143: sacar `"No estoy en la lista" → pide el nombre y crea un asiento nuevo`, y poner en su lugar la nota del handoff: `Si tu nombre no está o ya lo tomó otro, avisale al organizador`.
- Línea 146: el estado `todos reclamados (y no está en la lista)` queda sin salida. Reescribirlo diciendo que la pantalla muestra la nota y no ofrece acción.
- Agregar una línea al pie de la pantalla 4 explicando por qué: crear un asiento cambia `squadSize`, y `points` tiene que tener exactamente `squadSize / 2` valores.

- [ ] **Step 5: Verificar**

```bash
npm run db:types    # season_invite y claim_seat entran en Database['public']['Functions']
npm run db:reset && npm run test:db
npm run typecheck
```

**Expected: PASS — 11 tests.**

```bash
git add supabase/migrations/0004_claim_seat.sql app/unirse db/claim.db.test.ts db/database.types.ts docs/ui-screens.md
git commit -m "feat: claim a seat through the invite link"
```

---

### Task 9: La validación de borde

**Files:**
- Create: `db/errors.ts`, `db/validate.ts`
- Test: `db/validate.unit.test.ts`

**Interfaces:**
- Consumes: `validateConfig`, `MIN_PLAYERS`, `MAX_PLAYERS` y los tipos, de `core/`
- Produces: `EdgeError`, `assertValidConfig`, `setError`, `matchError`, `assertMatchdaySize`, `assertLocksAndGuests`, `assertPointsCoverMatchday`, `assertGuestsNamed`

**Qué NO hace esta tarea:** no consulta la base —son funciones puras y sus tests no necesitan Docker—, no arma parejas, no guarda nada, no traduce errores de Postgres.

**Acá viven tres requisitos que el Plan 1 dejó anotados como pendientes del borde:**

1. **`validateConfig` se llama siempre.** Devuelve errores, no los tira. Con `tiebreakSnapshotEvery: 0`, `Math.floor((f-1)/0)` da `Infinity` y `snapshotForMatchday` entra en **loop infinito**. No se agrega un guard adentro de `core/`: el contrato es que la config se valida antes de entrar, y este archivo es donde ese contrato se cumple.
2. **Un set con games iguales no entra.** La base ya lo rechaza con un `check`; acá se rechaza antes, con un mensaje que una persona pueda leer.
3. **Los resultados se validan contra `matchFormat`.** Un `5-2` en un set a 4 se rechaza con el motivo, no se guarda "por las dudas".

- [ ] **Step 1: Escribir los tests que fallan**

Create `db/validate.unit.test.ts`:

```typescript
describe('assertValidConfig', () => {
  it('deja pasar la config por defecto', () => {})
  it('frena tiebreakSnapshotEvery en 0, que colgaría la cadena de snapshots', () => {})
  it('junta todos los errores en un mensaje', () => {})
})

describe('setError — set a 4 con tie-break', () => {
  const format = { setsToWin: 1, gamesPerSet: 4, tieBreak: true }

  it.each([[4, 0], [4, 1], [4, 2], [4, 3], [0, 4], [3, 4]])(
    'acepta %i-%i',
    (gamesA, gamesB) => {
      expect(setError({ gamesA, gamesB }, format)).toBeNull()
    },
  )

  it('rechaza 4-4, que no le suma a nadie', () => {
    expect(setError({ gamesA: 4, gamesB: 4 }, format)).toMatch(/no hay empates/)
  })

  it('rechaza 5-2, que no existe en un set a 4', () => {
    expect(setError({ gamesA: 5, gamesB: 2 }, format)).toMatch(/no es un resultado posible/)
  })

  it('rechaza 3-1, que es un set sin terminar', () => {
    expect(setError({ gamesA: 3, gamesB: 1 }, format)).not.toBeNull()
  })

  it('rechaza games negativos y decimales', () => {})
})

describe('setError — sin tie-break hay que ganar por dos', () => {
  const format = { setsToWin: 1, gamesPerSet: 4, tieBreak: false }

  it.each([[4, 0], [4, 1], [4, 2], [5, 3], [6, 4]])('acepta %i-%i', (gamesA, gamesB) => {
    expect(setError({ gamesA, gamesB }, format)).toBeNull()
  })

  it.each([[4, 3], [6, 3], [5, 4]])('rechaza %i-%i', (gamesA, gamesB) => {
    expect(setError({ gamesA, gamesB }, format)).not.toBeNull()
  })
})

describe('matchError', () => {
  it('exige que el partido esté terminado', () => {})
  it('acepta 2-1 en sets cuando setsToWin es 2', () => {})
  it('rechaza 2-2 en sets: sobran', () => {})
  it('rechaza un partido sin sets', () => {})
})

describe('assertMatchdaySize', () => {
  it.each([8, 10, 12])('acepta %i', (size) => {})
  it('rechaza 6 y dice cuántos faltan', () => {})
  it('rechaza 14 y dice cuántos sobran', () => {})
  it('rechaza un número impar', () => {})
})

describe('assertLocksAndGuests', () => {
  it('acepta un invitado suelto', () => {})
  it('acepta dos invitados fijados entre sí', () => {})
  it('acepta un invitado fijado con alguien del torneo', () => {})
  it('acepta una pareja de invitados más un suelto', () => {})
  it('rechaza dos invitados sueltos', () => {})
  it('rechaza fijar a dos jugadores del torneo', () => {
    // Es la regla que protege el formato: dos del plantel fijados a mano se
    // saltean la regla de no repetir, que es lo único que el armado existe
    // para hacer cumplir.
  })
  it('rechaza a alguien fijado en dos parejas', () => {})
})

describe('assertPointsCoverMatchday', () => {
  it('rechaza una fecha de 5 parejas del torneo con puntos para 4', () => {})
  it('no cuenta a la pareja de dos invitados, que no cobra', () => {})
  it('sí cuenta a la pareja de invitado con jugador del torneo, que cobra', () => {})
})

describe('assertGuestsNamed', () => {
  it('rechaza un invitado sin nombre', () => {})
  it('acepta cuando todos tienen nombre', () => {})
})
```

**Ojo con la tabla de "sin tie-break".** Los casos que aceptan y los que rechazan salen de la misma regla; escribirlos como dos `it.each` en vez de un párrafo es lo que hace que un cambio en la fórmula rompa algo. `4-3` sin tie-break **se rechaza**: hay que ganar por dos.

**Expected: FAIL**

- [ ] **Step 2: `db/errors.ts`**

```typescript
/**
 * An error the player is meant to read. Anything that is not one of these is a
 * bug, and its details belong in the server log, not on the screen.
 */
export class EdgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EdgeError'
  }
}
```

- [ ] **Step 3: `db/validate.ts`**

```typescript
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  validateConfig,
  type MatchFormat,
  type SeasonConfig,
  type SetScore,
} from '@/core'
import { EdgeError } from './errors'

/** A guest seat as the database holds it. */
export interface GuestSeat {
  entryId: string
  displayName: string
}

/** A pair the admin settled before the draw — a row of `pair_locks`. */
export interface PairLock {
  a: string
  b: string
}

/**
 * `validateConfig` RETURNS its problems, it never throws, so it only protects
 * callers who read the result. This is the one place that reads it — skipping
 * it is not untidy, it is a hang: `tiebreakSnapshotEvery: 0` makes
 * `snapshotForMatchday` loop forever.
 */
export function assertValidConfig(config: SeasonConfig): void {
  const errors = validateConfig(config)
  if (errors.length > 0) throw new EdgeError(errors.join(' '))
}

/** Null when the set could have been played, a Spanish reason when it could not. */
export function setError(set: SetScore, format: MatchFormat): string | null {
  const { gamesA, gamesB } = set

  if (!Number.isInteger(gamesA) || !Number.isInteger(gamesB) || gamesA < 0 || gamesB < 0) {
    return 'Los games tienen que ser números enteros y no negativos.'
  }
  if (gamesA === gamesB) {
    return `Un set no puede terminar ${gamesA} a ${gamesB}: en padel no hay empates.`
  }

  const { gamesPerSet, tieBreak } = format
  const winner = Math.max(gamesA, gamesB)
  const loser = Math.min(gamesA, gamesB)

  if (tieBreak) {
    // El tie-break corta en gamesPerSet exacto: no existe el 5-3.
    if (winner !== gamesPerSet) {
      return `En un set a ${gamesPerSet} games con tie-break, ${gamesA}-${gamesB} no es un resultado posible.`
    }
    return null
  }

  const closed = winner >= gamesPerSet && (winner === gamesPerSet || winner - loser === 2)
  if (!closed || winner - loser < 2) {
    return `En un set a ${gamesPerSet} games sin tie-break hay que ganar por dos: ${gamesA}-${gamesB} no cierra el set.`
  }
  return null
}

/** Null when the match is a finished, legal match for the format. */
export function matchError(sets: readonly SetScore[], format: MatchFormat): string | null {
  if (sets.length === 0) return 'Falta cargar el resultado de este partido.'

  for (const set of sets) {
    const problem = setError(set, format)
    if (problem !== null) return problem
  }

  let wonA = 0
  let wonB = 0
  for (const set of sets) {
    // setError already ruled out a draw, so one of the two always took it.
    if (set.gamesA > set.gamesB) wonA++
    else wonB++
  }

  const { setsToWin } = format
  const winner = Math.max(wonA, wonB)
  const loser = Math.min(wonA, wonB)
  const sets_ = setsToWin === 1 ? 'set' : 'sets'

  if (winner !== setsToWin) {
    return `El partido se define en ${setsToWin} ${sets_}: ${wonA}-${wonB} no lo cierra.`
  }
  if (loser >= setsToWin) {
    return `Sobran sets: ${wonA}-${wonB} en un partido a ${setsToWin} ${sets_}.`
  }
  return null
}

export function assertMatchdaySize(present: readonly string[]): void {
  if (present.length < MIN_PLAYERS) {
    throw new EdgeError(
      `Con ${present.length} no hay fecha: hacen falta ${MIN_PLAYERS - present.length} más.`,
    )
  }
  if (present.length > MAX_PLAYERS) {
    throw new EdgeError(
      `Con ${present.length} no entra en una tarde: sobran ${present.length - MAX_PLAYERS}.`,
    )
  }
  if (present.length % 2 !== 0) {
    throw new EdgeError(`Son ${present.length} y sólo se juega de a pares. Falta uno.`)
  }
}

/**
 * What the admin is allowed to settle before the draw, and what they are not.
 *
 * Every lock must include a guest. Two squad players locked by hand would skip
 * the no-repeat rule, and that rule IS the format: it is the one thing the whole
 * pairing algorithm exists to enforce.
 *
 * And at most one guest may be left to the draw — the one who fills in for
 * whoever was left without a partner. Everyone else came as a team, or was
 * placed next to somebody on purpose (spec 2.6).
 */
export function assertLocksAndGuests(
  guests: readonly GuestSeat[],
  locks: readonly PairLock[],
): void {
  const isGuest = new Set(guests.map((guest) => guest.entryId))
  const locked = new Set<string>()

  for (const lock of locks) {
    if (!isGuest.has(lock.a) && !isGuest.has(lock.b)) {
      throw new EdgeError(
        'Una pareja fijada a mano tiene que incluir a un invitado: dos jugadores del torneo no se pueden poner juntos.',
      )
    }
    for (const entryId of [lock.a, lock.b]) {
      if (locked.has(entryId)) {
        throw new EdgeError('Alguien está fijado en dos parejas a la vez.')
      }
      locked.add(entryId)
    }
  }

  const loose = guests.filter((guest) => !locked.has(guest.entryId)).length
  if (loose > 1) {
    throw new EdgeError(
      `Hay ${loose} invitados sueltos. Sólo uno puede jugar con alguien del torneo: al resto hay que ponerlos en pareja.`,
    )
  }
}

/**
 * `points` holds exactly squadSize / 2 values, so a matchday padded with a guest
 * team can end up with more championship pairs than there are positions to pay.
 * With a squad of eight and a visiting team, eight players plus two guests make
 * five pairs and only four values exist.
 *
 * A lock made of two guests is the only kind of pair that does not get paid, so
 * it is the only one subtracted. A lock of guest plus squad player does get
 * paid — the partner played and earned it.
 */
export function assertPointsCoverMatchday(
  present: readonly string[],
  guests: readonly GuestSeat[],
  locks: readonly PairLock[],
  config: SeasonConfig,
): void {
  const isGuest = new Set(guests.map((guest) => guest.entryId))
  const guestOnlyPairs = locks.filter(
    (lock) => isGuest.has(lock.a) && isGuest.has(lock.b),
  ).length
  const championshipPairs = present.length / 2 - guestOnlyPairs

  if (championshipPairs > config.points.length) {
    throw new EdgeError(
      `La fecha deja ${championshipPairs} parejas del torneo y la temporada sólo definió puntos para ${config.points.length} posiciones. Agregá valores en Ajustes o sacá un invitado.`,
    )
  }
}

/** Spec 2.6: pairs can be drawn with a nameless guest, but the matchday cannot open. */
export function assertGuestsNamed(guests: readonly GuestSeat[]): void {
  const unnamed = guests.filter((guest) => guest.displayName.trim().length === 0)
  if (unnamed.length === 0) return

  throw new EdgeError(
    unnamed.length === 1
      ? 'Falta ponerle nombre al invitado. Sin eso, nadie sabe quién es el que falta.'
      : `Faltan los nombres de ${unnamed.length} invitados. Sin eso, nadie sabe quiénes son.`,
  )
}
```

- [ ] **Step 4: Verificar**

```bash
npm test
npm run typecheck
```

**Expected: PASS — unos 44 tests, contando cada caso de los `it.each` por separado.**

```bash
git add db/errors.ts db/validate.ts db/validate.unit.test.ts
git commit -m "feat: validate config, results and matchday shape at the edge"
```

---

### Task 10: Leer una temporada y armar el `PairingInput`

**Files:**
- Create: `db/season.ts`, `db/matchday.ts`
- Modify: `db/client.ts` (exportar el tipo `Client`)
- Test: `db/pairing-context.db.test.ts`

**Interfaces:**
- Consumes: todo `core/`, `db/validate.ts`
- Produces: `pairingContextFor(supabase, matchdayId)` → `{ input: PairingInput; config; guests }`

**Qué NO hace esta tarea:** no escribe una sola fila, no arma parejas, no abre ni cierra nada. Sólo lee y compone.

**Es la tarea donde el plan se puede arruinar en silencio.** Todas las decisiones de las tres preguntas confluyen acá: si el `points` sale de una suma cruda, si los invitados llegan sin orden, si los defensores se derivan con un `select` en vez de con `previousContext`, nada se rompe —simplemente el campeonato empieza a jugar otro juego—. Los tests de esta tarea son de composición, no de queries.

- [ ] **Step 1: Escribir los tests que fallan**

Create `db/pairing-context.db.test.ts`:

```typescript
describe('pairingContextFor', () => {
  it('ordena por el ranking de mejores N, no por la suma cruda', async () => {
    // ESTE es el test que cierra la decisión 3, y hay que construirlo con
    // cuidado o pasa en verde con las dos implementaciones.
    //
    // Config: squadSize 8, points [10, 7, 5, 1] (validateConfig la acepta:
    // cuatro valores, descendente, todos > 0), regularMatchdays 4,
    // countBestOf 2, y tiebreakSnapshotEvery 4.
    //
    // Fechas 1 a 3 cerradas. A saca 10, 10, 1. B saca 7, 7, 7.
    //   suma cruda: 21 y 21, EMPATE
    //   ranking (mejores 2): 20 y 14, gana A
    //
    // tiebreakSnapshotEvery 4 es lo que hace que el test discrimine: con el
    // default de 3, en la fecha 4 el snapshot ya sería computeRanking al
    // corte 3 — o sea el mismo ranking — y el empate de la suma cruda se
    // rompería a favor de A igual. Con 4, floor(3/4) = 0 y el snapshot es el
    // orden inicial. Poné a B ANTES que A en el orden inicial: así la suma
    // cruda ordena B-A y el ranking ordena A-B, y sólo una de las dos pasa.
  })
  it('usa el snapshot vigente para la fecha que se está armando', async () => {})
  it('deriva los defensores de los awards de la fecha anterior', async () => {})
  it('marca defendersAlreadyRepeated cuando la pareja viene de dos fechas', async () => {})
  it('no hay defensores en la primera fecha', async () => {})
  it('no hay defensores si la fecha anterior no cerró', async () => {
    // Este estado NO se puede alcanzar por la app: matchdays_one_live no deja
    // dos fechas vivas y createMatchday exige que la anterior esté cerrada.
    // Se arma a mano con el cliente de service role. Es defensa en
    // profundidad de closedHistory, no un flujo real — anotado para que nadie
    // pierda una hora buscando cómo llegar acá por la pantalla.
  })
  it('mete a los invitados al final de present, en su seed_position', async () => {})
  it('lleva las parejas trabadas a fixedPairs', async () => {})
  it('ignora a los ausentes', async () => {})
  it('falla con una config inválida antes de tocar el snapshot', async () => {})
  it('falla cuando las parejas del torneo superan la lista de puntos', async () => {})
  it('falla con dos invitados sueltos', async () => {})
})
```

El primero es **el test que cierra la decisión 3**. Si mañana alguien reemplaza el ranking por un `sum(points)` en SQL, ese test se pone rojo. Sin él, la divergencia recién aparecería en la novena fecha de una temporada real.

**Expected: FAIL**

- [ ] **Step 2: `db/matchday.ts` — la composición**

```typescript
import {
  buildPairs,
  computeRanking,
  previousContext,
  snapshotForMatchday,
  type Award,
  type EntryId,
  type PairingInput,
  type SeasonConfig,
} from '@/core'
import type { Client } from './client'
import { EdgeError } from './errors'
import {
  assertLocksAndGuests,
  assertMatchdaySize,
  assertPointsCoverMatchday,
  assertValidConfig,
  type GuestSeat,
  type PairLock,
} from './validate'

/**
 * What every operation on a matchday needs, whatever it is going to do with it.
 *
 * The snapshot lives here and NOWHERE else. It is the fourth tiebreak of the
 * matchday table (spec 2.3) as well as the tiebreak of the draw, and the two
 * have to be the same one or reopening a matchday and closing it again would
 * produce a different table. A second function computing "the snapshot" its own
 * way is the one bug in this file that no test can catch: both closes would see
 * the same wrong input and agree with each other.
 */
export interface MatchdayContext {
  matchday: MatchdayRow
  config: SeasonConfig
  seedOrder: EntryId[]
  awardsByMatchday: Map<number, Award[]>
  snapshot: EntryId[]
  guests: GuestSeat[]
  locks: PairLock[]
}

export async function matchdayContextFor(
  supabase: Client,
  matchdayId: string,
): Promise<MatchdayContext> {
  const matchday = await requireMatchday(supabase, matchdayId)
  const config = await seasonConfig(supabase, matchday.season_id)
  assertValidConfig(config)

  // The seed order is also the squad, and it must be stable: buildPairs falls
  // back to the order it is given when two players are missing from the
  // snapshot, so an unordered read makes the draw non-deterministic.
  const seedOrder = await squadSeedOrder(supabase, matchday.season_id)

  // Only the CLOSED matchdays BEFORE this one. Never this one: its own table is
  // what the snapshot is being used to break ties in.
  const awardsByMatchday = await awardsBefore(supabase, matchday.season_id, matchday.number)
  const snapshot = snapshotForMatchday(matchday.number, seedOrder, awardsByMatchday, config)

  const guests = await guestsOf(supabase, matchdayId)
  const locks = await locksOf(supabase, matchdayId)
  assertLocksAndGuests(guests, locks)

  return { matchday, config, seedOrder, awardsByMatchday, snapshot, guests, locks }
}

export interface PairingContext extends MatchdayContext {
  input: PairingInput
}

/**
 * Everything the DRAW of one matchday needs, composed out of core/. No rule of
 * the championship is decided here: this function fetches rows and hands them
 * to the functions that know.
 *
 * Closing a matchday does NOT go through here. It asks a different question —
 * "what does what was played pay?" — and running the draw's validations over
 * today's attendance while closing is how a matchday gets stuck.
 */
export async function pairingContextFor(
  supabase: Client,
  matchdayId: string,
): Promise<PairingContext> {
  const context = await matchdayContextFor(supabase, matchdayId)
  const { matchday, config, seedOrder, awardsByMatchday, snapshot, guests, locks } = context

  // Decision 3: the pool is ordered by the ranking — best N of M — and never by
  // a running total. The table you look at is the table that pairs you, and the
  // snapshot chain is built from this same ranking.
  const ranking = computeRanking(awardsByMatchday, seedOrder, config, snapshot)
  const points = new Map(ranking.map((row) => [row.entryId, row.points]))

  const { defenders, defendersAlreadyRepeated, previousPairs } = previousContext(
    await closedHistory(supabase, matchday.season_id, matchday.number - 1),
    await closedHistory(supabase, matchday.season_id, matchday.number - 2),
  )

  const present = [
    ...(await playingEntryIds(supabase, matchdayId)),
    ...guests.map((guest) => guest.entryId),
  ]
  assertMatchdaySize(present)
  assertPointsCoverMatchday(present, guests, locks, config)

  return {
    ...context,
    input: {
      present,
      points,
      snapshot,
      defenders,
      defendersAlreadyRepeated,
      previousPairs,
      guestIds: guests.map((guest) => guest.entryId),
      // Las parejas trabadas ya vienen con la forma de `Pair`: por eso
      // `pair_locks` es una tabla de dos columnas y no un agrupador. No hay
      // nada que convertir, y no hay una función de armado que se pueda
      // equivocar al hacerlo.
      fixedPairs: locks,
    },
  }
}
```

- [ ] **Step 3: Los lectores**

Funciones privadas de `db/matchday.ts` y `db/season.ts`. Contrato, no transcripción:

| Función | Devuelve | Cuidado |
|---|---|---|
| `requireMatchday(supabase, id)` | la fila, o `EdgeError` | |
| `seasonConfig(supabase, seasonId)` | `SeasonConfig` desde el `jsonb` | el `jsonb` no está tipado: el cast es un supuesto y `assertValidConfig` es lo que lo sostiene |
| `squadSeedOrder(supabase, seasonId)` | `EntryId[]` **ordenado por `seed_position`** | sin `order by` explícito, Postgres no promete nada |
| `awardsBefore(supabase, seasonId, number)` | `Map<number, Award[]>` de las fechas **cerradas** anteriores | la clave es el `number` de la fecha, no el `id` |
| `closedHistory(supabase, seasonId, number)` | `MatchdayHistory \| null` | `null` también si la fecha existe pero **no** está `CLOSED` |
| `guestsOf(supabase, matchdayId)` | `GuestSeat[]` **ordenado por `seed_position`** | ese orden es el que el admin arrastró |
| `locksOf(supabase, matchdayId)` | `PairLock[]` desde `pair_locks` | ordenado por `id` para que el armado sea reproducible |
| `playingEntryIds(supabase, matchdayId)` | `EntryId[]` con `status = 'PLAYING'`, **ordenado por `seed_position`** del entry | |
| `updateSeasonConfig(supabase, seasonId, config)` | nada | pasa por `assertValidConfig` **antes** de escribir. Es lo único de este plan que toca la config, y existe porque `assertPointsCoverMatchday` le dice al admin "agregá valores" y porque la Task 14 prueba que cambiarla no toca las fechas cerradas |

**Los tres `order by` no son cosmética.** `buildPairs` documenta que cuando dos presentes faltan del snapshot, su orden relativo cae al orden en que llegaron. Una lectura sin `order by` hace que la misma fecha se arme distinto entre dos llamadas, y eso rompe la promesa de determinismo de todo el proyecto.

- [ ] **Step 4: Verificar**

```bash
npm run db:reset && npm run test:db
```

**Expected: PASS — 12 tests.**

```bash
git add db/season.ts db/matchday.ts db/pairing-context.db.test.ts
git commit -m "feat: compose a matchday's pairing input out of core"
```

---

### Task 11: Armar la fecha y abrirla

**Files:**
- Create: `supabase/migrations/0005_matchday_moves.sql`
- Modify: `db/matchday.ts`
- Test: `db/generate.db.test.ts`

**Interfaces:**
- Consumes: `pairingContextFor`, `buildPairs`, `buildFixture`
- Produces: `createMatchday`, `setAttendance`, `addGuest`, `generatePairs`, `openMatchday`, y la función SQL `open_matchday(p_matchday)`

**Qué NO hace esta tarea:** no arma el Masters —esa jornada no tiene asistencias, así que `pairingContextFor` le daría un `present` vacío y `assertMatchdaySize` la rechazaría; el Plan 3 le pone su propia rama por `kind`—, no dibuja la pantalla de DRAFT (Plan 4), no **decide** el tamaño de la fecha —`db/` lee las asistencias y agrega los invitados que ya existen como filas; quien tilda "viene / no viene" y quien crea el asiento de invitado cuando el número da impar es la pantalla del Plan 4—, no carga resultados, no cierra nada.

- [ ] **Step 1: Escribir los tests que fallan**

Create `db/generate.db.test.ts`:

```typescript
describe('generatePairs', () => {
  it('guarda las parejas y el fixture completo', async () => {
    // 8 jugadores → 4 parejas, 6 partidos, 3 rondas
  })
  it('con 12 guarda 6 parejas y 15 partidos en 5 rondas', async () => {})
  it('regenerar reemplaza lo anterior, no lo duplica', async () => {})
  it('no genera sobre una fecha abierta', async () => {})
  it('respeta una pareja trabada de dos invitados', async () => {})
  it('respeta una pareja trabada de invitado con jugador del torneo', async () => {
    // Es la implementación del spec 2.6: así el admin "mueve" al invitado.
  })
})

describe('openMatchday', () => {
  it('pasa de DRAFT a OPEN', async () => {})
  it('no abre sin parejas generadas', async () => {})
  it('no abre con un invitado sin nombre', async () => {})
  it('no abre una fecha ya abierta', async () => {})
  it('no deja dos fechas abiertas en la misma temporada', async () => {})
  it('no abre si las parejas guardadas no son las de los presentes de ahora', async () => {
    // 8 presentes → generar parejas → marcar a dos más como PLAYING, que
    // sigue permitido porque la fecha está en DRAFT. Sin este control la
    // fecha abre con 10 asistentes y 4 parejas: dos personas no juegan y
    // nadie se entera hasta el club. Y si el plantel es de 8, la validación
    // de puntos recién tira AL CERRAR, con la fecha ya OPEN y los resultados
    // adentro — y de OPEN no se vuelve a DRAFT ni se regenera. Queda trabada.
  })
  it('un jugador no puede abrir la fecha', async () => {})
})
```

El de las dos fechas abiertas se apoya en el índice `matchdays_one_live`: el test tiene que ver el error, no un segundo `OPEN`.

**Expected: FAIL**

- [ ] **Step 2: `generatePairs`**

```typescript
/**
 * Draws the pairs and lays out the round robin. Re-runnable on purpose: the
 * DRAFT screen has a regenerate button, and the draw is deterministic, so the
 * same input gives the same pairs every time.
 */
export async function generatePairs(supabase: Client, matchdayId: string): Promise<void> {
  const matchday = await requireMatchday(supabase, matchdayId)
  if (matchday.status !== 'DRAFT') {
    throw new EdgeError('Las parejas sólo se arman con la fecha en armado.')
  }

  const { input } = await pairingContextFor(supabase, matchdayId)
  const pairs = buildPairs(input)
  const fixture = buildFixture(pairs.length)

  // Deleting the pairs cascades to matches and match_sets. In DRAFT there are
  // no results to lose; anywhere else this would be destructive, which is what
  // the status guard above is for.
  await deletePairs(supabase, matchdayId)

  const stored = await insertPairs(supabase, matchdayId, pairs)
  const matches = fixture.flatMap((round, index) =>
    round.map(([left, right]) => {
      const pairA = stored[left]
      const pairB = stored[right]
      if (pairA === undefined || pairB === undefined) {
        throw new Error(
          `El fixture nombró la pareja ${left} o ${right} y sólo hay ${stored.length}. Esto es un bug.`,
        )
      }
      return { matchday_id: matchdayId, round: index + 1, pair_a: pairA, pair_b: pairB }
    }),
  )
  await insertMatches(supabase, matches)
}
```

`insertPairs` devuelve los ids **en el mismo orden en que se le pasaron las parejas**, porque el fixture habla por índice. Un `insert ... select` que devuelva en otro orden arma un round robin donde cada pareja juega contra quien no debe, y la tabla resultante se ve perfectamente normal. Es el error más caro y más silencioso de esta tarea: el test de "el fixture completo" tiene que verificar que **cada pareja enfrenta a cada otra exactamente una vez**, no sólo que haya 6 filas.

- [ ] **Step 3: `supabase/migrations/0005_matchday_moves.sql` — abrir**

El estado de la fecha lo mueven las funciones y nadie más: la Task 6 revocó `update (status)` a `authenticated` justamente para que un `PATCH` no pueda saltear estos controles. Por eso `security definer`, y por eso arranca preguntando si quien llama es el admin.

```sql
create or replace function public.open_matchday(p_matchday uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid;
  v_status text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede abrir una fecha.';
  end if;

  select status into v_status from public.matchdays where id = p_matchday for update;
  if v_status <> 'DRAFT' then
    raise exception 'Esta fecha ya no está en armado.';
  end if;

  if not exists (select 1 from public.pairs where matchday_id = p_matchday) then
    raise exception 'Generá las parejas antes de abrir la fecha.';
  end if;

  update public.matchdays set status = 'OPEN' where id = p_matchday;

  -- La temporada arranca cuando se abre su primera fecha. Es el único lugar
  -- donde SETUP puede pasar a ACTIVE, así que la columna no queda muerta.
  update public.seasons set status = 'ACTIVE' where id = v_season and status = 'SETUP';
end;
$$;

revoke execute on function public.open_matchday(uuid) from public, anon;
grant  execute on function public.open_matchday(uuid) to authenticated;
```

**El chequeo de admin va ANTES del `select ... for update`, y no es orden caprichoso.** Bajo RLS, un `SELECT ... FOR UPDATE` aplica también la política de `UPDATE`, así que a un jugador común la fila se le filtra y `v_status` queda NULL: sin el chequeo previo, el mensaje sería "la fecha no existe" para alguien que la está mirando en pantalla.

- [ ] **Step 4: `openMatchday`**

```typescript
export async function openMatchday(supabase: Client, matchdayId: string): Promise<void> {
  const { input, guests } = await pairingContextFor(supabase, matchdayId)
  assertGuestsNamed(guests)

  // Las asistencias se pueden seguir tocando mientras la fecha está en DRAFT,
  // así que las parejas guardadas pueden haber quedado viejas. Éste es el
  // único momento en que la igualdad se puede exigir: una vez OPEN no se
  // regenera, y una fecha con más presentes que jugadores no tiene arreglo.
  const inPairs = new Set((await pairEntryIds(supabase, matchdayId)).flat())
  const present = new Set(input.present)
  const sameSet =
    inPairs.size === present.size && [...present].every((entryId) => inPairs.has(entryId))

  if (!sameSet) {
    throw new EdgeError('Cambió quién viene desde que armaste las parejas. Volvé a generarlas.')
  }

  const { error } = await supabase.rpc('open_matchday', { p_matchday: matchdayId })
  if (error !== null) throw new EdgeError(error.message)
}
```

- [ ] **Step 5: Las escrituras de armado**

| Función | Qué hace | Cuidado |
|---|---|---|
| `createMatchday(supabase, seasonId, playedOn)` | inserta la siguiente por número | el índice `matchdays_one_live` la rebota si hay otra sin cerrar; traducir ese error a castellano. **Escribe `played_on`**: la columna existe y es el dato que muestran todas las pantallas |
| `setAttendance(supabase, matchdayId, entryId, status)` | tilda viene / no viene | sólo con la fecha en `DRAFT` |
| `addGuest(supabase, matchdayId, { displayName })` | agrega un asiento `GUEST` | `seed_position` correlativo **entre los invitados de esa fecha**; `displayName` puede ir vacío |
| `lockPair(supabase, matchdayId, entryA, entryB)` | traba una pareja antes del sorteo | pasa por `assertLocksAndGuests` **antes** de escribir, o el error que ve el admin es una violación de unique |
| `unlockPair(supabase, lockId)` | la destraba | |
| `deletePairs(supabase, matchdayId)` | borra las parejas de la fecha | cascadea a `matches` y `match_sets`: sólo en `DRAFT` |
| `insertPairs(supabase, matchdayId, pairs)` | inserta y devuelve los ids | **en el mismo orden en que se le pasaron.** Un `insert ... returning` no promete orden: hay que insertar en lote y reordenar el resultado contra el input, o insertar de a uno |
| `insertMatches(supabase, rows)` | inserta el fixture | |
| `pairEntryIds(supabase, matchdayId)` | los dos `entry_id` de cada pareja | |

- [ ] **Step 6: Verificar**

```bash
npm run db:types
npm run db:reset && npm run test:db
```

**Expected: PASS — 13 tests.**

```bash
git add supabase/migrations/0005_matchday_moves.sql db/matchday.ts db/generate.db.test.ts db/database.types.ts
git commit -m "feat: draw the pairs, lay out the fixture and open the matchday"
```

---

### Task 12: Cargar resultados y cerrar la fecha

**Files:**
- Modify: `supabase/migrations/0005_matchday_moves.sql`
- Modify: `db/matchday.ts`
- Test: `db/close.db.test.ts`

**Interfaces:**
- Consumes: `matchdayContextFor`, `computeStandings`, `computeAwards`, `matchError`
- Produces: `saveResult`, `closeMatchday`, y la función SQL `close_matchday(p_matchday, p_awards)`

**Qué NO hace esta tarea:** no dibuja la pantalla de carga (Plan 4), no calcula el ranking de temporada —eso ya lo hace `computeRanking` y lo consume el Plan 3—, no manda avisos.

**Los resultados se guardan de a uno, no en batch al final.** Cada partido se carga donde se lee, y la tabla de la fecha se recalcula al leerla. Cerrar la fecha es entonces una sola cosa: **congelar los `awards` y cambiar el estado**, las dos juntas o ninguna.

Esto **contradice al spec 4.3**, que dice "la carga es en batch al final del día, una pantalla y un botón". Va registrado abajo, en Decisiones registradas: es la segunda contradicción entre el spec y `ui-screens.md`, y no se resuelve en silencio.

**Por qué una función SQL y no dos llamadas.** El cliente de Supabase no tiene transacciones: dos `insert` seguidos pueden dejar los awards escritos con la fecha todavía abierta si se corta el wifi en el club. Una función es una transacción implícita. Los puntos los sigue calculando `core/`; la función sólo los recibe y los escribe.

- [ ] **Step 1: Escribir los tests que fallan**

Create `db/close.db.test.ts`:

```typescript
describe('saveResult', () => {
  it('guarda el set de un partido', async () => {})
  it('rechaza un 5-2 en un set a 4, con el motivo', async () => {})
  it('rechaza un 4-4', async () => {})
  it('reemplaza el resultado anterior en vez de duplicarlo', async () => {})
  it('no se puede cargar en una fecha cerrada', async () => {})
})

describe('closeMatchday', () => {
  it('congela los awards y pasa a CLOSED', async () => {})
  it('los dos de la pareja cobran lo mismo', async () => {})
  it('el invitado no cobra y su compañero sí', async () => {})
  it('una pareja de invitados no ocupa puesto: el torneo cobra 1, 2, 3...', async () => {})
  it('no cierra con partidos sin cargar', async () => {})
  it('no cierra una fecha que no está en juego', async () => {})
  it('cerrar dos veces no duplica awards', async () => {})
  it('si el insert de awards falla, la fecha sigue OPEN', async () => {
    // Se fuerza pasando un award con points 0, que el check de la tabla
    // rechaza. Es la prueba de que la transacción existe.
  })
})
```

El último es el test de la atomicidad, y es el único que la prueba. Sin él, "es atómico" es una afirmación sobre un `begin` que nadie vio.

**Expected: FAIL**

- [ ] **Step 2: `supabase/migrations/0005_matchday_moves.sql` (primera mitad)**

```sql
-- Cerrar una fecha: los awards y el estado, o nada. Una función es una
-- transacción implícita, que es lo que el cliente de Supabase no tiene.
create or replace function public.close_matchday(p_matchday uuid, p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid;
  v_status text;
  v_kind   text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede cerrar una fecha.';
  end if;

  select status, kind into v_status, v_kind
    from public.matchdays where id = p_matchday for update;

  if v_status <> 'OPEN' then
    raise exception 'Sólo se cierra una fecha que está en juego.';
  end if;

  -- Sin esto, un `p_awards` en null cierra la fecha sin repartir un solo punto
  -- y sin decir nada: `jsonb_array_length(null)` da null, el `if` de abajo no
  -- dispara, y `jsonb_array_elements(null)` no devuelve filas. La función la
  -- puede llamar cualquier admin por RPC, así que el payload se valida.
  if p_awards is null or jsonb_typeof(p_awards) <> 'array' then
    raise exception 'La lista de puntos llegó mal formada.';
  end if;

  -- El Masters no paga puntos: define al campeón del año (spec 2.7). Se cierra
  -- con la lista vacía y el campeón se deriva de los partidos, como todo.
  if v_kind = 'MASTERS' and jsonb_array_length(p_awards) > 0 then
    raise exception 'El Masters no reparte puntos.';
  end if;

  if exists (
    select 1
      from public.matches m
     where m.matchday_id = p_matchday
       and not exists (select 1 from public.match_sets s where s.match_id = m.id)
  ) then
    raise exception 'Faltan resultados por cargar.';
  end if;

  insert into public.awards (matchday_id, entry_id, position, points)
  select p_matchday,
         (award ->> 'entryId')::uuid,
         (award ->> 'position')::int,
         (award ->> 'points')::int
    from jsonb_array_elements(p_awards) as award;

  update public.matchdays set status = 'CLOSED', closed_at = now() where id = p_matchday;

  -- El año se termina cuando se cierra el Masters, y en ningún otro momento.
  if v_kind = 'MASTERS' then
    update public.seasons set status = 'FINISHED' where id = v_season;
  end if;
end;
$$;

revoke execute on function public.close_matchday(uuid, jsonb) from public, anon;
grant  execute on function public.close_matchday(uuid, jsonb) to authenticated;
```

**`security definer` con chequeo explícito arriba, no `invoker`.** Un `definer` a ciegas sería un agujero que deja a cualquiera cerrar la fecha de cualquiera; con `is_season_admin` en la primera línea no lo es. Y hace falta: la Task 6 revocó `update (status)` a `authenticated`, así que un `invoker` ya no podría escribir el estado. De paso arregla el mensaje: bajo RLS, el `for update` de un `invoker` le filtra la fila a un jugador común y le diría "la fecha no existe" mirándola en pantalla.

- [ ] **Step 3: `db/matchday.ts` — cerrar**

```typescript
/**
 * Freezes the points and shuts the matchday. The table itself is never stored:
 * it is recomputed from match_sets every time, which is what lets an old
 * matchday be replayed and come out the same.
 */
export async function closeMatchday(supabase: Client, matchdayId: string): Promise<void> {
  // matchdayContextFor, NO pairingContextFor: cerrar no es sortear. Pasar por
  // el contexto del sorteo correría las validaciones de asistencia y de tamaño
  // sobre quién viene HOY en vez de sobre quiénes jugaron, y previousContext
  // podría tirar por un problema de la fecha anterior mientras cerrás ésta.
  const { config, guests, snapshot } = await matchdayContextFor(supabase, matchdayId)
  const { pairs, matches } = await resultsOf(supabase, matchdayId)

  for (const match of matches) {
    const problem = matchError(match.sets, config.matchFormat)
    if (problem !== null) throw new EdgeError(problem)
  }

  const standings = computeStandings(pairs, matches, config, snapshot)
  const awards = computeAwards(standings, config, guests.map((guest) => guest.entryId))

  const { error } = await supabase.rpc('close_matchday', {
    p_matchday: matchdayId,
    p_awards: awards,
  })
  if (error !== null) throw new EdgeError(error.message)
}
```

**El `snapshot` sale de `matchdayContextFor` y de ningún otro lado.** Es el cuarto criterio de desempate de la tabla (spec 2.3) y a la vez el del sorteo, y tiene que ser exactamente el mismo objeto en los dos usos: el vigente esa noche, calculado sobre las fechas cerradas **anteriores**, sin incluir la que se está cerrando —incluirla sería circular, porque el snapshot es lo que desempata esa misma tabla—.

**Y es el único error de este archivo que ningún test puede atrapar.** El test "reabrir y volver a cerrar da lo mismo" no sirve: al reabrir se borran los awards de la fecha, así que los dos cierres ven el mismo input y coinciden **aunque el snapshot esté mal**. Un segundo camino que calcule "el snapshot" por su cuenta —por ejemplo `snapshotForMatchday(number + 1, ...)`, que suena razonable— daría otra tabla con la suite entera en verde. Por eso hay una sola función y este párrafo.

| Función | Devuelve | Cuidado |
|---|---|---|
| `resultsOf(supabase, matchdayId)` | `{ pairs: Pair[]; matches: MatchResult[] }` | los `matches` con sus `sets` ordenados por `set_number` |
| `matchFormatOf(supabase, matchId)` | el `matchFormat` de la config de esa temporada | |

- [ ] **Step 4: `saveResult`**

```typescript
export async function saveResult(
  supabase: Client,
  matchId: string,
  sets: SetScore[],
): Promise<void> {
  const format = await matchFormatOf(supabase, matchId)
  const problem = matchError(sets, format)
  if (problem !== null) throw new EdgeError(problem)

  // La política match_sets_write ya exige que la fecha esté OPEN: acá alcanza
  // con traducir el error de RLS a un mensaje que se pueda leer.
  ...
}
```

- [ ] **Step 5: Verificar**

```bash
npm run db:types
npm run db:reset && npm run test:db
```

**Expected: PASS — 13 tests.**

```bash
git add supabase/migrations/0005_matchday_moves.sql db/matchday.ts db/close.db.test.ts db/database.types.ts
git commit -m "feat: load results and close a matchday in one transaction"
```

---

### Task 13: Reabrir una fecha

**Files:**
- Modify: `supabase/migrations/0005_matchday_moves.sql`
- Modify: `db/matchday.ts`
- Test: `db/reopen.db.test.ts`

**Interfaces:**
- Produces: `reopen_matchday(p_matchday)` y `reopenMatchday(supabase, matchdayId)`

**Qué NO hace esta tarea:** no rearma las parejas —al reabrir, las parejas de esa fecha quedan como estaban—, no toca las fechas posteriores, no pide confirmación (eso es la pantalla, Plan 4).

**Sólo la última fecha cerrada.** Las parejas de la fecha siguiente salieron de la tabla de esta; reabrir una del medio invalidaría todos los armados posteriores. El spec (4.3) ya lo decía y acá se hace cumplir en la base, que es donde nadie lo puede saltear.

- [ ] **Step 1: Escribir los tests que fallan**

Create `db/reopen.db.test.ts`:

```typescript
describe('reopenMatchday', () => {
  it('borra los awards y vuelve a OPEN', async () => {})
  it('el ranking vuelve a lo que era antes de esa fecha', async () => {})
  it('rechaza reabrir una fecha del medio', async () => {})
  it('rechaza reabrir si hay otra fecha sin cerrar', async () => {})
  it('rechaza reabrir una fecha que no está cerrada', async () => {})
  it('reabrir y volver a cerrar da exactamente los mismos awards', async () => {})
  it('borra la fecha siguiente si está vacía y reabre', async () => {})
  it('no borra la fecha siguiente si ya tiene asistencias', async () => {})
  it('no borra la fecha siguiente si ya tiene un invitado cargado', async () => {})
  it('un jugador recibe "sólo quien organiza", no "la fecha no existe"', async () => {})
})
```

El de "reabrir y volver a cerrar da lo mismo" prueba que el diseño de derivar-en-vez-de-guardar funciona: si algo quedó guardado que debería derivarse, lo encuentra. **Lo que NO prueba es que el snapshot sea el correcto** —los dos cierres ven el mismo input— y por eso el snapshot tiene una sola fuente en vez de un test.

**Expected: FAIL**

- [ ] **Step 2: La función**

```sql
create or replace function public.reopen_matchday(p_matchday uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid;
  v_number int;
  v_status text;
  v_kind   text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede reabrir una fecha.';
  end if;

  select number, status, kind into v_number, v_status, v_kind
    from public.matchdays where id = p_matchday for update;

  if v_status <> 'CLOSED' then
    raise exception 'Esta fecha no está cerrada.';
  end if;

  -- El error de carga se descubre justo cuando arrancás la fecha siguiente, y
  -- para entonces esa fecha suele ser una fila con un número y nada más. Si
  -- está vacía se borra sola: no hay nada que perder. Si ya tiene asistencias,
  -- invitados o parejas, no se toca y el exists de abajo frena la reapertura.
  delete from public.matchdays m
   where m.season_id = v_season
     and m.id <> p_matchday
     and m.status = 'DRAFT'
     and not exists (select 1 from public.pairs       x where x.matchday_id = m.id)
     and not exists (select 1 from public.attendances x where x.matchday_id = m.id)
     and not exists (select 1 from public.pair_locks  x where x.matchday_id = m.id)
     and not exists (select 1 from public.entries     x where x.matchday_id = m.id);

  if exists (
    select 1 from public.matchdays
     where season_id = v_season and status <> 'CLOSED' and id <> p_matchday
  ) then
    raise exception 'La fecha siguiente ya tiene datos cargados. Borrala vos antes de reabrir ésta.';
  end if;
  if exists (
    select 1 from public.matchdays
     where season_id = v_season and number > v_number and status = 'CLOSED'
  ) then
    raise exception 'Sólo se reabre la última fecha cerrada: las parejas de las que siguen salieron de esta tabla.';
  end if;

  delete from public.awards where matchday_id = p_matchday;
  update public.matchdays set status = 'OPEN', closed_at = null where id = p_matchday;

  -- Reabrir el Masters devuelve la temporada a en curso. Sin esto, el año
  -- quedaría FINISHED con su última jornada abierta.
  if v_kind = 'MASTERS' then
    update public.seasons set status = 'ACTIVE' where id = v_season;
  end if;
end;
$$;

revoke execute on function public.reopen_matchday(uuid) from public, anon;
grant  execute on function public.reopen_matchday(uuid) to authenticated;
```

Los dos `exists` parecen el mismo control y no lo son: el primero atrapa una fecha posterior en `DRAFT` o `OPEN`, el segundo una posterior ya `CLOSED`. Sin el segundo se podría reabrir la fecha 3 de una temporada que va por la 7.

**El `delete` es la única cosa de todo el plan que borra datos sin que nadie lo pida**, así que está acotado a la fila que no tiene nada adentro: `DRAFT`, sin parejas, sin asistencias, sin parejas trabadas y sin invitados. Si le falta cualquiera de esas condiciones no borra nada y la reapertura se frena con un mensaje que le pide al admin que la borre él.

**Los cuatro `not exists` son el contrato: si mañana aparece otra tabla colgada de `matchdays`, hay que sumarla acá.** Faltan a propósito `matches` y `awards`: los partidos no pueden existir sin parejas —se crean juntos y cascadean juntos— y los awards sólo existen en una fecha `CLOSED`, que este `delete` ya excluye. Cualquier tabla nueva no tiene esa suerte.

**Aun así la reapertura es un poco más estricta que el spec 4.3**, que sólo pide que sea la última cerrada: si la fecha siguiente ya tiene asistencias marcadas, hay que borrarla a mano. Es una consecuencia de `matchdays_one_live`, no una decisión aparte, y está declarada en "Qué queda afuera" para que la pantalla del Plan 4 no ofrezca un botón que va a fallar.

- [ ] **Step 3: Verificar**

```bash
npm run db:types
npm run db:reset && npm run test:db
```

**Expected: PASS — 10 tests.**

```bash
git add supabase/migrations/0005_matchday_moves.sql db/matchday.ts db/reopen.db.test.ts db/database.types.ts
git commit -m "feat: reopen the last closed matchday and recompute from scratch"
```

---

### Task 14: Una temporada entera contra la base

**Files:**
- Test: `db/season.db.test.ts`

**Interfaces:**
- Consumes: todo lo anterior
- Produces: nada. Es el test que dice si el plan funcionó

**Qué NO hace esta tarea:** no agrega código de producción. Si para que pase hace falta escribir producción, es que una tarea anterior quedó incompleta: anotalo y arreglá **esa** tarea, no ésta.

**El harness simula resultados con una regla determinista que hace mover la tabla.** El de `core/matchday.test.ts` deja ganar siempre a la pareja 0 y por eso ninguna prueba de temporada ejercita una tabla que se mueve ni un campeón que rota. Acá la regla es otra: **en las rondas impares gana la pareja peor rankeada, en las pares la mejor.** Sigue siendo determinista —una temporada se puede repetir y comparar— pero el campeón cambia de fecha en fecha, la cadena de snapshots se refresca sobre datos que se mueven y los defensores rotan de verdad.

- [ ] **Step 1: El recorrido completo**

```typescript
describe('una temporada de punta a punta', () => {
  it('juega 10 fechas y arma un ranking que cierra', async () => {})
  it('nunca repite una pareja de la fecha inmediatamente anterior', async () => {})
  it('una pareja campeona que asiste completa juega exactamente 2 fechas junta', async () => {
    // El "completa" no sobra. La misma lista pide una fecha con un invitado
    // suelto, o sea con alguien del plantel ausente; si el ausente es uno de
    // los dos defensores, resolveDefenders los disuelve (spec 2.6) y la
    // pareja jugó UNA fecha junta. El harness tiene que fijar quién falta y
    // que nunca sea un defensor.
  })
  it('la tabla descarta los peores resultados desde el cierre de la fecha 9', async () => {
    // computeRanking descarta cuando hay MÁS de countBestOf resultados, o sea
    // con 9. Y el sorteo se ordena con los awards de 1..n-1, así que el único
    // sorteo de la temporada que cambia es el de la fecha 10.
  })
  it('cambiar los puntos en la fecha 5 no toca los awards de las 4 anteriores', async () => {})
  it('reabrir la última y volver a cerrarla deja todo igual', async () => {})
  it('reclamar un perfil no altera ningún resultado histórico', async () => {})
  it('una fecha con un invitado suelto y otra con equipo invitado', async () => {})
  it('la misma temporada, jugada dos veces, da los mismos awards', async () => {})
})
```

- [ ] **Step 2: Verificar todo**

```bash
npm test
npm run test:db
npm run typecheck
npm run build
```

**Expected: PASS — 9 tests, y las dos suites enteras verdes.**

```bash
git add db/season.db.test.ts
git commit -m "test: play a full season against the database"
```

---

## Aparecidos

Cosas que salieron durante la implementación y **no** se hicieron, para no ensanchar las tareas. Anotalas acá con una línea y seguí.

- **Task 1, el encabezado se contradice con el Step 7.** *Files* dice `Create: db/client.ts`, pero el Step 7 prohíbe crearlo hasta la Task 5 (necesita `database.types`, que nace con las tablas). El implementador siguió el step, que es lo correcto. Falta sacarlo de la lista de *Files* para que nadie lo lea al revés.
- **Tasks 1 y 5, los dos bloques de `@supabase/ssr` no compilaban.** `createServerClient` tiene dos overloads (`get/set/remove` y `getAll/setAll`) y TypeScript no puede tipar el callback `setAll` a través de firmas que no coinciden: `toSet` sale `any` implícito y `tsc --noEmit` corta. La Task 1 ya lo había arreglado en `middleware.ts` sin que el plan se enterara; la Task 5 chocó con lo mismo al copiar `db/client.ts` "tal cual". Los dos bloques del plan quedaron anotados. **No hace falta subir la dependencia.**
- **Task 4, `previousPairs` arrastra ids de invitado muertos.** Las parejas de la fecha anterior pueden contener ids de entrada de invitados, que nunca van a volver a aparecer en `present`. Son entradas inertes en el filtro de no-repetición. Inofensivo; merece un comentario, no código.
- **Task 4, el mensaje del "ganador que no está en ninguna pareja" es terso.** Con `awards: [{p9, 1}]` y `pairs: [A]` tira "0 parejas en la posición 1", que es cierto pero no dice la causa real: `p9` cobró y no está en ninguna pareja. A diferencia de `9394843`, acá el mensaje no miente, sólo es escueto — por eso no se tocó.
- **Task 4, el helper `history()` de los tests no modela awards reales.** Reparte `index + 2` a los no campeones, así que `history([A,B,C], B)` produce posiciones 2, 1, 4 y la 3 no existe nunca. `computeAwards` siempre emite `1..n` contiguo. Inofensivo, porque sólo se lee la posición 1.
- **Task 4, los tests del bloque venían en español.** El repo se estandarizó en nombres de test en inglés — `fcad18d` es un commit dedicado a eso. Se tradujeron sólo los nombres; aserciones, fixtures y mensajes de error quedaron idénticos al bloque, y los mensajes siguen en español. Los bloques de tests de las tareas 5 a 14 arrastran el mismo problema.

---

## Decisiones registradas

Tres decisiones de este plan se tomaron con una objeción sobre la mesa. Quedan anotadas para saber de dónde viene el síntoma si aparece.

### 1. Leer un torneo exige participar de él

**Decisión:** las políticas de lectura preguntan `is_participant(season_id)`, con dos funciones `security definer` y un `exists` por fila.

**Objeción planteada:** para un grupo de amigos alcanzaba con "cualquiera logueado lee todo", que es una política de una línea y cero funciones.

**Por qué se descartó:** con PostgREST, "lee todo" significa que cualquier usuario puede pedir la tabla `seasons` entera y llevarse **todos los `invite_token`**, que son la llave para meterse en el torneo de cualquiera.

**Síntoma a vigilar:** si con la temporada avanzada las pantallas empiezan lentas, el origen es este. La solución no es aflojar la política: es un índice sobre `entries (player_id)` y `players (user_id)`.

### 2. La pareja invitada puede ganar la fecha pero no el campeonato

**Decisión:** una pareja hecha sólo de invitados aparece en la tabla de la fecha con su récord real, pero no consume puesto al repartir puntos, y no es la pareja defensora.

**Objeción planteada:** la tabla de la fecha y la lista de puntos van a mostrar dos órdenes distintos, y hay que explicarlo en pantalla.

**Mitigación:** la pantalla de la Fecha ya marca al invitado como tal (Plan 3). Alcanza con una línea al pie de la tabla.

**Alternativa disponible:** que la pareja invitada sí ocupe puesto. Es más simple de contar y más difícil de defender la noche que unos visitantes se lleven los 10 puntos.

### 3. Nadie crea su propio asiento desde el link

**Decisión:** la pantalla de Unirse sólo deja elegir de la lista. El "No estoy en la lista" de `ui-screens.md` no se implementa.

**Objeción planteada:** el que falta queda trabado hasta que el admin lo agregue.

**Por qué igual:** crear un asiento cambia `squadSize`, y `points` tiene que tener exactamente `squadSize / 2` valores. Un jugador entrando por WhatsApp dejaría la config inválida sin enterarse. Agregar gente es del admin, desde Ajustes, donde la app puede avisar qué hay que revisar.

**Alcance de la decisión:** la Task 8 corrige `docs/ui-screens.md`, que es fuente de verdad de la app. No alcanza con anotarlo acá: el Plan 3 va a dibujar esa pantalla leyendo aquel documento.

### 4. Los resultados se cargan de a uno, no en batch

**Decisión:** cada partido se guarda cuando se juega. Cerrar la fecha sólo congela los puntos.

**Objeción planteada:** el spec 4.3 dice explícitamente *"la carga es en batch al final del día: una pantalla, entre 6 y 15 resultados, un botón"*, y lista *"scoring en vivo"* como fuera de alcance a propósito. `ui-screens.md` dice lo contrario (*"cada partido es cargable en el mismo lugar donde se lee"*), y `estado.md` dice que ante cualquier duda de comportamiento manda el spec.

**Por qué igual:** con set a 4 games hay cuatro resultados posibles, así que cargar un partido son dos taps sin teclado, parado en la cancha. Y guardar de a uno significa que un wifi que se corta cuesta un resultado y no quince. Esto no es scoring en vivo: nadie mira el partido desde el teléfono, se anota cuando terminó.

**Qué hay que hacer con eso:** corregir el spec 4.3. Una contradicción entre los dos documentos es peor que cualquiera de las dos versiones.

### 5. Sólo se puede fijar una pareja que incluya a un invitado

**Decisión:** `pair_locks` acepta cualquier par de asientos, pero el borde rechaza los que no tengan ningún invitado adentro.

**Objeción planteada:** el admin es de confianza, y a veces dos del grupo quieren jugar juntos por algo puntual.

**Por qué igual:** una pareja fijada saltea el filtro de no repetir. Dos del plantel fijados a mano una fecha tras otra vacían de sentido a todo el algoritmo de armado, que existe exactamente para eso. El invitado es la excepción legítima porque no está en el campeonato: fijarlo no altera la rotación de nadie.

**Dónde está:** en `assertLocksAndGuests`, no en un check de la base — `kind` vive en `entries` y un check no puede mirar otra tabla.

### 6. Tres funciones `security definer` mueven el estado de la fecha

**Decisión:** `open_matchday`, `close_matchday` y `reopen_matchday` son `security definer` y empiezan chequeando `is_season_admin`. A `authenticated` se le revoca `update (status)` sobre `matchdays`.

**Objeción planteada:** `security definer` saltea RLS, que es exactamente lo que no queremos.

**Por qué igual:** con `security invoker`, un `PATCH /matchdays {"status":"OPEN"}` reabre cualquier fecha salteando los tres controles de `reopen_matchday` y dejando los `awards` colgados — PostgREST no distingue qué columna se actualizó, que es el mismo motivo por el que el reclamo de asiento va por función. El chequeo explícito en la primera línea deja el `definer` más restrictivo que el `invoker`, no menos.

---

## Qué queda afuera de este plan, a propósito

| Fuera de alcance | Dónde va |
|---|---|
| Las 13 pantallas del torneo. Este plan escribe **cuatro**: landing, registro, login y unirse | Planes 3 y 4 |
| Crear torneo (el wizard de 5 pasos). Hasta el Plan 4, una temporada se crea por `seed.sql` o por test | Plan 4 |
| Mis torneos | Plan 3 |
| Página pública de reglas, y la función `security definer` que la deja leer sin cuenta. **Este plan no le da a `anon` una sola fila** | Plan 3 |
| Sanitizar el markdown del admin | Plan 3 |
| Racha de defensas como estadística (spec 2.4) | Plan 3 |
| **El flujo del Masters** (spec 2.7): clasificar a los 4, generar los 3 partidos con `mastersFixture` y mostrar al campeón con `mastersChampion`. **El modelo de datos ya está**: `matchdays.kind = 'MASTERS'`, reusa `pairs` y `matches`, no escribe `awards`, `close_matchday` rechaza que traiga puntos, y al cerrarlo la temporada pasa a `FINISHED` (y vuelve a `ACTIVE` si se reabre). **Ojo con lo que falta, que no es sólo pantalla:** el Masters no tiene `attendances` —los 4 salen del ranking—, así que `pairingContextFor` le arma un `present` vacío y `assertMatchdaySize` lo rechaza. `generateMastersPairs` y `openMatchday` necesitan una rama por `kind` que NO pase por el camino del sorteo. Cerrarlo, en cambio, ya funciona tal cual: `matchdayContextFor` no valida tamaño | Plan 3, sin migración de por medio |
| Tildar "viene / no viene" y crear el asiento de invitado cuando el número da impar. **`db/` sí lee las asistencias** y arma `present` con ellas; lo que falta es la pantalla que las escribe | Plan 4 |
| La pantalla para trabar y destrabar parejas. **El modelo y las funciones ya están** (`pair_locks`, `lockPair`, `unlockPair`): con eso el admin arma el equipo invitado y también mueve al invitado poniéndolo con quien quiera, que es el spec 2.6. Falta el control en pantalla | Plan 4 |
| Reordenar el plantel o los invitados. Los índices únicos parciales no son diferibles, así que un swap directo falla: hay que correr el bloque fuera de rango y después escribir, en una transacción | Plan 4 |
| Desvincular un reclamo de asiento, editar nombres, agregar y sacar gente del plantel. **Y con eso, el "No estoy en la lista" que `ui-screens.md` ofrecía en la pantalla de Unirse**, que la Task 8 saca de ese documento | Plan 4 (Ajustes) |
| La pantalla de Ajustes que edita la config. La **función** `updateSeasonConfig` sí está en este plan (Task 10): sin ella, `assertPointsCoverMatchday` manda al admin a una pantalla que no existe y la Task 14 no podría probar que cambiar los puntos no toca las fechas cerradas | Plan 4 |
| Recuperar la contraseña. El link existe y va a una pantalla que lo dice | Plan 3 |
| Editarse el nombre propio. Por eso `players` no tiene política de `update`: una política sin pantalla es superficie de ataque gratis | Plan 3 |
| Vencimiento del link de invitación | No existe: el torneo dura un año y el link circula en el grupo |
| **Reabrir cuando la fecha siguiente ya tiene datos.** Si está vacía, `reopen_matchday` la borra sola. Si ya tiene asistencias, invitados o parejas, no la toca y hay que borrarla a mano — así que el Plan 4 necesita una acción "borrar fecha", y la pantalla `CLOSED` no puede ofrecer reabrir sólo por ser la última cerrada | Plan 4 |
| Los dos layouts que cambiaron y nadie miró (wizard paso 4, fecha en juego) | Mirarlos **antes** de que el Plan 3 los implemente |
| **Deuda de `core/`:** el test de `standings.test.ts` que no protege lo que dice; `samePair` viviendo en `pairing.ts`; `buildFixture` y `mastersFixture` compartiendo el nombre "fixture"; `standings.ts` descartando en silencio un partido con parejas desconocidas; `pairing.ts` acotando el pool en vez de los presentes; los dos fixtures que faltan | Sigue en `docs/estado.md`. Este plan **no** la toca: lo único que arregla de `core/` es lo que sus propias decisiones rompen |

---

## Criterio de terminado

- [ ] `npm test` en verde, sin tests saltados
- [ ] `npm run test:db` en verde contra Supabase local, sin tests saltados
- [ ] `npm run typecheck` sin errores
- [ ] `npm run build` sin errores
- [ ] Ningún archivo de `core/` importa nada fuera de `core/` — `rg '^import' core/ | rg -v "from '\./"`
- [ ] Ningún archivo de `core/` usa `Date`, `Math.random`, `fetch` ni `process` — `rg 'Date|Math\.random|fetch|process' core/`
- [ ] Ningún cálculo del campeonato quedó en `db/` ni en SQL. Los invariantes que **sí** están duplicados en SQL son exactamente cuatro y están listados en Global Constraints: una fecha viva, un set sin empate, sólo la última cerrada se reabre, no se cierra con partidos sin cargar. Cualquier quinto es un hallazgo
- [ ] Las diez tablas tienen RLS prendida y al menos una política — una query a `pg_policies` y `pg_class.relrowsecurity` que devuelva las diez
- [ ] Ningún archivo bajo `app/` lee `SUPABASE_SERVICE_ROLE_KEY` — `rg SERVICE_ROLE app/` sin resultados. (En `.env.example` sí aparece, a propósito)
- [ ] A mano: registrarse, salir, entrar, entrar con Google, reclamar un asiento por el link
- [ ] La sección "Aparecidos" está revisada y lo que valga la pena quedó como tarea de otro plan
