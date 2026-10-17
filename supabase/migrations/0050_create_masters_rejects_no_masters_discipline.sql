-- C34 (verify-report-pre-contract #4026) + decisión #4027, 1 de 3 ─────────
--
-- Una disciplina de a uno (`pair_size=1`) crea su Masters sin que nada la
-- valide, y ese Masters rechaza para siempre armarse (`generateMastersPairs`,
-- `db/matchday.ts`, "El Masters se juega de a parejas: una disciplina de
-- a uno no lo arma."). `close_matchday` del Masters es lo ÚNICO que pone
-- `disciplines.status = 'FINISHED'`: la disciplina queda trabada y la
-- temporada no se puede terminar NUNCA.
--
-- Decisión de Stefano (#4027): `disciplines.has_masters` (0015:21, default
-- `true`, CERO lectores de producción hasta acá) se empieza a LEER. Esta
-- migración es la mitad DEFENSIVA: `create_masters` rechaza para una
-- disciplina que declaró que no juega Masters, sin importar cuánto lleva
-- jugado. `0051` (siguiente migración) es la mitad de CIERRE: cómo esa
-- disciplina SÍ termina, con su última fecha regular. `0052` es el trinquete
-- simétrico en `reopen_matchday`. Las tres van separadas porque la regla del
-- repo es una función por migración (`db/migrations.unit.test.ts`).
--
-- Restatement de la ÚLTIMA versión (0049, verificado con
-- `rg '^create( or replace)? function|^drop function'` -> una sola función
-- en ese archivo). Único cambio: el guard nuevo, justo después de resolver
-- la disciplina y ANTES de contar fechas cerradas.
create or replace function public.create_masters(p_season uuid, p_played_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discipline  uuid;
  v_pair_size   int;
  v_allows_draw boolean;
  v_has_masters boolean;
  v_regular     int;
  v_closed      int;
  v_number      int;
  v_new         uuid;
begin
  if not public.is_season_admin(p_season) then
    raise exception 'Sólo quien organiza la temporada puede armar el Masters.';
  end if;

  select id, pair_size, allows_draw, has_masters, (config ->> 'regularMatchdays')::int
    into v_discipline, v_pair_size, v_allows_draw, v_has_masters, v_regular
    from public.disciplines
   where season_id = p_season
   order by position, created_at
   limit 1;
  if v_discipline is null then
    raise exception 'La temporada no tiene disciplina.';
  end if;

  if not v_has_masters then
    raise exception 'Esta disciplina no juega Masters: termina con su última fecha regular.';
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

  insert into public.matchdays (season_id, discipline_id, number, kind, played_on, pair_size, allows_draw)
  values (p_season, v_discipline, v_number, 'MASTERS', p_played_on, v_pair_size, v_allows_draw)
  returning id into v_new;

  return v_new;
end;
$$;

revoke execute on function public.create_masters(uuid, date) from public, anon;
grant  execute on function public.create_masters(uuid, date) to authenticated;
