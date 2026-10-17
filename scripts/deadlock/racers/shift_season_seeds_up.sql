-- `shift_season_seeds_up` (0080): la gemela a nivel TEMPORADA de
-- `shift_seeds_up`, y la que ESTA feature introdujo. Corre como `postgres`
-- porque su ACL es `postgres=X/postgres` — no es alcanzable desde la app, y sus
-- únicos callers (`add_squad_seat`, `promote_guest`) toman el advisory antes.
-- Igual que su gemela, está acá como CONTROL POSITIVO: contra una baja de
-- asiento deadlockea, y eso prueba que el harness sigue sabiendo encontrar un
-- ciclo. Sin esta fila, la tabla nueva de la feature era la única sin control.
\set VERBOSITY verbose
insert into dl.arrived values (pg_backend_pid());
begin;
select dl.gate_wait();
set local statement_timeout = '8s';
select public.shift_season_seeds_up((select v from dl.state where k='season'), 2);
commit;
