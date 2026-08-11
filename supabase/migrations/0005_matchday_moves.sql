-- El estado de la fecha lo mueven las funciones y nadie más: la Task 6 revocó
-- `update (status)` a `authenticated` justamente para que un `PATCH` no pueda
-- saltear estos controles. Por eso `security definer`, y por eso arranca
-- preguntando si quien llama es el admin.

create or replace function public.open_matchday(p_matchday uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid;
  v_status text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede abrir una fecha.';
  end if;

  select status into v_status from public.matchdays where id = p_matchday for update;
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
end;
$$;

revoke execute on function public.open_matchday(uuid) from public, anon;
grant  execute on function public.open_matchday(uuid) to authenticated;

-- Cerrar una fecha: los awards y el estado, o nada. Una función es una
-- transacción implícita, que es lo que el cliente de Supabase no tiene.
create or replace function public.close_matchday(p_matchday uuid, p_awards jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid;
  v_status text;
  v_kind   text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede cerrar una fecha.';
  end if;

  select status, kind into v_status, v_kind
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
  end if;
end;
$$;

revoke execute on function public.close_matchday(uuid, jsonb) from public, anon;
grant  execute on function public.close_matchday(uuid, jsonb) to authenticated;

create or replace function public.reopen_matchday(p_matchday uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid;
  v_number int;
  v_status text;
  v_kind   text;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede reabrir una fecha.';
  end if;

  select number, status, kind into v_number, v_status, v_kind
    from public.matchdays where id = p_matchday for update;

  if v_status <> 'CLOSED' then
    raise exception 'Esta fecha no está cerrada.';
  end if;

  -- El error de carga se descubre justo cuando arrancás la fecha siguiente, y
  -- para entonces esa fecha suele ser una fila con un número y nada más. Si
  -- está vacía se borra sola: no hay nada que perder. Si ya tiene asistencias,
  -- invitados o parejas, no se toca y el exists de abajo frena la reapertura.
  delete from public.matchdays m
   where m.season_id = v_season
     and m.id <> p_matchday
     and m.status = 'DRAFT'
     and not exists (select 1 from public.pairs       x where x.matchday_id = m.id)
     and not exists (select 1 from public.attendances x where x.matchday_id = m.id)
     and not exists (select 1 from public.pair_locks  x where x.matchday_id = m.id)
     and not exists (select 1 from public.entries     x where x.matchday_id = m.id);

  if exists (
    select 1 from public.matchdays
     where season_id = v_season and status <> 'CLOSED' and id <> p_matchday
  ) then
    raise exception 'La fecha siguiente ya tiene datos cargados. Borrala vos antes de reabrir ésta.';
  end if;
  if exists (
    select 1 from public.matchdays
     where season_id = v_season and number > v_number and status = 'CLOSED'
  ) then
    raise exception 'Sólo se reabre la última fecha cerrada: las parejas de las que siguen salieron de esta tabla.';
  end if;

  delete from public.awards where matchday_id = p_matchday;
  update public.matchdays set status = 'OPEN', closed_at = null where id = p_matchday;

  -- Reabrir el Masters devuelve la temporada a en curso. Sin esto, el año
  -- quedaría FINISHED con su última jornada abierta.
  if v_kind = 'MASTERS' then
    update public.seasons set status = 'ACTIVE' where id = v_season;
  end if;
end;
$$;

revoke execute on function public.reopen_matchday(uuid) from public, anon;
grant  execute on function public.reopen_matchday(uuid) to authenticated;
