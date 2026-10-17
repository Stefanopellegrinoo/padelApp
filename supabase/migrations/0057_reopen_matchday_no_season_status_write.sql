-- Bloqueante #2 del CONTRACT (verify-report-pre-contract #4026) — 3 de 4 ────
--
-- `seasons.status` deja de tener escritor de producción (ver `0055` para el
-- resto de la nota). Restatement de la ÚLTIMA versión de `reopen_matchday`
-- (`0052_reopen_matchday_reverts_no_masters_finish.sql`, verificado con
-- `rg '^create( or replace)? function|^drop function'` → una sola función en
-- ese archivo, así que se copia entero).
--
-- Único cambio real: se cae la línea
-- `update public.seasons set status = 'ACTIVE' where id = v_season;` del
-- bloque `if v_kind = 'MASTERS'`. El resto del bloque (el trinquete de
-- `disciplines.status`) y la rama `elsif v_kind = 'REGULAR'` (que ya NO tocaba
-- `seasons.status`, decisión #4027) quedan intactos.
create or replace function public.reopen_matchday(p_matchday uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season     uuid;
  v_discipline uuid;
  v_number     int;
  v_status     text;
  v_kind       text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede reabrir una fecha.';
  end if;

  select discipline_id, number, status, kind into v_discipline, v_number, v_status, v_kind
    from public.matchdays where id = p_matchday for update;

  if v_status <> 'CLOSED' then
    raise exception 'Esta fecha no está cerrada.';
  end if;

  delete from public.matchdays m
   where m.discipline_id = v_discipline
     and m.id <> p_matchday
     and m.status = 'DRAFT'
     and not exists (select 1 from public.pairs       x where x.matchday_id = m.id)
     and not exists (select 1 from public.attendances x where x.matchday_id = m.id)
     and not exists (select 1 from public.pair_locks  x where x.matchday_id = m.id)
     and not exists (select 1 from public.entries     x where x.matchday_id = m.id);

  if exists (
    select 1 from public.matchdays
     where discipline_id = v_discipline and status <> 'CLOSED' and id <> p_matchday
  ) then
    raise exception 'La fecha siguiente ya tiene datos cargados. Borrala vos antes de reabrir ésta.';
  end if;
  if exists (
    select 1 from public.matchdays
     where discipline_id = v_discipline and number > v_number and status = 'CLOSED'
  ) then
    raise exception 'Sólo se reabre la última fecha cerrada: las parejas de las que siguen salieron de esta tabla.';
  end if;

  delete from public.awards where matchday_id = p_matchday;
  update public.matchdays set status = 'OPEN', closed_at = null where id = p_matchday;

  -- `seasons.status` ya no se toca en ninguna de las dos ramas.
  if v_kind = 'MASTERS' then
    update public.disciplines set status = 'ACTIVE' where id = v_discipline;
  elsif v_kind = 'REGULAR' then
    update public.disciplines set status = 'ACTIVE' where id = v_discipline and status = 'FINISHED';
  end if;
end;
$$;

revoke execute on function public.reopen_matchday(uuid) from public, anon;
grant  execute on function public.reopen_matchday(uuid) to authenticated;
