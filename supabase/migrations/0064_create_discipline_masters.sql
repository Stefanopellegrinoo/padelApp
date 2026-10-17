-- ── Cada disciplina juega su propio Masters (C36, decisión #4035) ──────────
--
-- `verify-report-go-no-go` (#4034) midió que un torneo de DOS disciplinas de
-- a dos —el DEFAULT del wizard, `pairSizes = {PADEL: 2, FIFA: 2}`— NO PODÍA
-- TERMINAR NUNCA:
--
--   * las dos nacen `has_masters = true`, así que su único camino a FINISHED
--     es cerrar un Masters (el `elsif REGULAR` de `0056` exige
--     `not v_has_masters`);
--   * `create_masters` resolvía la disciplina ella misma, con
--     `order by position, created_at limit 1` — o sea SIEMPRE la primaria, y
--     nunca recibía quién se lo pidió;
--   * el segundo llamado rebotaba contra `matchdays_one_masters` con "Ya hay
--     un Masters…", y la segunda disciplina quedaba ACTIVE para siempre. Con
--     ella, la temporada: `/torneos` decía "En curso" y no había forma de
--     llegar a "Terminado".
--
-- La BASE ya lo soportaba: `matchdays_one_masters` y `matchdays_one_live` son
-- unique sobre `discipline_id`, NO sobre `season_id` (verificado en el
-- catálogo). Lo único que faltaba era que la función recibiera la disciplina.
--
-- ADITIVA, y esto es lo importante: `create_masters` es `security definer` y
-- cambiarle la firma es la trampa documentada del repo — `create or replace`
-- con otra firma crea una sobrecarga ambigua o falla, y un `drop` se lleva
-- los grants. Va una función NUEVA con otro NOMBRE (con el mismo nombre y
-- `(uuid, date)` sería la MISMA firma y colisionaría), igual que `0038` hizo
-- con `season_public_formats`. La prueba es el diff de `db/database.types.ts`.
--
-- El cuerpo es el de `0050` con dos cambios y nada más: resuelve `season_id`
-- DESDE la disciplina en vez de la disciplina desde la temporada, y por eso
-- el guard de admin queda detrás del select (necesita el `season_id` para
-- correr). Los tres guards siguientes —`has_masters`, la cuenta de fechas
-- regulares cerradas, el `max(number) + 1`— ya eran POR DISCIPLINA desde
-- `0049`/`0050`, así que no se tocan.
create function public.create_discipline_masters(p_discipline uuid, p_played_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_season      uuid;
  v_pair_size   int;
  v_allows_draw boolean;
  v_has_masters boolean;
  v_regular     int;
  v_closed      int;
  v_number      int;
  v_new         uuid;
begin
  select season_id, pair_size, allows_draw, has_masters, (config ->> 'regularMatchdays')::int
    into v_season, v_pair_size, v_allows_draw, v_has_masters, v_regular
    from public.disciplines
   where id = p_discipline;
  if v_season is null then
    raise exception 'La disciplina no existe.';
  end if;

  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede armar el Masters.';
  end if;

  if not v_has_masters then
    raise exception 'Esta disciplina no juega Masters: termina con su última fecha regular.';
  end if;

  -- S97: `0049` sacó el `if v_regular is null` que `0021` tenía, al mudar la
  -- lectura de `seasons` a `disciplines`. Sin él, un `disciplines.config` sin
  -- `regularMatchdays` deja `v_regular` en NULL y el `if v_closed < v_regular`
  -- de abajo evalúa NULL -> falso: el Masters se armaría SIN NINGUNA compuerta,
  -- en silencio. Hoy es inalcanzable (`SeasonConfig` lo declara obligatorio y
  -- `assertValidConfig` valida `>= 1`), pero esa premisa la sostiene sólo
  -- TypeScript, y esta función es `security definer`: se llega por RPC directo.
  --
  -- La otra mitad de S97 —`close_matchday` (`0056:124`), donde un `v_regular`
  -- NULL deja la disciplina sin terminar NUNCA— queda ABIERTA a propósito:
  -- cerrarla pide un restatement entero de la función más crítica del schema,
  -- verificada por 8 mutaciones en #4034, por un caso igual de inalcanzable.
  if v_regular is null then
    raise exception 'La disciplina no tiene definida la cantidad de fechas.';
  end if;

  select count(*) into v_closed
    from public.matchdays
   where discipline_id = p_discipline and kind = 'REGULAR' and status = 'CLOSED';

  if v_closed < v_regular then
    raise exception 'El Masters se juega al terminar las % fechas: faltan %.',
      v_regular, v_regular - v_closed;
  end if;

  select coalesce(max(number), 0) + 1 into v_number
    from public.matchdays where discipline_id = p_discipline;

  insert into public.matchdays (season_id, discipline_id, number, kind, played_on, pair_size, allows_draw)
  values (v_season, p_discipline, v_number, 'MASTERS', p_played_on, v_pair_size, v_allows_draw)
  returning id into v_new;

  return v_new;
end;
$$;

revoke execute on function public.create_discipline_masters(uuid, date) from public, anon;
grant  execute on function public.create_discipline_masters(uuid, date) to authenticated;
