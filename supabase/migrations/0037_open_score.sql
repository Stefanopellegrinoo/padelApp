-- PR 20 rebanada D1 (torneo-multi-disciplina) — backfill de `openScore` ─────
--
-- `MatchFormat` gana `openScore: boolean` (decisión #3933, design #3801
-- `tipos`): un partido de FIFA se carga con marcador de goles abierto, o sea
-- cualquier par de enteros >= 0 (`3-1`, `0-0`, `2-2`), sin número objetivo ni
-- tope de games.
--
-- ── ESTA MIGRACIÓN NO TOCA EL SCHEMA, Y NO HACE FALTA QUE LO TOQUE ──────────
-- `match_sets` ya guarda `games_a int not null check (games_a >= 0)` y lo mismo
-- `games_b`, SIN tope superior (0001_schema.sql:194-203), y `match_sets_no_draw`
-- quedó condicionado por 0034 a `(allows_draw or games_a <> games_b)`. Medido:
-- la base YA acepta un `3-1` y un `0-0`. Quien los prohibía era `setError`
-- (`db/validate.ts`), del lado de la app. Lo único que falta del lado de la
-- base es que las configs que ya existen digan qué formato son.
--
-- ── POR QUÉ EL BACKFILL VA EN LA MISMA PR QUE EL TIPO ───────────────────────
-- Regla del design (PUNTO 3): "Tipos y backfill del jsonb SIEMPRE en la misma
-- PR". `db/read.ts:198,525` lee la columna con `row.config as unknown as
-- SeasonConfig` —un cast, no una validación—, así que una fila sin la clave le
-- da `undefined` a un campo que el tipo declara `boolean`. Es `false` por
-- casualidad (falsy), no por decisión, y es exactamente la asimetría que este
--Proyecto ya pisó dos veces con `pair_size` y `allows_draw`.
--
-- `false` y no `true` para todas: la única disciplina que existe hoy en
-- producción es de pádel, que se juega con marcador cerrado. `openScore = false`
--Deja `setError`/`matchError` en el camino de siempre, byte a byte (REQ-NR-1).
--
-- `where not (config ? 'openScore')` en vez de un update ciego: es idempotente
-- y no le pisa el valor a nadie que ya lo haya elegido.

update public.disciplines
   set config = jsonb_set(
     config,
     '{matchFormat,openScore}',
     'false'::jsonb,
     true
   )
 where config ? 'matchFormat'
   and not (config -> 'matchFormat' ? 'openScore');

-- `seasons.config` sigue viva hasta el contract (PR27, paso 11 de
-- `secuencia_expand_contract`) y es de donde `supabase/seed.sql` copia la
-- config de la disciplina. Dejarla atrás sería dejar la fuente del seed
-- diciendo una cosa y la copia otra.
update public.seasons
   set config = jsonb_set(
     config,
     '{matchFormat,openScore}',
     'false'::jsonb,
     true
   )
 where config ? 'matchFormat'
   and not (config -> 'matchFormat' ? 'openScore');

-- Tripwire, mismo idioma que el `do $$ ... raise exception` de 0023: un
-- backfill silencioso a medias es peor que uno que falla. Si alguna fila tiene
-- `matchFormat` sin `openScore` después del update, la migración no terminó.
--
--Las DOS tablas, no sólo `disciplines`. El
-- comentario de arriba argumenta que `seasons` importa —"dejar la fuente del
-- seed diciendo una cosa y la copia otra"— y sin embargo el único update que se
-- verificaba era el otro. La asimetría no es teórica: medido en psql, un
-- `matchFormat` ESCALAR (`{"matchFormat": 7}`) sobrevive el `jsonb_set`
-- INTACTO, y en `disciplines` el tripwire lo caza mientras que en `seasons`
-- pasaba en silencio.
do $$
declare
  v_disciplines int;
  v_seasons     int;
begin
  select count(*) into v_disciplines
    from public.disciplines
   where config ? 'matchFormat'
     and not (config -> 'matchFormat' ? 'openScore');
  if v_disciplines <> 0 then
    raise exception 'Backfill incompleto: % disciplinas siguen sin openScore.', v_disciplines;
  end if;

  select count(*) into v_seasons
    from public.seasons
   where config ? 'matchFormat'
     and not (config -> 'matchFormat' ? 'openScore');
  if v_seasons <> 0 then
    raise exception 'Backfill incompleto: % temporadas siguen sin openScore.', v_seasons;
  end if;
end $$;
