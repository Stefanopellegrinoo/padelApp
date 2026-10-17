-- W87 (verify-report-pre-contract #4026) ─────────────────────────────────
--
-- `create_masters` leía `(config ->> 'regularMatchdays')::int` de
-- `public.seasons`, pero `seasons.config` no tiene escritor de producción
-- desde PR6: `updateDisciplineConfig` (db/discipline.ts) -- el único camino
-- real de "Fechas" en Ajustes -- sólo toca `disciplines.config`. Editar las
-- fechas de una disciplina desincroniza el portón del Masters: la pantalla
-- (`fechas/page.tsx:114`, que SÍ lee `discipline.config.regularMatchdays`)
-- podía decir "Faltan 0" mientras el RPC, con la config vieja de la
-- temporada, seguía diciendo "faltan 9".
--
-- Es también un bloqueante del CONTRACT: `drop column seasons.config`
-- rompía el Masters de todos los torneos mientras esta función siguiera
-- leyéndola.
--
-- Restatement de la ÚLTIMA versión (0036, verificado con
-- `rg '^create( or replace)? function|^drop function'` -> una sola función
-- en ese archivo, así que copiarlo entero no revierte nada ajeno -- la
-- trampa que 0025 le tendió a 0031). El único cambio real: `v_regular` sale
-- del MISMO select que ya trae `pair_size`/`allows_draw` de la disciplina --
-- cero selects nuevos, misma fila -- en vez de una consulta aparte a
-- `seasons`. El chequeo `v_regular is null` ("La temporada no existe.") se
-- cae con el select que lo alimentaba: ya era inalcanzable en la práctica,
-- porque `is_season_admin` (arriba) rechaza a cualquiera -- admin incluido
-- -- para una temporada que no existe, antes de llegar acá.
create or replace function public.create_masters(p_season uuid, p_played_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discipline  uuid;
  v_pair_size   int;
  v_allows_draw boolean;
  v_regular     int;
  v_closed      int;
  v_number      int;
  v_new         uuid;
begin
  if not public.is_season_admin(p_season) then
    raise exception 'Sólo quien organiza la temporada puede armar el Masters.';
  end if;

  select id, pair_size, allows_draw, (config ->> 'regularMatchdays')::int
    into v_discipline, v_pair_size, v_allows_draw, v_regular
    from public.disciplines
   where season_id = p_season
   order by position, created_at
   limit 1;
  if v_discipline is null then
    raise exception 'La temporada no tiene disciplina.';
  end if;

  select count(*) into v_closed
    from public.matchdays
   where discipline_id = v_discipline and kind = 'REGULAR' and status = 'CLOSED';

  if v_closed < v_regular then
    raise exception 'El Masters se juega al terminar las % fechas: faltan %.',
      v_regular, v_regular - v_closed;
  end if;

  select coalesce(max(number), 0) + 1 into v_number
    from public.matchdays where discipline_id = v_discipline;

  -- `matchdays_one_masters` frena el segundo Masters y `matchdays_one_live`
  -- frena crearlo con otra fecha sin cerrar. Los dos levantan 23505; el borde
  -- de TypeScript traduce ese código a un mensaje que se pueda leer.
  --
  --`pair_size` y `allows_draw` van EXPLÍCITOS: son las dos mitades
  -- variables de `matchdays_discipline_size` y `matchdays_discipline_draw`.
  insert into public.matchdays (season_id, discipline_id, number, kind, played_on, pair_size, allows_draw)
  values (p_season, v_discipline, v_number, 'MASTERS', p_played_on, v_pair_size, v_allows_draw)
  returning id into v_new;

  return v_new;
end;
$$;

revoke execute on function public.create_masters(uuid, date) from public, anon;
grant  execute on function public.create_masters(uuid, date) to authenticated;
