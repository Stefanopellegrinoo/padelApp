-- ── matchdays.discipline_id pasa a NOT NULL y a ser el scope real ──────────
-- Guarda de despliegue: si esto explota, el backfill de 0015 no terminó (o el
-- código nuevo creó una fecha sin discipline_id antes de que este archivo
-- corriera). REQ-NR-3.
do $$
begin
  if exists (select 1 from public.matchdays where discipline_id is null) then
    raise exception 'Hay fechas sin disciplina. El backfill de 0015 no terminó.';
  end if;
end $$;

alter table public.matchdays alter column discipline_id set not null;

-- "Una fecha viva" y "un Masters" pasan de ser por temporada a ser por
-- disciplina: dos disciplinas del mismo torneo van a poder tener cada una su
-- propia fecha abierta (REQ-D3-1) en cuanto el tripwire de 0015 caiga (PR 4).
drop index public.matchdays_one_live;
drop index public.matchdays_one_masters;
create unique index matchdays_one_live    on public.matchdays (discipline_id) where status <> 'CLOSED';
create unique index matchdays_one_masters on public.matchdays (discipline_id) where kind = 'MASTERS';

-- El número de fecha se numera por disciplina, no por temporada (REQ-D3-2):
-- la fecha 3 de pádel y la fecha 3 de FIFA del mismo torneo tienen que poder
-- coexistir.
alter table public.matchdays drop constraint matchdays_season_id_number_key;
alter table public.matchdays add constraint matchdays_discipline_number unique (discipline_id, number);

drop index public.matchdays_by_season;
create index matchdays_by_discipline on public.matchdays (discipline_id, number);

-- `unique (id, season_id)` (0001_schema.sql:44) NO se toca: cuatro FK
-- compuestas ya dependen de ella (entries, attendances, pairs, awards).
-- Ancla nueva para cuando algo necesite una FK compuesta contra
-- (id, discipline_id) — todavía nada la usa, pero pair_size y allows_draw
-- (PR 13/20) sí la van a necesitar y es la misma tabla que ya se está
-- migrando acá.
alter table public.matchdays add constraint matchdays_discipline_anchor unique (id, discipline_id);

-- Análoga a `matchday_season` (0002_rls.sql:42): la necesitan las funciones
-- que en PR 4 dejan de filtrar por season_id y pasan a filtrar por
-- discipline_id (reopen_matchday, cancel_matchday).
create or replace function public.matchday_discipline(p_matchday uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select discipline_id from public.matchdays where id = p_matchday
$$;

revoke execute on function public.matchday_discipline(uuid) from public, anon;
grant  execute on function public.matchday_discipline(uuid) to authenticated;

-- ── create_masters, restateado para escribir discipline_id ──────────────────
-- `discipline_id` ahora es NOT NULL: sin este restatement, la fecha del
-- Masters violaría la columna en el mismo insert que 0007_write_screens.sql
-- ya tenía. `v_closed` y `v_number` pasan de contar por season_id a contar
-- por discipline_id, mismo motivo que `createMatchday` (db/matchday.ts): con
-- el tripwire de 0015 puesto da exactamente lo mismo, y queda listo para
-- cuando deje de serlo.
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

  select id into v_discipline from public.disciplines where season_id = p_season;
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
  -- frena crearlo con otra fecha sin cerrar. Los dos levantan 23505; el borde de
  -- TypeScript traduce ese código a un mensaje que se pueda leer.
  insert into public.matchdays (season_id, discipline_id, number, kind, played_on)
  values (p_season, v_discipline, v_number, 'MASTERS', p_played_on)
  returning id into v_new;

  return v_new;
end;
$$;

revoke execute on function public.create_masters(uuid, date) from public, anon;
grant  execute on function public.create_masters(uuid, date) to authenticated;
