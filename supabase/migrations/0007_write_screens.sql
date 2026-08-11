-- Las tres cosas que las pantallas de escritura necesitan de la base y que la
-- base todavía no daba. Las tres son `security definer` por el mismo motivo que
-- las de 0005: lo que controlan no se puede expresar como política de RLS sin
-- partirlo en varios lugares.

-- ── el jugador marca su propia asistencia ────────────────────────────────────
-- `attendances_write` (0002_rls.sql) pide `is_season_admin`, así que hoy un
-- jugador no puede tocar ni su propia fila — y el toggle "No voy" de la Tabla es
-- exactamente eso. El chequeo de "la fila es la tuya" vive ACÁ adentro y no en
-- la pantalla: si viviera en la pantalla, cualquiera con la consola abierta
-- marcaría ausente a otro.
create or replace function public.set_my_attendance(p_matchday uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season uuid;
  v_entry  uuid;
begin
  if p_status not in ('PLAYING', 'ABSENT') then
    raise exception 'El presentismo sólo puede ser PLAYING o ABSENT.';
  end if;

  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;

  -- Mismo criterio que `setAttendance` en db/matchday.ts: una vez armadas las
  -- parejas, desanotarse deja la fecha con más parejas que jugadores y no hay
  -- forma de arreglarla sin rearmar todo.
  if not exists (
    select 1 from public.matchdays where id = p_matchday and status = 'DRAFT'
  ) then
    raise exception 'La fecha ya está armada: hablá con quien organiza.';
  end if;

  -- El índice `entries_one_seat` garantiza a lo sumo un asiento por
  -- (temporada, player), así que este select nunca puede devolver dos filas.
  select e.id into v_entry
    from public.entries e
    join public.players p on p.id = e.player_id
   where e.season_id = v_season
     and e.kind = 'SQUAD'
     and p.user_id = (select auth.uid());

  if v_entry is null then
    raise exception 'No tenés lugar en esta temporada.';
  end if;

  insert into public.attendances (matchday_id, entry_id, season_id, status)
  values (p_matchday, v_entry, v_season, p_status)
  on conflict (matchday_id, entry_id) do update set status = excluded.status;
end;
$$;

revoke execute on function public.set_my_attendance(uuid, text) from public, anon;
grant  execute on function public.set_my_attendance(uuid, text) to authenticated;

-- ── crear el Masters ─────────────────────────────────────────────────────────
-- `kind` NO está en el grant de columnas de matchdays (0002_rls.sql otorga sólo
-- season_id, number y played_on), así que ningún insert desde el cliente puede
-- crear una fecha MASTERS. Hace falta esta función, y de paso es el lugar donde
-- viven las condiciones para que el Masters exista.
create or replace function public.create_masters(p_season uuid, p_played_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_regular int;
  v_closed  int;
  v_number  int;
  v_new     uuid;
begin
  if not public.is_season_admin(p_season) then
    raise exception 'Sólo quien organiza la temporada puede armar el Masters.';
  end if;

  select (config ->> 'regularMatchdays')::int into v_regular
    from public.seasons where id = p_season;
  if v_regular is null then
    raise exception 'La temporada no existe.';
  end if;

  select count(*) into v_closed
    from public.matchdays
   where season_id = p_season and kind = 'REGULAR' and status = 'CLOSED';

  if v_closed < v_regular then
    raise exception 'El Masters se juega al terminar las % fechas: faltan %.',
      v_regular, v_regular - v_closed;
  end if;

  select coalesce(max(number), 0) + 1 into v_number
    from public.matchdays where season_id = p_season;

  -- `matchdays_one_masters` frena el segundo Masters y `matchdays_one_live`
  -- frena crearlo con otra fecha sin cerrar. Los dos levantan 23505; el borde de
  -- TypeScript traduce ese código a un mensaje que se pueda leer.
  insert into public.matchdays (season_id, number, kind, played_on)
  values (p_season, v_number, 'MASTERS', p_played_on)
  returning id into v_new;

  return v_new;
end;
$$;

revoke execute on function public.create_masters(uuid, date) from public, anon;
grant  execute on function public.create_masters(uuid, date) to authenticated;

-- ── las reglas, sin cuenta ───────────────────────────────────────────────────
-- La página de reglas es el link que se pega en el grupo y se ve SIN cuenta
-- (spec 2.8). `anon` no tiene select en ninguna tabla, a propósito (0002_rls.sql
-- lo deja explícitamente afuera), así que ésta es la ÚNICA superficie pública de
-- toda la app.
--
-- Devuelve exactamente cinco campos y ninguno dice quién juega: nada de plantel,
-- nada de asistencias, nada de resultados, nada de puntos. Agregar una columna
-- acá es agrandar la superficie pública de la app entera.
create or replace function public.season_public_rules(p_season uuid)
returns table (
  name             text,
  config           jsonb,
  rules_text       text,
  rules_updated_at timestamptz,
  admin_name       text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name,
         s.config,
         s.rules_text,
         s.rules_updated_at,
         coalesce(p.display_name, '')
    from public.seasons s
    left join public.players p on p.user_id = s.created_by
   where s.id = p_season
$$;

revoke execute on function public.season_public_rules(uuid) from public;
grant  execute on function public.season_public_rules(uuid) to anon, authenticated;
