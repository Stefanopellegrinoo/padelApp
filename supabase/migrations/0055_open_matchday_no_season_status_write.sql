-- Bloqueante #2 del CONTRACT (verify-report-pre-contract #4026) — 1 de 4 ────
--
-- `seasons.status` deja de tener escritor de producción. El estado real de
-- una temporada ya vive en `disciplines.status` desde
-- `0019_discipline_status_moves.sql`, y desde esta tanda `SeasonHeader.status`
-- (db/read.ts) lo DERIVA de ahí (REQ-D3-3, `seasonStatusOf`) en vez de leer
-- la columna. Con cero lectores, la columna queda como dato muerto hasta que
-- el contract (PR27) la dropee — no acá: NO se toca el DDL.
--
-- Restatement de la ÚLTIMA versión de `open_matchday`
-- (`0019_discipline_status_moves.sql:27-69`, verificado con
-- `rg '^create( or replace)? function|^drop function' 0019_discipline_status_
-- moves.sql` → ese archivo define TRES funciones, `open_matchday`,
-- `close_matchday` y `reopen_matchday`, y las otras dos ya están superadas
-- (`close_matchday` por `0051`, `reopen_matchday` por `0052`) — se copia SÓLO
-- el cuerpo de `open_matchday`, no el archivo entero, para no revertirlas en
-- silencio (la trampa de `0025`→`0031`, `db/migrations.unit.test.ts`).
--
-- Único cambio: se cae la línea
-- `update public.seasons set status = 'ACTIVE' where id = v_season and status
-- = 'SETUP';`. El trinquete gemelo de `disciplines.status`, dos líneas más
-- abajo, no se toca.
create or replace function public.open_matchday(p_matchday uuid)
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
    raise exception 'Sólo quien organiza la temporada puede abrir una fecha.';
  end if;

  select discipline_id, status into v_discipline, v_status
    from public.matchdays where id = p_matchday for update;
  if v_status <> 'DRAFT' then
    raise exception 'Esta fecha ya no está en armado.';
  end if;

  if not exists (select 1 from public.pairs where matchday_id = p_matchday) then
    raise exception 'Generá las parejas antes de abrir la fecha.';
  end if;

  update public.matchdays set status = 'OPEN' where id = p_matchday;

  -- El mismo trinquete, a nivel disciplina: su propio calendario es el que
  -- arranca, no el de sus hermanas. `seasons.status` ya no se toca acá.
  update public.disciplines set status = 'ACTIVE' where id = v_discipline and status = 'SETUP';
end;
$$;

revoke execute on function public.open_matchday(uuid) from public, anon;
grant  execute on function public.open_matchday(uuid) to authenticated;
