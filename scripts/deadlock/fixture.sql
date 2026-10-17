-- ── Fixture del gate de deadlocks ───────────────────────────────────────────
-- Todo lo que este harness crea vive en el esquema `dl` (salvo la temporada de
-- prueba, que tiene que estar en `public` para que las funciones reales la
-- vean). Se aplica sola: `battery.sh` la corre antes de cada tanda.
--
-- Por qué existe: los cambios de locking de esta base NO se validan leyendo
-- código. Tres rondas seguidas de revisión encontraron que el arreglo de la
-- ronda anterior creaba un deadlock nuevo, cada una en un lugar invisible
-- desde donde estaba mirando la anterior (ver 0081, 0084, 0085, 0086). Lo que
-- las encontró fueron dos sesiones psql concurrentes y números medidos, y esto
-- es eso, versionado.
create schema if not exists dl;

create table if not exists dl.state (k text primary key, v uuid);
create table if not exists dl.gate (open boolean not null);
create table if not exists dl.arrived (pid int primary key);
grant usage on schema dl to authenticated;
grant select on dl.state, dl.gate to authenticated;
grant insert, select on dl.arrived to authenticated;

-- ── La barrera de arranque ──────────────────────────────────────────────────
-- Sin esto, la ventana de carrera la decide el jitter de arranque de dos
-- procesos `psql` (~20 ms) contra statements que tardan ~2 ms: no se
-- encimarían casi nunca, y cada cero del harness sería un falso negativo.
--
-- Cada corredor se ANOTA en `dl.arrived` (transacción propia, ya commiteada) y
-- después espera en la compuerta; el controlador la abre cuando los dos están
-- adentro. La primera versión de esto raspaba `pg_stat_activity` en vez de
-- usar una tabla, y perdía hasta 35 de 60 sincronizaciones: iteraciones que no
-- medían NADA y se veían como resultados.
create or replace function dl.gate_wait() returns void language plpgsql as $$
declare v_open boolean;
begin
  for i in 1..20000 loop
    select open into v_open from dl.gate;
    if v_open then return; end if;
    perform pg_sleep(0.0005);
  end loop;
  raise exception 'gate timeout';
end $$;
grant execute on function dl.gate_wait() to authenticated;

-- Devuelve cuántos corredores había cuando abrió, o -1 si se cansó de
-- esperarlos. `run.sh` cuenta los -1 aparte: una tanda con muchos `sin_sync`
-- no midió lo que dice medir.
create or replace function dl.go_when_ready(p_n int default 2) returns int language plpgsql as $$
declare c int;
begin
  for i in 1..20000 loop
    select count(*) into c from dl.arrived;
    if c >= p_n then update dl.gate set open = true; return c; end if;
    perform pg_sleep(0.0005);
  end loop;
  update dl.gate set open = true;
  return -1;
end $$;

-- ── El fixture ──────────────────────────────────────────────────────────────
--   d1 = PADEL de a dos, 19 de los 20 asientos (le FALTA el último, `toadd`):
--        es donde `addToDiscipline` tiene algo que agregar y donde
--        `shift_seeds_up` corre la cola.
--   d2 = FIFA de a UNO, los 20. De a uno a propósito: `promote_guest` tiene un
--        guard de "¿cobró puntos el compañero?" que sólo corre con
--        `pair_size <> 1`, así que de a uno alcanza un invitado que jugó para
--        poder promoverlo.
--   before = asiento en seed_position 2. Como `p_before`, hace que el
--        corrimiento toque 17 filas de d1 y 18 de d2.
--   victim = asiento en seed_position 10, DENTRO del rango que el corrimiento
--        actualiza. Es el que sacan `removeSeat`/`removeFromDiscipline`.
--   guest  = invitado con nombre, en una fecha CLOSED de d2 y con su fila en
--        `pairs`: las tres cosas que `promote_guest` exige.
create or replace function dl.reset(p_squad int default 20) returns void language plpgsql as $$
declare
  v_season uuid; v_d1 uuid; v_d2 uuid; v_id uuid; v_md uuid; v_guest uuid;
  i int; v_cfg jsonb;
begin
  delete from public.seasons where name = 'DL-MEASURE';
  v_cfg := jsonb_build_object('squadSize', p_squad, 'points', jsonb_build_array(4, 3, 2, 1));

  insert into public.seasons (name, created_by)
  values ('DL-MEASURE', '00000000-0000-0000-0000-000000000001') returning id into v_season;

  insert into public.disciplines (season_id, kind, config, position)
  values (v_season, 'PADEL', v_cfg, 0) returning id into v_d1;
  insert into public.disciplines (season_id, kind, config, position, pair_size, has_masters)
  values (v_season, 'FIFA', v_cfg, 1, 1, false) returning id into v_d2;

  for i in 0..p_squad - 1 loop
    insert into public.entries (season_id, kind, display_name)
    values (v_season, 'SQUAD', 'J' || i) returning id into v_id;
    insert into public.season_seed_order (season_id, entry_id, seed_position)
    values (v_season, v_id, i);
    if i < p_squad - 1 then
      insert into public.discipline_entries (discipline_id, entry_id, season_id, seed_position)
      values (v_d1, v_id, v_season, i);
    end if;
    insert into public.discipline_entries (discipline_id, entry_id, season_id, seed_position)
    values (v_d2, v_id, v_season, i);
  end loop;

  insert into public.matchdays (season_id, number, kind, status, discipline_id, pair_size, played_on, closed_at)
  values (v_season, 1, 'REGULAR', 'CLOSED', v_d2, 1, current_date, now()) returning id into v_md;
  -- `seed_position` NO va nulo acá, al revés que en los SQUAD de arriba: el
  -- CHECK `entries_seed_shape` pide exactamente eso —GUEST con posición, SQUAD
  -- sin ella— y es lo que `promote_guest` invierte cuando promueve.
  insert into public.entries (season_id, kind, display_name, matchday_id, seed_position)
  values (v_season, 'GUEST', 'Invitado', v_md, 0) returning id into v_guest;
  insert into public.pairs (matchday_id, season_id, entry_a, entry_b, pair_size)
  values (v_md, v_season, v_guest, null, 1);

  delete from dl.state;
  insert into dl.state (k, v) values
    ('season', v_season), ('d1', v_d1), ('d2', v_d2), ('guest', v_guest),
    ('before', (select entry_id from public.season_seed_order where season_id = v_season and seed_position = 2)),
    ('victim', (select entry_id from public.season_seed_order where season_id = v_season and seed_position = 10)),
    ('toadd',  (select entry_id from public.season_seed_order where season_id = v_season and seed_position = p_squad - 1));

  delete from dl.gate; insert into dl.gate (open) values (false);
  delete from dl.arrived;
