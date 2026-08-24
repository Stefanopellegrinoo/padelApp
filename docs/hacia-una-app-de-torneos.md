# Hacia una app de torneos, no sólo de pádel

> ## ⚠️ ESTO YA SE CONSTRUYÓ — leelo como historia, no como plan
>
> `torneo-multi-disciplina` (terminada el 24/08, **sin publicar**) abrió **los
> cuatro ejes** que este documento medía como cerrados:
>
> | eje | cómo se abrió |
> |---|---|
> | 1 · el equipo son exactamente dos | `Side` es una unión discriminada sobre `size`, y `pair_size in (1,2)` en la base |
> | 2 · el fixture es siempre round robin | se agregó `GROUPS_KNOCKOUT`: grupos + llave, con su fase y su tercer puesto |
> | 3 · el formato está hardcodeado | `matchFormat` configurable por disciplina, con `openScore` (goles) y `allows_draw` (empates) |
> | 4 · un torneo es de un solo deporte | varias disciplinas por torneo, cada una con su tabla, su plantel y su Masters |
>
> **Con dos salvedades que importan y que este documento anticipó:**
>
> El eje 1 se abrió **exactamente como acá se advertía que NO se hiciera**: no
> es "equipo de N", es una unión de `1 | 2`. La advertencia sigue en pie — el
> día que alguien pida 3 o 4, hay que volver a abrir el modelo.
>
> Y **la lista de juegos sigue cerrada**: `kind` es un CHECK de dos valores
> (`PADEL`, `FIFA`). Agregar un tercero pide migración.
>
> El estado real está en [`estado.md`](estado.md).

---

**Qué es esto:** una foto medida del 12 de agosto de 2026, no un plan y no una
promesa. La idea a futuro es que esto sirva para armar **cualquier torneo, de
cualquier juego, con cualquier cantidad de gente y de fechas**. Este documento
existe para que el día que se arranque no haya que volver a medir nada.

Todos los números de acá salieron de contar sobre el código, no de recordarlo.

---

## Lo que ya es agnóstico al deporte

El motor de campeonato **no sabe qué deporte es**. Estos cinco módulos no tienen
una sola mención de pareja, set ni game:

| Módulo | Líneas | Qué hace |
|---|---|---|
| `core/awards.ts` | 50 | posición del día → puntos |
| `core/ranking.ts` | 48 | suma, mejores N, descartes |
| `core/snapshots.ts` | 34 | refresco del orden de desempate |
| `core/movement.ts` | 56 | quién sube y quién baja |
| `core/order.ts` | 30 | |

Eso —presentes → equipos → juegan → tabla del día → puntos → tabla del año con
descartes— **es el campeonato**, y sirve igual para ping pong, FIFA o truco. Es
la parte que costó escribir y la que NO habría que tocar.

## Lo que ya está y no se ve: la tabla global

`awards` cuelga de `entries`, y **`entries.player_id` apunta a `players`, que es
global**. Sumar los puntos de una persona a través de varias temporadas ya es
una consulta, no una arquitectura.

El modelo ya cruza torneos. Falta sólo la entidad que los agrupe.

---

## Los cuatro ejes cerrados, y qué cuesta abrir cada uno

### 1. El equipo son exactamente dos

`pairs.entry_a` y `pairs.entry_b` son ambos `not null`. Eso **no es un flag de
config, es el modelo**.

```
core        237 menciones de entry_a / entry_b / Pair
db          109
sql          20
pantallas   118
            ───
            484
```

Consecuencias en cadena: `squadSize` tiene que ser par, y
`points.length === squadSize / 2`.

**Cómo se abre:** "equipo de N", con N en la config. NO hacer un caso especial
para 1v1 — los tamaños reales que pidió el grupo son variables **dentro de cada
deporte**, así que un caso especial no alcanzaría igual:

| Juego | Tamaños |
|---|---|
| FIFA | 1v1 o 2v2 |
| Ping pong | 1v1 o 2v2 |
| Truco | 2v2 o 3v3 |
| Pádel | 2v2 |

La generalización es limpia: `squadSize % N === 0` y
`points.length === squadSize / N`.

### 2. El fixture es siempre un round robin completo

`core/fixture.ts` arma todos contra todos por el método del círculo:
`n(n-1)/2` partidos. **Acá está la sorpresa: el problema de 1v1 no es el
schema, es que hace explotar la fecha.**

Con los mismos 12 del grupo:

| Formato | Equipos | Partidos | Rondas |
|---|---|---|---|
| 3v3 (truco) | 4 | **6** | 3 |
| 2v2 (pádel, ping pong, FIFA) | 6 | **15** | 5 |
| 1v1 (ping pong, FIFA) | 12 | **66** | 11 |

