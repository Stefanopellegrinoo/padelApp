-- Bloqueante #2 del CONTRACT (verify-report-pre-contract #4026) — 4 de 4 ────
--
-- `seasons.status` deja de tener escritor de producción (ver `0055` para el
-- resto de la nota). Restatement de la ÚLTIMA versión de `cancel_matchday`
-- (`0018_reopen_cancel_scoped.sql:114-158`, verificado con
-- `rg '^create( or replace)? function|^drop function' 0018_reopen_cancel_
-- scoped.sql` → ese archivo define DOS funciones, `reopen_matchday` y
-- `cancel_matchday`, y `reopen_matchday` ya está superada por `0057` — se
-- copia SÓLO el cuerpo de `cancel_matchday`, no el archivo entero, para no
-- revertir `reopen_matchday` en silencio (la trampa de `0025`→`0031`,
-- `db/migrations.unit.test.ts`).
--
-- Único cambio real: se cae el bloque
-- `update public.seasons set status = 'SETUP' where id = v_season and status
-- = 'ACTIVE' and not exists (...);`. El trinquete gemelo de
-- `disciplines.status`, dos líneas más abajo, no se toca.
create or replace function public.cancel_matchday(p_matchday uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season     uuid;
  v_discipline uuid;
  v_status     text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede borrar una fecha.';
  end if;

  select discipline_id, status into v_discipline, v_status
    from public.matchdays where id = p_matchday for update;
  if v_status is null then
    raise exception 'La fecha no existe.';
  end if;
  if v_status not in ('DRAFT', 'OPEN') then
    raise exception 'Una fecha cerrada no se borra. Si hay que corregirla y es la última cerrada, reabrila.';
  end if;

  delete from public.matchdays where id = p_matchday;

  -- El mismo trinquete, a nivel disciplina: sólo si no quedó ninguna fecha
  -- en ESTA disciplina. `seasons.status` ya no se toca acá.
  update public.disciplines set status = 'SETUP'
   where id = v_discipline
     and status = 'ACTIVE'
     and not exists (select 1 from public.matchdays where discipline_id = v_discipline);
end;
$$;

revoke execute on function public.cancel_matchday(uuid) from public, anon;
grant  execute on function public.cancel_matchday(uuid) to authenticated;
