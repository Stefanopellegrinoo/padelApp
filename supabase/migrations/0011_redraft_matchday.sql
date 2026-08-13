-- Volver al armado: `OPEN → DRAFT`. Es el inverso de `open_matchday` menos el
-- trinquete `SETUP → ACTIVE`, que por diseño no se revierte. Existe porque
-- alguien se baja DESPUÉS de que las parejas están hechas —lo más común que
-- pasa en un torneo de amigos— y hasta ahora eso no se corregía sin entrar a
-- la base a mano.
--
-- No borra parejas ni partidos: el armado ya rearma solo cuando hace falta
-- (`generatePairs` redibuja, `syncGuestSeat` limpia). Perder el sorteo por
-- corregir un tilde sería un remedio peor que la enfermedad.
--
-- Y no mira las fechas vecinas, a diferencia de `reopen_matchday`. Esta
-- función es de cuatro líneas SÓLO porque `matchdays_one_live`
-- (0001_schema.sql:48 — único sobre `season_id where status <> 'CLOSED'`)
-- garantiza como máximo UNA fecha sin cerrar por temporada, y `OPEN → DRAFT`
-- deja ese predicado igual: no puede chocar con nada. Si algún día ese índice
-- se afloja, esta función deja de ser segura y hay que volver acá.
create or replace function public.redraft_matchday(p_matchday uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid;
  v_status text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede volver al armado.';
  end if;

  select status into v_status from public.matchdays where id = p_matchday for update;
  if v_status <> 'OPEN' then
    raise exception 'Sólo se vuelve al armado desde una fecha en juego.';
  end if;

  update public.matchdays set status = 'DRAFT' where id = p_matchday;
end;
$$;

revoke execute on function public.redraft_matchday(uuid) from public, anon;
grant  execute on function public.redraft_matchday(uuid) to authenticated;
