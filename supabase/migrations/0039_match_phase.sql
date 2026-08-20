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

revoke execute on function public.matchday_phase(uuid) from public, anon;
grant  execute on function public.matchday_phase(uuid) to authenticated;