end $$;

-- `addDiscipline` (db/discipline.ts) son 4 round trips: max(position) → insert
-- en `disciplines` → select de `entries` → bulk insert en `discipline_entries`.
-- La fila de `disciplines` queda COMMITEADA antes del bulk insert, y el loop de
-- `add_squad_seat` itera las disciplinas de la temporada: ve la nueva y le
-- inserta el asiento nuevo por su cuenta. Esta función es ese primer round
-- trip.
create or replace function dl.new_discipline() returns uuid language plpgsql security definer as $$
declare v uuid;
begin
  insert into public.disciplines (season_id, kind, config, position, pair_size, has_masters)
  select s.v, 'PADEL', jsonb_build_object('squadSize', 20, 'points', jsonb_build_array(4, 3, 2, 1)), 2, 2, false
    from dl.state s where s.k = 'season' returning id into v;
  delete from dl.state where k = 'd3';
  insert into dl.state (k, v) values ('d3', v);
  return v;
end $$;
grant execute on function dl.new_discipline() to authenticated;

-- ── El invariante ───────────────────────────────────────────────────────────
-- NO es "toda disciplina tiene a todo el plantel": un asiento puede
-- legítimamente no jugar una disciplina, y `removeSeat` deja huecos en
-- `seed_position` a propósito (0023). Escribirlo así daba 60 de 60 falsos
-- positivos. Sólo dos cosas tienen que valer siempre:
--   1. si `add_squad_seat` creó el asiento 'Nuevo', tiene fila en TODAS las
--      disciplinas de la temporada — es lo que la función promete;
--   2. si `addDiscipline` creó d3, nace con TODO el plantel: un SQUAD sin fila
--      ahí es el huérfano que vigila `db/discipline.db.test.ts`.
--
-- Y una tercera que vale para TODAS las filas de la batería, no sólo para las
-- que crean algo: cada asiento SQUAD de la temporada tiene exactamente una
-- fila en `season_seed_order`, y ninguna fila de esa tabla sobrevive sin su
-- asiento. Es el invariante de toda la línea 0080-0086 y lo que
-- `db/season-seed-order-writers.db.test.ts` custodia desde el otro lado. Sin
-- esto, la columna ESTADO era una CONSTANTE cero en 6 de los 14 pares de
-- entonces: los que
-- no crean ni `'Nuevo'` ni `d3` no tenían nada que chequear y la fila igual
-- imprimía `ESTADO=0`, que se lee como "estado verificado limpio" habiendo
-- verificado nada. Fixture degenerado, la misma clase que la permutación
-- identidad que no distingue `at` de `index`.
create or replace function dl.inconsistent() returns text language plpgsql as $$
declare v_season uuid; v_new uuid; v_d3 uuid; n int; m int; out text := '';
begin
  select v into v_season from dl.state where k = 'season';
  if not exists (select 1 from public.seasons where id = v_season) then return ''; end if;

  select count(*) into n from public.entries e
   where e.season_id = v_season and e.kind = 'SQUAD'
     and not exists (select 1 from public.season_seed_order sso
                      where sso.season_id = v_season and sso.entry_id = e.id);
  if n > 0 then out := out || format('%s asiento(s) SQUAD sin fila en season_seed_order; ', n); end if;

  select count(*) into m from public.season_seed_order sso
   where sso.season_id = v_season
     and not exists (select 1 from public.entries e
                      where e.id = sso.entry_id and e.kind = 'SQUAD');
  if m > 0 then out := out || format('%s fila(s) de season_seed_order sin asiento; ', m); end if;

  select id into v_new from public.entries
   where season_id = v_season and kind = 'SQUAD' and display_name = 'Nuevo' limit 1;
  if v_new is not null then
    select count(*) into n from public.disciplines d
     where d.season_id = v_season
       and not exists (select 1 from public.discipline_entries de
                        where de.discipline_id = d.id and de.entry_id = v_new);
    if n > 0 then out := out || format('asiento nuevo SIN fila en %s disciplina(s); ', n); end if;
  end if;

  select v into v_d3 from dl.state where k = 'd3';
  if v_d3 is not null and exists (select 1 from public.disciplines where id = v_d3)
     and exists (select 1 from public.discipline_entries where discipline_id = v_d3) then
    select count(*) into n from public.entries e
     where e.season_id = v_season and e.kind = 'SQUAD'
       and not exists (select 1 from public.discipline_entries de
                        where de.discipline_id = v_d3 and de.entry_id = e.id);
    if n > 0 then out := out || format('disciplina nueva SIN %s asiento(s) del plantel; ', n); end if;
  end if;
  return out;
end $$;
