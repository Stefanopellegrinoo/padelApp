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

-- Gemelo de `discipline_entries` arriba, para `season_seed_order`
-- (0080_season_seed_order.sql): este seed corre DESPUÉS de las migraciones,
-- así que el backfill de 0080 nunca vio esta temporada — sin este insert, el
-- torneo demo queda con 8 SQUAD y CERO filas en season_seed_order, y
-- `seasonSeedOrder` (`db/read.ts`) los manda a todos al final por igual
-- (mismo síntoma que C7 tuvo con `discipline_entries` antes de la migración
-- de arriba).
--
-- Se lee de `discipline_entries`, no se recalcula: el `insert` de arriba ya
-- corrió (statement separado, los CTEs de `with season as (...)` de más
-- arriba no sobreviven fuera de ESE statement) y con una sola disciplina el
-- orden de temporada es exactamente el mismo número que ya quedó ahí. El
-- `invite_token = 'demo'` (fijo, arriba) es el único identificador que
-- sobrevive statement a statement sin volver a declarar el CTE entero.
--
-- WU6 (tanda 3, round 2 review fix): filtra ADEMÁS por `discipline_id` —la
-- ÚNICA de la temporada demo, resuelta con el mismo criterio "primaria" que
-- 0080_season_seed_order.sql (`order by position, created_at limit 1`)—, no
-- sólo por `season_id`. Sin el filtro de disciplina esto era correcto hoy
-- (una sola PADEL) pero un supuesto no verificado por ningún guard: el día
-- que este seed sume una segunda disciplina, `discipline_entries` tendría
-- DOS filas por `entry_id` (una por disciplina) y este `insert` las mandaría
-- las dos contra la misma clave `(season_id, entry_id)` de
-- `season_seed_order` — `db:reset` se caería con una violación de PK.
--
-- WU6 (tanda 5, round 3 review fix): esto copia SÓLO la parte "primaria" del
-- criterio de 0080 —el `left join` contra `discipline_entries` de la
-- primaria—, no las otras dos: no hay `tail` (`row_number()` para un SQUAD
-- que no juega la primaria) ni el `raise exception 'Backfill incompleto'`
-- que 0080 sí tiene. Hoy da lo mismo (la única disciplina de este seed es la
-- primaria, y el insert de `discipline_entries` de más arriba metió a los 8
-- SQUAD ahí) — el guard de abajo es lo que hace ese "hoy da lo mismo" una
-- garantía verificada y no un supuesto: el día que este seed sume una
-- segunda disciplina con solape parcial, un SQUAD que no juegue la primaria
-- quedaría sin fila acá, en silencio, y `db:reset` seguiría en verde sin
-- este chequeo.
insert into public.season_seed_order (season_id, entry_id, seed_position)
select de.season_id, de.entry_id, de.seed_position
  from public.discipline_entries de
 where de.season_id = (select id from public.seasons where invite_token = 'demo')
   and de.discipline_id = (
     select id from public.disciplines
      where season_id = (select id from public.seasons where invite_token = 'demo')
      order by position, created_at
      limit 1
   );

-- Mismo tripwire que 0080_season_seed_order.sql:97-103, escopeado a esta
-- única temporada: si el día de mañana este seed suma una disciplina y algún
-- SQUAD queda sin fila en `season_seed_order` (el caso que el comentario de
-- arriba documenta y que este insert no cubre), que `db:reset` se caiga
-- ACÁ, ruidoso, y no en la pantalla de Unirse del demo mostrando el plantel
-- incompleto.
do $$ declare v_want int; v_got int; v_season uuid; begin
  select id into v_season from public.seasons where invite_token = 'demo';
  select count(*) into v_want from public.entries where kind = 'SQUAD' and season_id = v_season;
  select count(*) into v_got  from public.season_seed_order where season_id = v_season;
  if v_want <> v_got then
    raise exception 'Backfill incompleto en supabase/seed.sql: % asientos SQUAD, % filas en season_seed_order. Este insert sólo copia la disciplina PRIMARIA -- si un SQUAD no la juega, hace falta el tail que 0080_season_seed_order.sql sí tiene.', v_want, v_got;
  end if;
end $$;
