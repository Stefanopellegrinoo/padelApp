-- Corte a producción, paso PRE. Se corre contra prod justo antes del push:
--   psql "$PROD_DB_URL" -f scripts/corte-prod/pre.sql
-- Congela una copia de cada tabla en el schema `audit_pre` (post.sql compara
-- contra ella) y chequea lo que haría fallar a alguna migración.
-- `create schema` falla si `audit_pre` ya existe: nunca pisa una foto vieja.
\set ON_ERROR_STOP on
\pset footer off
create schema audit_pre;
create table audit_pre.seasons     as select * from public.seasons;
create table audit_pre.matchdays   as select * from public.matchdays;
create table audit_pre.players     as select * from public.players;
create table audit_pre.entries     as select * from public.entries;
create table audit_pre.attendances as select * from public.attendances;
create table audit_pre.awards      as select * from public.awards;
create table audit_pre.pairs       as select * from public.pairs;
create table audit_pre.matches     as select * from public.matches;
create table audit_pre.match_sets  as select * from public.match_sets;
create table audit_pre.pair_locks  as select * from public.pair_locks;
create table audit_pre.auth_users  as select id, email, created_at from auth.users;

\echo == PRE: lo que dice "debe dar 0" tiene que dar 0 ==
select 'P1 partidos repetidos en una fecha (0046) — debe dar 0' chk, count(*) got from (select matchday_id, pair_a, pair_b from public.matches group by 1,2,3 having count(*)>1) x
union all select 'P2 fechas sin temporada — debe dar 0', count(*) from public.matchdays m where not exists (select 1 from public.seasons s where s.id=m.season_id)
union all select 'P3 temporadas sin matchFormat (0037) — info', count(*) from public.seasons where not (config ? 'matchFormat')
union all select 'P3b temporadas que ya tienen openScore — info', count(*) from public.seasons where config->'matchFormat' ? 'openScore'
union all select 'P4 GUEST sin seed_position (0066) — debe dar 0', count(*) from public.entries where kind='GUEST' and seed_position is null
union all select 'P5 seeds SQUAD repetidos en una temporada (0023) — debe dar 0', count(*) from (select season_id, seed_position from public.entries where kind='SQUAD' group by 1,2 having count(*)>1) x
union all select 'P6 SQUAD sin seed_position — info', count(*) from public.entries where kind='SQUAD' and seed_position is null
union all select 'P7 parejas sin entry_b (0028) — debe dar 0', count(*) from public.pairs where entry_b is null
union all select 'P8 sets empatados (0034/0042) — debe dar 0', count(*) from public.match_sets where games_a = games_b
union all select 'P9 temporadas con status raro — debe dar 0', count(*) from public.seasons where status not in ('ACTIVE','CLOSED');

\echo == Nombres que borran 0016, 0034, 0039, 0042 y 0066: todos tienen que dar t ==
select n, to_regclass('public.'||n) is not null ok from unnest(array['matchdays_one_live','matchdays_one_masters','matchdays_by_season','matches_by_matchday','entries_seed']) n
union all select 'con matchdays_season_id_number_key', exists(select 1 from pg_constraint where conname='matchdays_season_id_number_key' and conrelid='public.matchdays'::regclass)
union all select 'con match_sets_no_draw', exists(select 1 from pg_constraint where conname='match_sets_no_draw' and conrelid='public.match_sets'::regclass)
union all select 'fn season_invite(text)', to_regprocedure('public.season_invite(text)') is not null
union all select 'fn shift_seeds_up(uuid,int)', to_regprocedure('public.shift_seeds_up(uuid,int)') is not null
union all select 'fn add_squad_seat(uuid,text,uuid)', to_regprocedure('public.add_squad_seat(uuid,text,uuid)') is not null
union all select 'pol match_sets_write (0089 aplicada)', exists(select 1 from pg_policy where polname='match_sets_write')
union all select 'col seasons.players_can_score (0089 aplicada)', exists(select 1 from information_schema.columns where table_schema='public' and table_name='seasons' and column_name='players_can_score')
union all select 'trigger on_auth_user_created', exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created');

\echo == Cantidades (anotalas: post.sql tiene que dar lo mismo) ==
select 'auth.users' t, count(*) from auth.users
union all select 'seasons', count(*) from public.seasons
union all select 'matchdays', count(*) from public.matchdays
union all select 'players', count(*) from public.players
union all select 'entries', count(*) from public.entries
union all select 'attendances', count(*) from public.attendances
union all select 'awards', count(*) from public.awards
union all select 'pairs', count(*) from public.pairs
union all select 'matches', count(*) from public.matches
union all select 'match_sets', count(*) from public.match_sets
union all select 'pair_locks', count(*) from public.pair_locks;
