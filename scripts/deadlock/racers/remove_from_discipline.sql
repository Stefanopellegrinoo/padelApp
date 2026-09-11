\set VERBOSITY verbose
insert into dl.arrived values (pg_backend_pid());
begin;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
set local role authenticated;
select dl.gate_wait();
set local statement_timeout = '8s';
delete from public.discipline_entries where discipline_id = (select v from dl.state where k='d1') and entry_id = (select v from dl.state where k='victim') and season_id = (select v from dl.state where k='season');
commit;
