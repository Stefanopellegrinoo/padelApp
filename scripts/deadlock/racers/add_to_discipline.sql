\set VERBOSITY verbose
select coalesce(max(seed_position), -1) + 1 as nextseed from public.discipline_entries where discipline_id = (select v from dl.state where k='d1') \gset
-- La anotación va ACÁ, después del trabajo pre-compuerta y pegada al
-- `begin`: `dl.go_when_ready` cuenta ANOTADOS, así que anotarse antes de
-- los round trips de arriba le regalaba ~5 ms de ventaja al otro corredor
-- con `sin_sync=0`. Medido.
insert into dl.arrived values (pg_backend_pid());
begin;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
set local role authenticated;
select dl.gate_wait();
set local statement_timeout = '8s';
insert into public.discipline_entries (discipline_id, entry_id, season_id, seed_position) values ((select v from dl.state where k='d1'), (select v from dl.state where k='toadd'), (select v from dl.state where k='season'), :nextseed);
commit;
