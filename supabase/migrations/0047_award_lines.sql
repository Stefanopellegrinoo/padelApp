-- PR 23 (torneo-multi-disciplina, REQ-D10-1/REQ-D10-2, design #3801 PUNTO 8) ──
--
-- `awards.points` es un TOTAL desde 0001 (0001_schema.sql:206-226): no dice
-- POR QUÉ una fila suma lo que suma. Hoy hay una sola fuente (la posición del
-- día), así que el desglose es una línea nada más -- pero el día que haya una
-- segunda fuente de puntos, el histórico ya tiene la forma que hace falta.
--
-- FK a `awards (matchday_id, entry_id)` y no a `awards.id` (decisión #14,
-- design): ese `unique` YA existe (0001_schema.sql:220), cero índices nuevos,
-- y el `cascade` hace que `reopen_matchday` (0005_matchday_moves.sql) se
-- lleve las líneas SOLO -- el `delete from awards` que esa función ya hace
-- alcanza, sin tocarla.
create table public.award_lines (
  id          uuid primary key default gen_random_uuid(),
  matchday_id uuid not null,
  entry_id    uuid not null,
  ordinal     int  not null check (ordinal >= 0),
  reason      text not null check (length(trim(reason)) > 0),
  -- >= 0 y no > 0: igual criterio que `awards.points` desde 0010
  -- (0010_points_can_be_zero.sql) -- una línea puede sumar 0 y seguir siendo
  -- información ("bonus: 0").
  points      int  not null check (points >= 0),
  unique (matchday_id, entry_id, ordinal),
  foreign key (matchday_id, entry_id) references public.awards (matchday_id, entry_id) on delete cascade
);
create index award_lines_by_matchday on public.award_lines (matchday_id);

-- Mismo gotcha que `disciplines` (0015_disciplines.sql:48-52) y
-- `discipline_entries` (0023_discipline_entries.sql:51-55), tercera vez en
-- esta cadena: tabla nueva creada después del grant blanket de
-- 0002_rls.sql, así que ese grant no la alcanzó. Sin esto, tanto
-- `authenticated` como `service_role` reciben "permission denied for table
-- award_lines".
grant select, insert, update, delete on public.award_lines to authenticated, service_role;
revoke all on public.award_lines from anon;

alter table public.award_lines enable row level security;
create policy award_lines_read on public.award_lines
  for select to authenticated using (public.is_participant(public.matchday_season(matchday_id)));

-- Nadie escribe acá directo: sólo `close_matchday` (más abajo), que corre
-- `security definer` con el rol dueño de la función y no necesita el grant
-- de arriba para insertar. `authenticated` se queda con SELECT nada más.
revoke insert, update, delete on public.award_lines from authenticated, anon;

-- ── close_matchday (restatement de 0044_close_matchday_third_place_scoped_to_bracket.sql) ─
-- Restatement de la ÚLTIMA versión, no de 0041 ni de ninguna anterior: 0044
-- es la que tiene la rendija del TERCER_PUESTO acotada a `GROUPS_KNOCKOUT`
-- (C31), y esta función es la única que define `close_matchday` en toda la
-- cadena de migraciones (verificado: `rg '^create( or replace)? function|^drop
-- function' 0044_*.sql` da una sola función, así que copiar el archivo
-- entero no revierte nada de otra función en silencio -- la trampa de 0025).
--
-- Dos agregados sobre 0044, el resto BYTE A BYTE igual:
-- 1. El guard de suma (acá abajo, "El desglose no suma el total del
--    premio."), ANTES del insert de awards. No es declarativo -- cruza
--    `p_awards.points` contra la suma de `p_awards.lines[].points` -- así
--    que no hay forma de expresarlo como CHECK de una sola tabla (decisión
--    #15, design).
-- 2. El insert en `award_lines`, DESPUÉS del insert en `awards` (la FK
--    compuesta lo exige: la fila de `awards` tiene que existir primero).
--
-- `coalesce(award -> 'lines', '[]'::jsonb)`: un caller que no manda `lines`
-- -- cualquier RPC directo escrito antes de este archivo -- no revienta con
-- un jsonb null, cae en el guard de arriba (0 != el total, salvo que el
-- total también sea 0) o pasa con cero líneas si el total es 0. No hay forma
-- de cerrar SILENCIOSAMENTE sin desglosar: si tiene puntos, tiene que traer
-- líneas que sumen igual.
create or replace function public.close_matchday(p_matchday uuid, p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season     uuid;
  v_discipline uuid;
  v_status     text;
  v_kind       text;
  v_formato    jsonb;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede cerrar una fecha.';
  end if;

  select discipline_id, status, kind, formato into v_discipline, v_status, v_kind, v_formato
    from public.matchdays where id = p_matchday for update;

  if v_status <> 'OPEN' then
    raise exception 'Sólo se cierra una fecha que está en juego.';
  end if;

  -- Sin esto, un `p_awards` en null cierra la fecha sin repartir un solo punto
  -- y sin decir nada: `jsonb_array_length(null)` da null, el `if` de abajo no
  -- dispara, y `jsonb_array_elements(null)` no devuelve filas. La función la
  -- puede llamar cualquier admin por RPC, así que el payload se valida.
  if p_awards is null or jsonb_typeof(p_awards) <> 'array' then
    raise exception 'La lista de puntos llegó mal formada.';
  end if;

  -- El payload lo arma quien llama, y `p_awards` puede nombrar a cualquiera:
  -- sin este control, un admin paga puntos a un jugador que ni jugó esta
  -- fecha (o a cualquier uuid inventado). Sólo entra quien está en alguna
  -- pareja de la fecha que se está cerrando. `not exists` correlacionado,
  --No `not in` sobre un `union`: ver comentario de cabecera.
  if exists (
    select 1
      from jsonb_array_elements(p_awards) as award
     where not exists (
       select 1
         from public.pairs p
        where p.matchday_id = p_matchday
          and (award ->> 'entryId')::uuid in (p.entry_a, p.entry_b)
     )
  ) then
    raise exception 'Hay puntos para alguien que no jugó esta fecha.';
  end if;

  -- El Masters no paga puntos: define al campeón del año (spec 2.7). Se cierra
  -- con la lista vacía y el campeón se deriva de los partidos, como todo.
  if v_kind = 'MASTERS' and jsonb_array_length(p_awards) > 0 then
    raise exception 'El Masters no reparte puntos.';
  end if;

  if exists (
    select 1
      from public.matches m
     where m.matchday_id = p_matchday
       and not exists (select 1 from public.match_sets s where s.match_id = m.id)
       -- La rendija (C31, ver comentario de cabecera): TERCER_PUESTO queda
       -- afuera de este chequeo SÓLO si la fecha sigue siendo la llave que
       -- lo generó (`formato.kind = 'GROUPS_KNOCKOUT'`). Con `ROUND_ROBIN`
       -- —incluida una fecha que LLEGÓ ahí después de tener una llave— no
       -- hay excepción: cualquier otra fase, y siempre en el pádel, sigue
       -- exigiendo resultado como hoy.
       and not (m.fase = 'TERCER_PUESTO' and v_formato ->> 'kind' = 'GROUPS_KNOCKOUT')
  ) then
    raise exception 'Faltan resultados por cargar.';
  end if;

  -- REQ-D10-1 (design #3801, decisión #15): el desglose de cada award tiene
  -- que sumar el total, o el histórico miente desde el día uno. Cruza dos
  -- "tablas" (el total de `award` y la suma de sus `lines`), así que no hay
  -- forma declarativa (CHECK de una sola fila) de expresarlo -- va acá, el
  -- único escritor de `awards`/`award_lines`.
  if exists (
    select 1
      from jsonb_array_elements(p_awards) as award
     where (award ->> 'points')::int is distinct from (
       select coalesce(sum((line ->> 'points')::int), 0)
         from jsonb_array_elements(coalesce(award -> 'lines', '[]'::jsonb)) as line
     )
  ) then
    raise exception 'El desglose no suma el total del premio.';
  end if;

  -- `season_id` no está en el bloque original del plan: la tabla lo exige
  -- (FK compuesta a `entries` y a `matchdays`) desde que el esquema se
  -- amplió después de escribirlo. Sin él, todo insert de awards falla.
  insert into public.awards (matchday_id, entry_id, season_id, position, points)
  select p_matchday,
         (award ->> 'entryId')::uuid,
         v_season,
         (award ->> 'position')::int,
         (award ->> 'points')::int
    from jsonb_array_elements(p_awards) as award;

  -- REQ-D10-1: una fila por línea del desglose, con el `ordinal` que le dio
  -- `with ordinality` (1-based) corrido a 0-based -- coherente con el
  -- `check (ordinal >= 0)` de la tabla.
  insert into public.award_lines (matchday_id, entry_id, ordinal, reason, points)
  select p_matchday, (award ->> 'entryId')::uuid, (line.ord - 1)::int,
         line.value ->> 'reason', (line.value ->> 'points')::int
    from jsonb_array_elements(p_awards) as award,
         lateral jsonb_array_elements(coalesce(award -> 'lines', '[]'::jsonb)) with ordinality as line(value, ord);

  update public.matchdays set status = 'CLOSED', closed_at = now() where id = p_matchday;

  -- El año se termina cuando se cierra el Masters, y en ningún otro momento.
  if v_kind = 'MASTERS' then
    update public.seasons set status = 'FINISHED' where id = v_season;

    -- El mismo trinquete, a nivel disciplina: es SU Masters el que terminó.
    update public.disciplines set status = 'FINISHED' where id = v_discipline;
  end if;
end;
$$;

revoke execute on function public.close_matchday(uuid, jsonb) from public, anon;
grant  execute on function public.close_matchday(uuid, jsonb) to authenticated;
