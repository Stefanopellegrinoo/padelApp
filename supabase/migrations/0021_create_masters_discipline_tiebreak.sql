-- ── N1 (verify-report ronda 2): create_masters resolvía la disciplina con la
-- TERCERA instancia del mismo bug, y la peor de las tres porque falla EN
-- SILENCIO ────────────────────────────────────────────────────────────────
--
-- 0016_matchday_scope.sql:85 resuelve `v_discipline` con:
--   select id into v_discipline from public.disciplines where season_id = p_season;
-- Sin `order by` ni `limit 1`. En PL/pgSQL un `select ... into` con más de
-- una fila NO da error: toma una fila arbitraria, la que el plan le entregue
-- primero. Con el tripwire `disciplines_one_per_season` caído (0018) una
-- temporada ya puede tener más de una disciplina, y el plan por defecto
-- (Index Scan sobre `disciplines_by_season(season_id, position)`) tapaba el
-- problema por coincidencia — coincide con `position, created_at` sólo
-- porque ese índice también ordena por `position`. Un Seq Scan sobre un heap
-- escrito en otro orden elige otra fila, probado por ejecución forzando
-- `enable_indexscan = off`.
--
-- Es la misma clase de bug que `createMatchday` (db/matchday.ts) tenía con
-- `.single()` — pero aquél rompía RUIDOSO (PGRST116, "multiple rows"); éste
-- elige mal EN SILENCIO. El criterio de desempate tiene que ser el MISMO en
-- SQL y en TypeScript: `order by position, created_at limit 1`, calcado de
-- `defaultDisciplineId` (db/season.ts).
--
-- Restatement quirúrgico: sólo cambia la resolución de `v_discipline`, el
-- resto de la función es byte a byte igual a 0016_matchday_scope.sql.
create or replace function public.create_masters(p_season uuid, p_played_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discipline uuid;
  v_regular    int;
  v_closed     int;
  v_number     int;
  v_new        uuid;
begin
  if not public.is_season_admin(p_season) then
    raise exception 'Sólo quien organiza la temporada puede armar el Masters.';
  end if;

  select (config ->> 'regularMatchdays')::int into v_regular
    from public.seasons where id = p_season;
  if v_regular is null then
    raise exception 'La temporada no existe.';
  end if;

  select id into v_discipline
    from public.disciplines
   where season_id = p_season
   order by position, created_at
   limit 1;
  if v_discipline is null then
    raise exception 'La temporada no tiene disciplina.';
  end if;

  select count(*) into v_closed
    from public.matchdays
   where discipline_id = v_discipline and kind = 'REGULAR' and status = 'CLOSED';

  if v_closed < v_regular then
    raise exception 'El Masters se juega al terminar las % fechas: faltan %.',
      v_regular, v_regular - v_closed;
  end if;

  select coalesce(max(number), 0) + 1 into v_number
    from public.matchdays where discipline_id = v_discipline;

  -- `matchdays_one_masters` frena el segundo Masters y `matchdays_one_live`
  -- frena crearlo con otra fecha sin cerrar. Los dos levantan 23505; el borde
  -- de TypeScript traduce ese código a un mensaje que se pueda leer.
  insert into public.matchdays (season_id, discipline_id, number, kind, played_on)
  values (p_season, v_discipline, v_number, 'MASTERS', p_played_on)
  returning id into v_new;

  return v_new;
end;
$$;

-- Grants ya vivían para esta función (0016) y `create or replace` los
-- conserva; se repiten acá por explicitud y porque es el mismo idioma que ya
-- usa el resto de las migraciones de restatement (0019).
revoke execute on function public.create_masters(uuid, date) from public, anon;
grant  execute on function public.create_masters(uuid, date) to authenticated;
