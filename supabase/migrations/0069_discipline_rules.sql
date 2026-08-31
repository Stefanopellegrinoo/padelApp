-- Reglas por disciplina (docs/tipos-de-torneo.md §2.2 + §2.3), slice 1 de 4 —
-- SQL + capa de lectura, CERO cambio de comportamiento. Nada escribe todavía
-- `disciplines.rules_text`: nace inerte, y por eso esta es la rebanada con el
-- revert más barato de las cuatro (`git revert` sin ventana de datos).
--
-- ── 1. LA COLUMNA ────────────────────────────────────────────────────────────
-- Mismo tipo/default/nullability que `seasons.rules_text` (0001_schema.sql:17),
-- así el backfill de abajo es una copia directa y no hay que inventar ningún
-- valor para las filas que ya existen.
alter table public.disciplines
  add column rules_text text not null default '';

-- ── 2. EL BACKFILL: SÓLO la disciplina POR DEFECTO ──────────────────────────
-- `seasons.rules_text` es prosa que un admin escribió cuando la temporada
-- tenía una sola disciplina (el reglamento de n-1000, hoy en producción).
-- Repartirla en TODAS las disciplinas de una temporada mixta haría que un
-- bloque de FIFA afirme reglas de pádel — fabricando exactamente la clase de
-- mentira que este cambio entero viene a borrar, y peor que prosa generada,
-- que al menos se nota que lo es. Texto vacío no renderiza ningún bloque
-- (`rules-body.tsx`), que es lo honesto.
--
-- "Por defecto" es el mismo criterio de siempre en esta cadena —
-- `order by position, created_at limit 1`, igual que `defaultDisciplineId`
-- (db/season.ts), `create_masters` (0021) y `season_public_rules` (0022:41-42)
-- — así que la fila que este backfill llena es LA MISMA que `season_public_
-- rules` ya le sirve ese texto a un extraño hoy. Nada se pierde:
-- `seasons.rules_text` NO se borra en esta migración (dual-write hasta el
-- contract, misma postura que `seasons.config`), así que para toda temporada
-- de una sola disciplina (el 100% de lo que hay hoy) esto es una operación
-- sin pérdida y reversible sin tocar datos.
update public.disciplines d
   set rules_text = s.rules_text
  from public.seasons s
 where s.id = d.season_id
   and s.rules_text <> ''
   and d.id = (
     select d2.id from public.disciplines d2
      where d2.season_id = d.season_id
      order by d2.position, d2.created_at
      limit 1
   );

-- ── 3. EL GRANT DE COLUMNA ───────────────────────────────────────────────────
-- `0015_disciplines.sql:69` revoca UPDATE entero y `:70` regrant una lista de
-- columnas con nombre. Los grants de columna son aditivos, así que esta única
-- sentencia es todo el arreglo; `0015` no se edita (las migraciones son
-- append-only).
--
-- SÓLO `rules_text`. `allows_draw` queda deliberadamente AFUERA: `0015:66-68`
-- dice que `pair_size`/`allows_draw` "son identidad y forma, se fijan al crear
-- la disciplina y no se editan", y `db/open-score-screens.db.test.ts:89` ya
-- corre sobre esa premisa. Este cambio sólo LEE `allows_draw`, nunca lo
-- escribe.
--
-- Sin este grant, guardar reglas falla RUIDOSO, no en silencio: PostgREST
-- devuelve `permission denied for table disciplines`, el futuro
-- `updateDisciplineRules` (slice 2) ve `error !== null` y tira un `EdgeError`
-- que el admin lee en pantalla.
grant update (rules_text) on public.disciplines to authenticated;

