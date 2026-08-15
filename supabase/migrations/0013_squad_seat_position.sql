-- Ubicar al que llega en el orden de desempate: sumar un asiento SQUAD nuevo
-- ya no lo manda siempre al final. `add_squad_seat` recibe DÓNDE con
-- `p_before` — un uuid, "antes de este asiento" — y no con un número.
--
-- **Por qué un uuid y no una posición.** `removeSeat` (db/entries.ts) deja
-- huecos en `seed_position` a propósito: sacar a alguien no renumera a los
-- demás, porque eso reescribiría el orden de desempate inicial de todo el
-- plantel por dar de baja a UNO. Con huecos, "posición 3" es ambiguo (¿el
-- tercer jugador? ¿seed_position = 3, que puede no existir?) y además queda
-- vieja apenas alguien más entra o sale entre que se mira la pantalla y se
-- confirma el alta. "Antes de Juan" no tiene ninguno de los dos problemas: el
-- id de Juan es Juan, siempre, exista o no un hueco antes de él.
--
-- **Por qué insertar y no un swap adyacente.** Insertar corre una cola
-- contigua un lugar y no toca el orden relativo de nadie más — la prueba pura
-- vive en `core/snapshots.test.ts`. Un swap invierte exactamente un par, y
-- `snapshotForMatchday` reconstruye el desempate de CADA fecha desde el orden
-- de seed VIVO en cada render (`core/snapshots.ts`): un swap cambiaría, con
-- efecto retroactivo, el desempate ya mostrado de fechas que ya se jugaron.
--
-- **El corrimiento es en dos pasadas ("parking"), no un `seed_position + 1`
-- directo.** `entries_seed` (0001_schema.sql:86) es un índice único PARCIAL —
-- `where kind = 'SQUAD'` — y un índice parcial no se puede declarar
-- `deferrable`, así que cada UPDATE individual tiene que dejar la tabla
-- consistente ANTES de que termine, no sólo al final de la transacción. Y
-- `seed_position >= 0` es un CHECK (0001_schema.sql:63), así que "parkear"
-- corriendo todo a negativo tampoco es legal. Con
-- `v_park := max(seed_position) + 1` sobre el SQUAD de la temporada:
--   pasada 1: `seed_position += v_park` donde `seed_position >= p_from`
--             → cae en [p_from+v_park, M+v_park], todo > M, así que no pisa
--               ninguna fila de las que se quedaron quietas ([0, p_from-1]).
--   pasada 2: `seed_position -= v_park - 1` donde `seed_position >= v_park`
--             → cae en [p_from+1, M+1].
-- Ninguna de las dos pasadas puede chocar consigo misma en NINGÚN orden de
-- fila: el `UPDATE` no tiene `ORDER BY` —eso es Postgres, no una promesa— y
-- las dos pasadas mapean a rangos disjuntos de los que no tocan, así que el
-- mapeo es inyectivo sin importar en qué orden el motor visite las filas. Por
-- eso `v_park` sale de `max(seed_position) + 1` y NUNCA de un `count`: los
-- huecos de `removeSeat` hacen que contar mienta.
--
-- `shift_seeds_up` es una función PLANA — ni siquiera `security definer` — a
-- la que se le saca el `execute` a `public`, `anon` Y `authenticated`: nadie
-- la llama por RPC nunca, sólo la llaman `add_squad_seat` (acá abajo) y, en
-- la próxima PR, `promote_guest`. No necesita ser DEFINER porque durante la
-- ejecución de una función DEFINER el rol activo YA es el dueño de esa
-- función; una función plana llamada desde adentro hereda ese rol sin
-- pedirlo. `add_squad_seat` sí es DEFINER, y su `is_season_admin` explícito
-- ES la autorización completa — DEFINER salta RLS, así que sin ese chequeo
-- cualquier autenticado movería el plantel de cualquier temporada.
--
-- ponytail: dos admins agregando a la vez en la misma temporada calculan el
-- mismo `v_park` y uno de los dos pisa al otro — 23505 en la segunda pasada,
-- y como toda la función es una transacción implícita, se cae ENTERA: no
-- queda nunca un plantel corrido a medias. Techo conocido, no resuelto acá;
-- si dos admins editando el mismo plantel a la vez deja de ser anecdótico, la
-- solución es un advisory lock por `season_id`.
create or replace function public.shift_seeds_up(p_season uuid, p_from int)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_park int;
begin
  select coalesce(max(seed_position), -1) + 1 into v_park
    from public.entries
   where season_id = p_season and kind = 'SQUAD';

  update public.entries
     set seed_position = seed_position + v_park
   where season_id = p_season and kind = 'SQUAD' and seed_position >= p_from;

  update public.entries
     set seed_position = seed_position - v_park + 1
   where season_id = p_season and kind = 'SQUAD' and seed_position >= v_park;
end;
$$;

revoke execute on function public.shift_seeds_up(uuid, int) from public, anon, authenticated;

-- Agrega un asiento SQUAD. `p_before = null` (el default) es "al final", que
-- es el ÚNICO comportamiento que existía antes de esta migración — a nadie
-- que ignore el selector nuevo le cambia nada.
--
-- Un `p_before` inválido (no existe, es de otra temporada, o es GUEST y no
-- SQUAD) se rechaza entero, sin agregar nada: aceptarlo en silencio y sumar
-- igual al final sería peor que fallar — el admin eligió un lugar puntual y
-- el sistema lo ignoró sin avisar.
create or replace function public.add_squad_seat(
  p_season uuid,
  p_name   text,
  p_before uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at int;
  v_id uuid;
begin
  if not public.is_season_admin(p_season) then
    raise exception 'Sólo quien organiza la temporada puede agregar un asiento.';
  end if;

  if p_before is null then
    select coalesce(max(seed_position), -1) + 1 into v_at
      from public.entries
     where season_id = p_season and kind = 'SQUAD';
  else
    -- El `for update` traba la fila DESTINO durante todo el corrimiento: si
    -- otra transacción la está sacando (`removeSeat`) al mismo tiempo, una de
    -- las dos espera a la otra en vez de leer una posición que deja de
    -- existir a mitad de camino.
    select seed_position into v_at
      from public.entries
     where id = p_before and season_id = p_season and kind = 'SQUAD'
     for update;
    if v_at is null then
      raise exception 'Ese jugador no está en el plantel.';
    end if;
    perform public.shift_seeds_up(p_season, v_at);
  end if;

  insert into public.entries (season_id, kind, display_name, seed_position)
  values (p_season, 'SQUAD', trim(p_name), v_at)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.add_squad_seat(uuid, text, uuid) from public, anon;
grant  execute on function public.add_squad_seat(uuid, text, uuid) to authenticated;
