-- ── matches.fase + matches.grupo (REQ-D7-1) ──────────────────────────────────
-- Aditiva y plana: `matches` está lejísimos del umbral de ~100k filas donde el
-- patrón expand/contract (not valid + validate en archivos separados) paga
-- algo. `create index concurrently` es ILEGAL acá de todos modos: el CLI de
-- Supabase corre cada archivo dentro de UNA transacción (25001).
alter table public.matches
  add column fase  text not null default 'GRUPO'
    check (fase in ('GRUPO', 'OCTAVOS', 'CUARTOS', 'SEMI', 'TERCER_PUESTO', 'FINAL')),
  add column grupo int not null default 1 check (grupo >= 1),
  -- `grupo` sólo significa algo en la fase de grupos. Sin esto existe
  -- "semifinal del grupo 3", que no es nada.
  add constraint matches_group_only_in_groups check (fase = 'GRUPO' or grupo = 1);

-- El índice viejo (0001_schema.sql:191) no tiene prefijo por fase/grupo; el
-- nuevo sí, porque las pantallas de la llave van a filtrar por
-- (matchday_id, fase, grupo) antes que por round.
drop index public.matches_by_matchday;
create index matches_by_phase on public.matches (matchday_id, fase, grupo, round);

-- ── matchday_phase (REQ-D7-3) ─────────────────────────────────────────────────
-- La fase actual se DEDUCE — última fase con partidos creados — sin columna de
-- estado nueva en matchdays. TERCER_PUESTO va ANTES de FINAL en el array a
-- propósito: se generan juntas y el máximo tiene que dar FINAL.
create or replace function public.matchday_phase(p_matchday uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select fase from public.matches where matchday_id = p_matchday
   order by array_position(
     array['GRUPO', 'OCTAVOS', 'CUARTOS', 'SEMI', 'TERCER_PUESTO', 'FINAL'],
     fase
   ) desc
   limit 1
$$;

-- W5 (0020_disciplines_grants.sql): 0 consumidores de producción, 0 policies
-- de RLS. `security definer` + `grant ... to authenticated` sin uso real es
-- exactamente el agujero que 0020 cerró para `matchday_discipline` — con esa
-- combinación cualquier `authenticated` aprende la fase de una fecha de una
-- temporada donde no participa, porque RLS no la frena. Se revoca de los tres,
-- no se dropea: la rebanada que traiga el primer consumidor real (C,
-- `advancePhase`, si termina necesitándola en vez de leer `fase` del mismo
-- `select` que ya tiene) le agrega el grant ahí, junto con ese consumidor.
revoke execute on function public.matchday_phase(uuid) from public, anon, authenticated;