-- ── 4. season_public_formats, ENSANCHADA ────────────────────────────────────
-- DROP + CREATE, no `create or replace`: agregar columnas cambia el tipo de
-- `returns table`, y Postgres lo rechaza en un replace —medido en 0038:
-- `ERROR: cannot change return type of existing function`—. El drop se lleva
-- los grants, por eso el revoke/grant de más abajo es MANDATORIO y no
-- decorativo: sin él, el próximo `select` de un extraño devuelve "permission
-- denied for function season_public_formats" y la única superficie pública
-- del sistema queda rota hasta el próximo deploy.
--
-- Este drop es seguro por UNA sola razón, y no generaliza: `season_public_
-- formats` NO EXISTE EN PRODUCCIÓN. Nace con la cadena `0015+`, todavía sin
-- publicar (producción corre `main`, migraciones `0001`-`0014` —
-- docs/despliegue.md), así que `0038` y este `0069` aplican uno atrás del otro
-- en la MISMA corrida y ningún consumidor real observa el hueco entre el drop
-- y el create. `season_public_rules` (0007_write_screens.sql:124 /
-- 0022_default_discipline_config.sql:19) SÍ vive en producción y no se toca
-- ni una letra acá.
drop function if exists public.season_public_formats(uuid);

-- ── Las cuatro columnas nuevas, y la línea que 0038 en realidad buscaba ─────
-- `anon` vive detrás de `revoke all on all tables` (0009): cero tablas, una
-- función. `0038:21-32` justificó no publicar una lista de columnas nombrando
-- juntas a `pair_size`, `allows_draw`, `has_masters`, `weight`, `status` y
-- `season_id` como "estructura interna" — y esa lista archivó mal a tres.
--
-- El principio real: ESTRUCTURA INTERNA se queda adentro; REGLAS DE JUEGO
-- salen. `id`, `season_id`, `status`, `weight`, `position`, `created_at` son
-- identidad y ciclo de vida — ningún extraño con un link tiene por qué verlos.
-- `has_masters`, `pair_size` y `allows_draw` son reglas del juego, de la MISMA
-- familia que `matchFormat.tieBreak`/`points`, que `config` ya le publica a
-- `anon` HOY. Argumento por columna:
--
--   · `rules_text`  — `anon` YA recibe este dato exacto por `season_public_
--     rules` (0022) para la disciplina por defecto. Esto es N filas de la
--     MISMA columna en vez de 1. Cero clase de dato nueva.
--   · `has_masters` — la página YA le afirma a `anon` "El año cierra con un
--     Masters..." sin condición (`narrate.ts`). La columna no revela un hecho
--     nuevo: decide si esa afirmación, que la página YA hace, es cierta o hay
--     que borrarla. Retenerla no es privacidad — es lo que hoy obliga a la
--     página a mentirle a un extraño.
--   · `pair_size`   — ya se DERIVA de lo que `0038` publica hoy: `config.
--     points.length` es `squadSize` (1v1) o `squadSize/2` (parejas)
--     (`core/types.ts:50`). La columna no agrega información, ahorra la
--     cuenta. Y la página ya imprime "Se arman parejas" a `anon` sin mirar
--     esta columna.
--   · `allows_draw` — la MÁS débil en "no agrega info", y la que se defiende
--     por necesidad: NO es derivable (`core/types.ts:35-37` la hace
--     ortogonal a `openScore` a propósito), así que publica un bit
--     genuinamente nuevo. Lo que dice ese bit es si un resultado empatado es
--     legal ACÁ — una regla de juego, la categoría de dato más al punto
--     posible para una página cuyo único trabajo es publicar las reglas. Y la
--     página YA le promete una respuesta a esta pregunta
--     ("Puede terminar empatado."), sólo que a veces la equivocada. Una
--     página de reglas que se calla una regla de juego se calla lo único que
--     existe para publicar.
--
-- Afuera, sin cambios: `d.id`, `season_id`, `status`, `weight`, `position`,
-- `created_at`, `fixed_teams`.
create function public.season_public_formats(p_season uuid)
returns table (
  kind        text,
  config      jsonb,
  rules_text  text,
  has_masters boolean,
  pair_size   int,
  allows_draw boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.kind, d.config, d.rules_text, d.has_masters, d.pair_size, d.allows_draw
    from public.disciplines d
   where d.season_id = p_season
   order by d.position, d.created_at
$$;

-- El drop se lleva los grants: sin este par, la función queda sin superficie
-- para nadie, ni `anon` ni `authenticated`. Mismo idioma que 0019/0021/0022/0038.
revoke execute on function public.season_public_formats(uuid) from public;
grant  execute on function public.season_public_formats(uuid) to anon, authenticated;
