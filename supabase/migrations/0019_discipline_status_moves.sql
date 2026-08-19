-- ── disciplines.status empieza a moverse ────────────────────────────────────
-- El backfill de 0015:36 y el trinquete de vuelta de cancel_matchday
-- (0018:153) ya escribían esta columna; hasta acá, ningún camino de
-- open/close/reopen la tocaba, así que quedaba fija en SETUP para siempre.
-- Medido tras 0018 sobre un reset limpio: 81 de 201 disciplinas
--Desincronizadas de su propia temporada (ver, hallazgo C1).
-- Esta migración restatea `open_matchday`, `close_matchday` y
-- `reopen_matchday` para que cada una escriba `disciplines.status` con el
-- MISMO trinquete que ya usa para `seasons.status`, sólo que scopeado por
-- `discipline_id` en vez de `season_id` — mismo movimiento que 0018 hizo con
-- cancel_matchday.
--
-- ── Decisión de numeración ───────────────────────────────────────────────
-- El diseño asignaba esto a `0017` (mapa de migraciones: "0017 (PR3
-- status)"). No se puede: `0018` (rama pr04-reopen-cancel-scoped, commit
-- f3d520d) ya está commiteada, y esta corrida tiene explícitamente prohibido
-- reescribir esa historia. Insertar un `0017` nuevo hoy aterrizaría FUERA DE
-- ORDEN sobre una base que ya corrió `0018` — exactamente la trampa que
--Anotaba S1 del: el CLI de Supabase aplica y trackea por
-- versión en `supabase_migrations.schema_migrations`, y una migración
-- insertada retroactivamente por debajo de la última aplicada puede terminar
-- salteada o aplicada en un orden que nadie probó contra datos reales.
-- Se numera `0019` (el siguiente hueco real de la secuencia) y `0017` queda
-- documentado como vacío deliberado, no relleno — el mapa de migraciones del
-- diseño necesita esa nota la próxima vez que se lo actualice.

create or replace function public.open_matchday(p_matchday uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season     uuid;
  v_discipline uuid;
  v_status     text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede abrir una fecha.';
  end if;

  select discipline_id, status into v_discipline, v_status
    from public.matchdays where id = p_matchday for update;
  if v_status <> 'DRAFT' then
    raise exception 'Esta fecha ya no está en armado.';
  end if;

  if not exists (select 1 from public.pairs where matchday_id = p_matchday) then
    raise exception 'Generá las parejas antes de abrir la fecha.';
  end if;

  update public.matchdays set status = 'OPEN' where id = p_matchday;

  -- La temporada arranca cuando se abre su primera fecha. Es el único lugar
  -- donde SETUP puede pasar a ACTIVE, así que la columna no queda muerta.
  update public.seasons set status = 'ACTIVE' where id = v_season and status = 'SETUP';

  -- El mismo trinquete, a nivel disciplina: su propio calendario es el que
  -- arranca, no el de sus hermanas.
  update public.disciplines set status = 'ACTIVE' where id = v_discipline and status = 'SETUP';
end;
$$;

revoke execute on function public.open_matchday(uuid) from public, anon;
grant  execute on function public.open_matchday(uuid) to authenticated;

-- ── close_matchday (restatement de 0005_matchday_moves.sql:46-129) ─────────
-- Único cambio real: se lee `discipline_id` en el mismo `select ... for
-- update` que ya traía `status, kind`, y el Masters —que hoy termina el
-- AÑO— también termina la disciplina que lo jugó.
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
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede cerrar una fecha.';
  end if;

  select discipline_id, status, kind into v_discipline, v_status, v_kind
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
  -- pareja de la fecha que se está cerrando.
  if exists (
    select 1
      from jsonb_array_elements(p_awards) as award
     where (award ->> 'entryId')::uuid not in (
       select entry_a from public.pairs where matchday_id = p_matchday
       union
       select entry_b from public.pairs where matchday_id = p_matchday
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
  ) then
    raise exception 'Faltan resultados por cargar.';
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

-- ── reopen_matchday (restatement de 0018_reopen_cancel_scoped.sql) ─────────
--El scoping por discipline_id de las tres consultas (REQ-D4-1) ya lo dejó
-- 0018 — eso no se toca. Lo único que agrega esta migración es el trinquete
-- que faltaba: reabrir el Masters revierte disciplines.status a ACTIVE,
-- gemelo del que ya existe para seasons.status (0005:190-193), scopeado por
-- discipline_id igual que el resto de este archivo.
create or replace function public.reopen_matchday(p_matchday uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season     uuid;
  v_discipline uuid;
  v_number     int;
  v_status     text;
  v_kind       text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede reabrir una fecha.';
  end if;

  select discipline_id, number, status, kind into v_discipline, v_number, v_status, v_kind
    from public.matchdays where id = p_matchday for update;

  if v_status <> 'CLOSED' then
    raise exception 'Esta fecha no está cerrada.';
  end if;

  -- El error de carga se descubre justo cuando arrancás la fecha siguiente, y
  -- para entonces esa fecha suele ser una fila con un número y nada más. Si
  -- está vacía se borra sola: no hay nada que perder. Si ya tiene asistencias,
  -- invitados o parejas, no se toca y el exists de abajo frena la reapertura.
  delete from public.matchdays m
   where m.discipline_id = v_discipline
     and m.id <> p_matchday
     and m.status = 'DRAFT'
     and not exists (select 1 from public.pairs       x where x.matchday_id = m.id)
     and not exists (select 1 from public.attendances x where x.matchday_id = m.id)
     and not exists (select 1 from public.pair_locks  x where x.matchday_id = m.id)
     and not exists (select 1 from public.entries     x where x.matchday_id = m.id);

  if exists (
    select 1 from public.matchdays
     where discipline_id = v_discipline and status <> 'CLOSED' and id <> p_matchday
  ) then
    raise exception 'La fecha siguiente ya tiene datos cargados. Borrala vos antes de reabrir ésta.';
  end if;
  if exists (
    select 1 from public.matchdays
     where discipline_id = v_discipline and number > v_number and status = 'CLOSED'
  ) then
    raise exception 'Sólo se reabre la última fecha cerrada: las parejas de las que siguen salieron de esta tabla.';
  end if;

  delete from public.awards where matchday_id = p_matchday;
  update public.matchdays set status = 'OPEN', closed_at = null where id = p_matchday;

  -- Reabrir el Masters devuelve la temporada a en curso. Sin esto, el año
  -- quedaría FINISHED con su última jornada abierta.
  if v_kind = 'MASTERS' then
    update public.seasons set status = 'ACTIVE' where id = v_season;

    -- El mismo trinquete, a nivel disciplina.
    update public.disciplines set status = 'ACTIVE' where id = v_discipline;
  end if;
end;
$$;

revoke execute on function public.reopen_matchday(uuid) from public, anon;
grant  execute on function public.reopen_matchday(uuid) to authenticated;
