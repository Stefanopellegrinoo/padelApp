-- Borrar fecha: DRAFT u OPEN se van enteras, con todo lo que cuelga de ellas.
-- CLOSED se rechaza a propósito: ahí ya se repartieron puntos, y lo que
-- corresponde en ese caso es reabrir (0005_matchday_moves.sql:134), no
-- desaparecerla — el mensaje de acá manda para ese lado y no para "cancelar".
--
-- No hace falta un solo delete además del de `matchdays`: attendances,
-- pair_locks, pairs, matches, match_sets y las entries GUEST de esta fecha
-- cuelgan todas de `matchday_id` con `on delete cascade` (0001_schema.sql).
-- El plantel SQUAD no tiene `matchday_id` —vive en la temporada, no en la
-- fecha— así que no hay ningún riesgo de arrastrarlo con esto.
--
-- Tampoco toca `seasons.status`: el único camino que la pone en FINISHED es
-- cerrar el Masters, y CLOSED queda afuera de esta función, así que ese
-- estado es inalcanzable desde acá. Y no deja un hueco en `number`:
-- `matchdays_one_live` garantiza como máximo una fecha sin cerrar por
-- temporada, y los números sólo crecen (`max(number) + 1` en
-- `createMatchday`), así que la que se borra siempre es la última creada.
--
-- El mensaje de `reopen_matchday` en 0005_matchday_moves.sql:178 ("Borrala
-- vos antes de reabrir ésta") NO se toca acá: hasta ahora era una promesa sin
-- ninguna acción real detrás, y desde que existe esta función el "borrala
-- vos" pasa a ser literalmente cierto. Reescribirlo sería restatear ~65
-- líneas de guardas que ya funcionan para cambiar una palabra que ya dice lo
-- correcto.
create or replace function public.cancel_matchday(p_matchday uuid)
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
    raise exception 'Sólo quien organiza la temporada puede borrar una fecha.';
  end if;

  select status into v_status from public.matchdays where id = p_matchday for update;
  if v_status = 'CLOSED' then
    raise exception 'Una fecha cerrada no se borra: reabrila si hay que corregir algo.';
  end if;

  delete from public.matchdays where id = p_matchday;
end;
$$;

revoke execute on function public.cancel_matchday(uuid) from public, anon;
grant  execute on function public.cancel_matchday(uuid) to authenticated;
