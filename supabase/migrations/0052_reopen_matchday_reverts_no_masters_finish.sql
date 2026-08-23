-- C34 (verify-report-pre-contract #4026) + decisión #4027, 3 de 3 ─────────
--
-- Trinquete simétrico a `0051`: si la fecha que se reabre fue la que dejó a
-- una disciplina sin Masters en FINISHED (su última fecha regular), reabrirla
-- la vuelve a ACTIVE. Sin esto, reabrir esa fecha dejaría la disciplina
-- FINISHED con su propia fecha de vuelta abierta -- el mismo trinquete roto
-- que el Masters ya tiene resuelto para su propio caso, dos migraciones atrás
-- en el tiempo (0019).
--
-- Restatement del CUERPO de `reopen_matchday` en `0019_discipline_status_
-- moves.sql:173-239` -- la única versión que existe, y la copia es sólo de
-- esa función: `0019` define TRES (`open_matchday`, `close_matchday`,
-- `reopen_matchday`), y `close_matchday` quedó superada hace rato por
-- `0051` -- copiar el archivo entero la habría revertido en silencio, la
-- misma trampa que `0025` le tendió a `0031` (ver `db/migrations.unit.
-- test.ts`).
--
-- El guard `status = 'FINISHED'` alcanza sin releer `has_masters`: por
-- construcción sólo la ÚLTIMA fecha regular de una disciplina sin Masters
-- pudo haber marcado FINISHED, y "sólo se reabre la última fecha cerrada" ya
-- está garantizado más arriba en esta misma función.
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

  if v_kind = 'MASTERS' then
    update public.seasons set status = 'ACTIVE' where id = v_season;
    update public.disciplines set status = 'ACTIVE' where id = v_discipline;
  elsif v_kind = 'REGULAR' then
    update public.disciplines set status = 'ACTIVE' where id = v_discipline and status = 'FINISHED';
  end if;
end;
$$;

revoke execute on function public.reopen_matchday(uuid) from public, anon;
grant  execute on function public.reopen_matchday(uuid) to authenticated;