Nadie juega 66 partidos un jueves. **Los deportes 1v1 no necesitan otro modelo
de datos, necesitan otro formato de fecha** — zona, llave, o "jugás contra tres
sorteados". Eso es una decisión de producto y es más difícil que la
refactorización.

Nota al pie que ya está resuelta: con 1v1 y 12 jugadores la lista de puntos
necesita **12 valores descendentes**. Se puede escribir sólo porque el 0 pasó a
poder repetirse al final (`9feda76`): `10·8·6·5·4·3·2·1·0·0·0·0`. Sin eso te
quedabas sin números.

Y algo contraintuitivo que conviene recordar: **truco 3v3 y FIFA 2v2 son más
fáciles que el pádel**, no más difíciles. Menos equipos, fecha más corta. Son
por donde empezar.

### 3. El formato está hardcodeado — y ya hay dos

La app **ya tiene dos formatos**, y los dos están escritos a mano:

- `core/fixture.ts` → round robin de la fecha regular
- `core/masters.ts` → el Masters: cuatro jugadores fijos, tres partidos con
  compañero rotativo, pairings literales en el código

O sea: **"formato" no es un concepto del modelo**. Agregar un tercero hoy es
agregar un tercer hardcode.

**El bloqueo estructural para grupos y llaves está acá:**

```sql
create table public.matches (
  pair_a uuid not null,
  pair_b uuid not null,
  foreign key (pair_a, matchday_id) references public.pairs (id, matchday_id)
);
```

Cada partido **conoce a sus dos equipos en el momento en que se genera la
fecha**. Una semifinal no tiene equipos hasta que terminan los cuartos, así que
una llave no se puede expresar: haría falta que `pair_a`/`pair_b` sean nulos y
que exista una forma de decir *"el ganador del partido X"*.

**Lo que ya sirve de base, y es más de lo que parece:**

- `buildFixture` **ya es una zona**: un grupo es un round robin entre k equipos.
  Falta partir el plantel en varias zonas, no inventar el algoritmo.
- `computeStandings` **ya es la tabla de la zona**: ordena equipos dentro de una
  fecha con sus desempates.

Lo genuinamente nuevo es sólo la llave: partidos con participantes diferidos.
Y de ahí sale casi gratis lo de "configurar cuántos quedan afuera" —
octavos/cuartos/semis es cuántas rondas de llave tiene el torneo y cuántos
clasifican de cada zona.

### 4. El torneo es una temporada de un solo deporte

`seasons` **es** el torneo y lleva **una** config. Multideporte necesita un
nivel arriba: una *liga* que agrupe N temporadas, una por deporte.

La tabla por deporte no hay que construirla — **ya existe, es una temporada**.

---

## Por dónde empezar

En este orden, y el orden importa:

1. **Liga + tabla global.** Lo que más valor da por lo menos que rompe, y **no
   obliga a tocar el modelo de parejas**: al principio todos los deportes pueden
   ser de a dos. Una tabla nueva arriba de `seasons`, un FK, y las pantallas.
2. **Equipo de N.** Es la cirugía: 484 lugares. Mecánica pero grande.
3. **Formato como entidad**, con zonas y llaves. Necesita partidos con
   participantes diferidos.
4. **Puntaje intercambiable.** Sacar `setsToWin`/`gamesPerSet` y los desempates
   de `standings.ts` a una estrategia por deporte.

El almacenamiento del resultado **ya es más general de lo que parece**:
`match_sets(set_number, games_a, games_b)` en realidad es *"N rondas, dos
números por lado"*. Le entra ping pong (sets a 11), FIFA (un set, goles) y truco
(un set, a 30). Lo específico de pádel no es cómo se guarda: es la **validación**
(`setsToWin`, `gamesPerSet`) y los **desempates** (`setsDiff`, `gamesDiff`).

## Lo que NO hay que hacer

- **No empezar por 1v1.** Es el más caro y el que además obliga a resolver el
  formato de la fecha.
- **No parchar de a poco.** Esto es la capa del medio, no una feature al costado.
  Se hace con un plan escrito o no se hace.
- **No tocarlo mientras el grupo está usando la app.** Hoy funciona. Cambiarle
  el modelo de equipos es cambiarle el motor a un auto que anda.
- **No renombrar todavía.** El repo, el proyecto de Supabase y el dominio dicen
  "padel". Es cosmético y se arregla el día que de verdad haya un segundo
  deporte, no antes.
