\set VERBOSITY verbose
insert into dl.arrived values (pg_backend_pid());
begin;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
set local role authenticated;
select dl.gate_wait();
set local statement_timeout = '8s';
delete from public.seasons where id = (select v from dl.state where k='season');
commit;
