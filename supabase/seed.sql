-- Temporada de demo para poder mirar la app con datos reales: un admin en
-- auth.users, una season con la config por defecto de 8, y ocho entries
-- SQUAD sin reclamar para que la pantalla de Unirse tenga qué mostrar.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'admin@demo.com',
  crypt('demodemo', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(), now(), '', '', '', ''
);

-- Sin `seasons.config` (C35): la columna ya no tiene lector ni escritor de
-- producción —`createSeason` dejó de escribirla— y el CONTRACT la dropea. La
-- config REAL vive en `disciplines.config` desde PR 5, así que el jsonb se
-- declara UNA vez, en la disciplina, y `seasons` no lo ve pasar.
--
-- Este seed era el ÚLTIMO escritor vivo de esa columna, y no estaba en ninguna
-- lista: apareció recién aplicando el CONTRACT entero a la base local y
-- corriendo la suite encima (patrón #4036). Corre DESPUÉS de las migraciones,
-- así que el `drop column` lo habría roto y con él todo `db:reset`.
with season as (
  insert into public.seasons (name, invite_token, created_by)
  values (
    'Temporada demo',
    'demo',
    '00000000-0000-0000-0000-000000000001'
  )
  returning id
),
-- Toda temporada necesita su disciplina de arranque (0015_disciplines.sql):
-- sin esto, `createMatchday` no puede resolver un `discipline_id` y crear
-- una fecha en el torneo demo rompe con PGRST116 apenas se resetea la base
-- (REQ-NR-4, hallazgo C3 del verify-report).
--
-- Sin `cross join` a propósito (N6, verify-report ronda 2): un CTE de
-- escritura se ejecuta exactamente una vez y hasta el final SIEMPRE, se lea
-- o no desde otro lado del `with` — comportamiento documentado de Postgres,
-- no algo que haya que forzar con una referencia. `cross join discipline`
-- era además un footgun: multiplica el insert de `entries` por la cantidad
-- de filas de `discipline`, así que el día que este seed reparta más de una
-- disciplina, los 8 entries se duplican por cada una (8 → 16 con dos).
discipline as (
  insert into public.disciplines (season_id, kind, config)
  select id, 'PADEL', '{
    "squadSize": 8,
    "matchFormat": { "setsToWin": 1, "gamesPerSet": 4, "tieBreak": true, "openScore": false },
    "points": [10, 6, 3, 1],
    "regularMatchdays": 10,
    "countBestOf": 8,
    "tiebreakSnapshotEvery": 3
  }'::jsonb
  from season
  returning id
),
entries as (
  -- Sin `seed_position` (C37): el CHECK `entries_seed_shape` del CONTRACT lo
  -- prohíbe para el SQUAD. El orden del plantel vive en `discipline_entries`,
  -- el insert del final.
  insert into public.entries (season_id, display_name, kind)
  select season.id, name, 'SQUAD'
  from season
  cross join unnest(array[
    'Jugador 1', 'Jugador 2', 'Jugador 3', 'Jugador 4',
    'Jugador 5', 'Jugador 6', 'Jugador 7', 'Jugador 8'
  ]) with ordinality as t(name, ord)
  returning id, display_name
)
-- Cada asiento SQUAD entra también a la disciplina (0023_discipline_entries.sql,
-- mismo backfill que `db/season.ts createSeason`): sin esto el torneo demo
-- nace con 8 entries y CERO discipline_entries, y `setAttendance` rebota con
-- 23503 apenas se intenta marcar presente (C7, verify-report ronda 3 —
-- tercera vez que este seed queda mal, ver también C3 de la ronda 1). A
-- diferencia del `cross join discipline` de la query de arriba (que SÍ sería
-- un footgun ahí, ver el comentario de N6), acá el cross join es lo que se
-- quiere: cada entry entra a la ÚNICA disciplina de esta temporada, exacto lo
-- mismo que hace `createSeason` para un torneo nuevo con una sola disciplina.
insert into public.discipline_entries (discipline_id, entry_id, season_id, seed_position)
-- El orden sale del NÚMERO del nombre y ya no de `entries.seed_position`
-- (C37). Los nombres los escribe este mismo seed tres CTEs más arriba
-- ('Jugador 1'..'Jugador 8'), así que el número está garantizado — y
-- `returning` no puede devolver el `ord` del `unnest`, que no es columna.
select discipline.id, entries.id, season.id,
       (substring(entries.display_name from '\d+'))::int - 1
from discipline
cross join entries
cross join season;
