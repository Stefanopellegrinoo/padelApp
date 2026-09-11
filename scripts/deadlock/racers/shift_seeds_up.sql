\set VERBOSITY verbose
insert into dl.arrived values (pg_backend_pid());
begin;
select dl.gate_wait();
set local statement_timeout = '8s';
select public.shift_seeds_up((select v from dl.state where k='d1'), 2);
commit;
