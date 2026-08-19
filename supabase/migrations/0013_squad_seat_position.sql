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
-- `deferrable`, así que cada fila que el UPDATE escribe tiene que dejar la
-- tabla consistente EN ESE INSTANTE, no al final de la transacción. Y
-- `seed_position >= 0` es un CHECK (0001_schema.sql:63), así que "parkear"
-- corriendo todo a negativo tampoco es legal.
--
-- Con M = max(seed_position) del SQUAD de la temporada y `v_park := M + 2`:
--   pasada 1: `seed_position += v_park` donde `seed_position >= p_from`
--             origen [p_from, M] → destino [p_from+M+2, 2M+2]
--   pasada 2: `seed_position -= v_park - 1` donde `seed_position >= v_park`
--             origen [p_from+M+2, 2M+2] → destino [p_from+1, M+1]
--
-- El `UPDATE` no tiene `ORDER BY` y no lo puede tener: en qué orden el motor
-- visita las filas lo elige el planner —un Index Scan sube por seed_position,
-- un Seq Scan sobre un heap descendente baja— y eso cambia solo con un
-- `ANALYZE`. Así que cada pasada tiene que ser segura en CUALQUIER orden, y
-- para eso hay que probar CUATRO cosas, no dos: cada pasada no pisa ni a las
-- filas quietas ni a su propio origen todavía sin procesar.
--   1. pasada 1 vs. las quietas [0, p_from-1]: su destino arranca en
--      p_from+M+2, que es > M. Disjunto para todo p_from >= 0.
--   2. pasada 1 vs. su propio origen [p_from, M]: mismo número, p_from+M+2
--      es > M. Disjunto para todo p_from >= 0.
--   3. pasada 2 vs. las quietas [0, p_from-1]: su destino arranca en
--      p_from+1, que es > p_from-1. Disjunto para todo p_from >= 0.
--   4. pasada 2 vs. su propio origen: acá no hace falta NINGUNA condición
--      sobre p_from, y conviene no escribir una de más. El `where` de la
--      pasada 2 es `seed_position >= v_park`, así que la fila más baja que
--      puede llegar a tocar está en M+2 pase lo que pase, y su destino más
--      alto es M+1. M+1 < M+2 y se terminó: disjunto para CUALQUIER p_from
--      —también negativo— y con cualquier patrón de huecos. Una guarda
--      `p_from >= 0` acá arriba sería ruido: no hay hazard que evitar.
--
-- El punto 4 es el que costó caro y es la razón del +2. Con `v_park := M + 1`
-- la cuenta daba M+1 < p_from+M+1, que es cierto sólo si p_from > 0: fallaba
-- en EXACTAMENTE un caso —insertar primero de todos, p_from = 0— y en
-- exactamente un punto, la posición M+1. Ahí la fila que estaba en M aterriza
-- encima de la que estaba en 0, que sigue parkeada porque todavía no le tocó.
-- Si el motor visita la primera antes que la segunda, 23505 y se cae la
-- función entera. Con Index Scan sube y zafa de casualidad; con Seq Scan sobre
-- un heap descendente explota. El margen que hace falta es UNO —las posiciones
-- son enteras— y eso es exactamente lo que compra el +2: separa los rangos sin
-- importar el orden de visita. `db/entries.db.test.ts` fuerza el plan adverso
-- para que no vuelva.
--
-- `v_park` sale de `max(seed_position)` y NUNCA de un `count`: los huecos de
-- `removeSeat` hacen que contar mienta.
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
--Nota: dos admins agregando a la vez en la misma temporada leen el mismo
-- `max(seed_position)` y calculan el mismo `v_park`, así que el segundo corre
-- la cola con un `v_park` que se le quedó viejo apenas el primero commiteó. Lo
-- único que está PROBADO acá es que si eso levanta una excepción —23505 es lo
-- esperable— la función se cae entera, porque toda ella es una transacción
-- implícita: en ese caso no queda un plantel corrido a medias. Lo que NO está
-- probado es que SIEMPRE levante excepción en vez de commitear un orden
-- distinto del que el admin eligió; el entrelazado bajo READ COMMITTED no se
-- probó fila por fila. Techo conocido y aceptado, no resuelto acá: si dos
-- admins editando el mismo plantel a la vez deja de ser anecdótico, la
-- solución es un advisory lock por `season_id`.
create or replace function public.shift_seeds_up(p_season uuid, p_from int)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_park int;
begin
  select coalesce(max(seed_position), -1) + 2 into v_park
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
--
-- El nombre vacío se valida ACÁ y no sólo en `db/entries.ts`: esta función
-- está grantada a `authenticated` y sale en `db/database.types.ts`, así que es
-- llamable por RPC directo sin pasar nunca por el cliente. Sin este chequeo,
-- un nombre en blanco rebota contra el CHECK `entries_squad_named`
-- (0001_schema.sql) y el admin lee un mensaje de Postgres en inglés. Mismo
-- texto que el guard del cliente, a propósito: el borde no cambia el mensaje.
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

  -- `!~ '\S'` y no `trim(...) = ''`: el `trim` de Postgres saca U+0020 y nada
  -- más, así que `trim(E'\t') = ''` da FALSE y un `p_name` de un solo tab se
  -- colaba — también pasa `entries_squad_named`, con lo cual quedaba un asiento
  -- real que se dibuja en blanco en todas las pantallas y da `initials()`
  -- vacías. El `String.trim()` de JS sí saca tabs, saltos y NBSP, así que la
  -- guarda de acá era ESTRICTAMENTE más débil que la del cliente que existe
  -- para respaldar. "No tiene ni un caracter que no sea espacio" cubre la
  -- misma familia que JS sin tener que enumerarla.
  if coalesce(p_name, '') !~ '\S' then
    raise exception 'El asiento necesita un nombre.';
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
