-- Corte a producción, paso POST. Se corre contra prod después del push:
--   psql "$PROD_DB_URL" -f scripts/corte-prod/post.sql
-- Compara contra la foto que dejó pre.sql en `audit_pre`. Todo tiene que dar
-- 0 / 0 en A y OK en B. Ensayado sobre una copia de prod el 17/10/2026: 26/26.
\set ON_ERROR_STOP on
\pset footer off
-- Filas de audit_pre.<t> sin una fila idéntica en public.<t>, en las columnas
-- que siguen existiendo (menos las excluidas), y al revés.
create function pg_temp.lost(t text, excl text[] default '{}') returns table(missing bigint, extra bigint, cols text) language plpgsql as $$
declare c text;
begin
  select string_agg(quote_ident(a.column_name), ',' order by a.ordinal_position) into c
    from information_schema.columns a join information_schema.columns b
      on b.table_schema='public' and b.table_name=t and b.column_name=a.column_name
   where a.table_schema='audit_pre' and a.table_name=t and a.column_name <> all(excl);
  return query execute format('select (select count(*) from (select %1$s from audit_pre.%2$I except all select %1$s from public.%2$I) x),
                                      (select count(*) from (select %1$s from public.%2$I except all select %1$s from audit_pre.%2$I) y), %3$L', c, t, c);
end $$;

\echo == A. Cada fila de antes sigue igual (missing y extra tienen que dar 0) ==
select 'seasons' t, * from pg_temp.lost('seasons')
union all select 'matchdays', * from pg_temp.lost('matchdays')
union all select 'players', * from pg_temp.lost('players')
union all select 'entries(-seed_position)', * from pg_temp.lost('entries', '{seed_position}')
union all select 'attendances', * from pg_temp.lost('attendances')
union all select 'awards', * from pg_temp.lost('awards')
union all select 'pairs', * from pg_temp.lost('pairs')
union all select 'matches', * from pg_temp.lost('matches')
union all select 'match_sets', * from pg_temp.lost('match_sets')
union all select 'pair_locks', * from pg_temp.lost('pair_locks');

\echo == B. Invariantes (todas tienen que dar OK) ==
select chk, expected, got, case when expected=got then 'OK' else 'FAIL' end res from (
 select 'B1 auth.users sin cambios (id, email, created_at)' chk, '0' expected, (select count(*) from (select id,email,created_at from audit_pre.auth_users except select id,email,created_at from auth.users) x)::text got
 union all select 'B2 cantidad de auth.users', (select count(*) from audit_pre.auth_users)::text, (select count(*) from auth.users)::text
 union all select 'B3 seasons.config y status ya no existen (0066)', '0', (select count(*) from information_schema.columns where table_schema='public' and table_name='seasons' and column_name in ('config','status'))::text
 union all select 'B4 una disciplina por temporada', '0', (select count(*) from public.seasons s where (select count(*) from public.disciplines d where d.season_id=s.id) <> 1)::text
 union all select 'B5 disciplines.config contiene la config de antes', '0', (select count(*) from audit_pre.seasons p join public.disciplines d on d.season_id=p.id where not d.config @> p.config)::text
 union all select 'B6 matchFormat.openScore=false (0037)', '0', (select count(*) from public.disciplines where (config->'matchFormat'->>'openScore') is distinct from 'false')::text
 union all select 'B7 disciplines.status = status de antes', '0', (select count(*) from audit_pre.seasons p join public.disciplines d on d.season_id=p.id where d.status is distinct from p.status)::text
 union all select 'B8 disciplines.rules_text = rules_text de antes (0069)', '0', (select count(*) from audit_pre.seasons p join public.disciplines d on d.season_id=p.id where d.rules_text is distinct from p.rules_text)::text
 union all select 'B9 filas de discipline_entries = SQUAD de antes', (select count(*) from audit_pre.entries where kind='SQUAD')::text, (select count(*) from public.discipline_entries)::text
 union all select 'B10 seeds de discipline_entries distintos a los de antes', '0', (select count(*) from audit_pre.entries e left join public.discipline_entries de on de.entry_id=e.id where e.kind='SQUAD' and de.seed_position is distinct from e.seed_position)::text
 union all select 'B11 seeds de season_seed_order distintos a los de antes (0080)', '0', (select count(*) from audit_pre.entries e left join public.season_seed_order so on so.entry_id=e.id and so.season_id=e.season_id where e.kind='SQUAD' and so.seed_position is distinct from e.seed_position)::text
 union all select 'B12 filas de season_seed_order = SQUAD de antes', (select count(*) from audit_pre.entries where kind='SQUAD')::text, (select count(*) from public.season_seed_order)::text
 union all select 'B13 SQUAD con seed_position (0066 lo anula)', '0', (select count(*) from public.entries where kind='SQUAD' and seed_position is not null)::text
 union all select 'B14 seed_position de GUEST sin cambios', '0', (select count(*) from audit_pre.entries p join public.entries e using (id) where p.kind='GUEST' and e.seed_position is distinct from p.seed_position)::text
 union all select 'B15 matchdays.discipline_id de su temporada', '0', (select count(*) from public.matchdays m join public.disciplines d on d.id=m.discipline_id where d.season_id <> m.season_id)::text
 union all select 'B16 fechas sin disciplina', '0', (select count(*) from public.matchdays where discipline_id is null)::text
 union all select 'B17 attendances.discipline_id = el de su fecha', '0', (select count(*) from public.attendances a join public.matchdays m on m.id=a.matchday_id where a.discipline_id is distinct from m.discipline_id)::text
 union all select 'B18 partidos con fase GRUPO, grupo 1', '0', (select count(*) from public.matches where fase<>'GRUPO' or grupo<>1)::text
 union all select 'B19 sets con fase GRUPO', '0', (select count(*) from public.match_sets where fase<>'GRUPO')::text
 union all select 'B20 suma de puntos de awards', (select coalesce(sum(points),0)::text from audit_pre.awards), (select coalesce(sum(points),0)::text from public.awards)
 union all select 'B21 suma de games de los sets', (select coalesce(sum(games_a)+sum(games_b),0)::text from audit_pre.match_sets), (select coalesce(sum(games_a)+sum(games_b),0)::text from public.match_sets)
 union all select 'B22 players_can_score sin cambios (0089)', '0', (select count(*) from audit_pre.seasons p join public.seasons s using (id) where s.players_can_score is distinct from p.players_can_score)::text
 union all select 'B23 fechas por estado', (select string_agg(status||'='||n, ',' order by status) from (select status, count(*) n from audit_pre.matchdays group by 1) x), (select string_agg(status||'='||n, ',' order by status) from (select status, count(*) n from public.matchdays group by 1) x)
 union all select 'B24 trigger on_auth_user_created', '1', (select count(*) from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created')::text
) z;

\echo == C. Constraints sin validar: sólo matchdays_match_format_shape (0098) y realtime.messages_payload_exclusive (de Supabase) ==
select conrelid::regclass, conname, contype from pg_constraint where not convalidated order by 1,2;

\echo == D. Tablas públicas SIN RLS: tiene que dar vacío ==
select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity;
