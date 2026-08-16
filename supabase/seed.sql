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

with season as (
  insert into public.seasons (name, config, invite_token, created_by)
  values (
    'Temporada demo',
    '{
      "squadSize": 8,
      "matchFormat": { "setsToWin": 1, "gamesPerSet": 4, "tieBreak": true },
      "points": [10, 6, 3, 1],
      "regularMatchdays": 10,
      "countBestOf": 8,
      "tiebreakSnapshotEvery": 3
    }'::jsonb,
    'demo',
    '00000000-0000-0000-0000-000000000001'
  )
  returning id, config
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
  select id, 'PADEL', config from season
  returning id
)
insert into public.entries (season_id, display_name, kind, seed_position)
select season.id, name, 'SQUAD', ord - 1
from season
cross join unnest(array[
  'Jugador 1', 'Jugador 2', 'Jugador 3', 'Jugador 4',
  'Jugador 5', 'Jugador 6', 'Jugador 7', 'Jugador 8'
]) with ordinality as t(name, ord);
