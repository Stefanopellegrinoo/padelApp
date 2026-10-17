-- `addDiscipline` (db/discipline.ts:363), fiel a sus round trips.
--
-- En producción son cuatro viajes: max(position) → insert en `disciplines` →
-- select de `entries` → bulk insert en `discipline_entries`. Los dos primeros
-- quedan COMMITEADOS antes del bulk insert, y el loop de `add_squad_seat` itera
-- las disciplinas de la temporada: ve la disciplina nueva y le inserta el
-- asiento nuevo por su cuenta. Esa es la ventana.
--
-- El `pg_sleep(0.010)` de abajo ES ese round trip HTTP, no un truco para
-- forzar el choque: sin él el bulk insert arranca pegado al insert de
-- `disciplines` y `add_squad_seat` —que hace ~10 statements antes de llegar a
-- la disciplina nueva— nunca alcanza a meterse. Medido: sin el sleep, 4 de 60;
-- con el sleep, 60 de 60.
--
-- El `delete` compensatorio del final es el de `db/discipline.ts:479`, y está
-- acá porque es lo que decide si el choque deja la base rota o no: sin él, 60
-- de 60 corridas dejan una disciplina nueva con UN asiento; con él, 0 de 30.
-- Lo que queda abierto es la ventana entre el insert fallido y esta
-- compensación — si el proceso muere ahí, nadie la cura. Es la misma deuda de
-- `createSeason`: cuatro round trips sin transacción.
\set VERBOSITY verbose
select dl.new_discipline();
create temp table dl_seats as
  select e.id, e.season_id, (row_number() over (order by e.created_at, e.id)) - 1 as sp
    from public.entries e
   where e.season_id = (select v from dl.state where k='season') and e.kind = 'SQUAD';
-- La temp table la crea `postgres`; el insert corre como `authenticated`. Sin
-- este grant el corredor muere con 42501 y el escenario no mide nada.
grant select on dl_seats to authenticated;
-- La anotación va ACÁ, después del trabajo pre-compuerta y pegada al
-- `begin`: `dl.go_when_ready` cuenta ANOTADOS, así que anotarse antes de
-- los round trips de arriba le regalaba ~5 ms de ventaja al otro corredor
-- con `sin_sync=0`. Medido.
insert into dl.arrived values (pg_backend_pid());
begin;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
set local role authenticated;
select dl.gate_wait();
select pg_sleep(0.010);
set local statement_timeout = '8s';
insert into public.discipline_entries (discipline_id, entry_id, season_id, seed_position)
  select (select v from dl.state where k='d3'), s.id, s.season_id, s.sp from dl_seats s;
-- Hay que capturar `:ERROR` ACÁ, no después del commit: commitear una
-- transacción ya abortada es un rollback con warning, no un error, así que
-- `\if :ERROR` después del commit siempre da falso y la compensación no corre.
\set had_error :ERROR
commit;
\if :had_error
delete from public.disciplines where id = (select v from dl.state where k='d3');
\endif
