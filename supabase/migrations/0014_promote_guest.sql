-- Promover a un invitado al plantel: el invitado que ya jugó una fecha pasa a
-- ser un asiento SQUAD más, sin perder lo que ganó jugando.
--
-- **El mecanismo, en una frase.** `promote_guest` NUNCA recalcula: copia el
-- award CONGELADO que ya tiene la pareja de este invitado en esta fecha, o no
-- copia nada. No hay una tercera opción, y no hay ningún `if` que decida "está
-- bien recalcular acá" — `close_matchday` es la única función de todo el
-- esquema que puede escribir en `awards`, y ésta no la llama.
--
-- **Por qué copiar es lo mismo que reabrir y volver a cerrar.**
-- `computeAwards` (core/awards.ts) le da a LOS DOS integrantes de una pareja
-- el mismo `position` y los mismos `points` — nunca depende de si alguno es
-- invitado, sólo los EXCLUYE del resultado si lo es. Así que el award que
-- promoteGuest le copia a un invitado suelto es exactamente el award que
-- `computeAwards` le habría dado a él mismo si nunca hubiera sido invitado.
-- El teorema está pinneado con valores tipeados a mano —no comparando una
-- corrida contra otra— en `core/awards.test.ts`.
--
-- **Por qué se rechaza CUALQUIER fecha que no esté CLOSED, no sólo "está
-- trabado en una que está en juego".** La versión angosta —refusar sólo
-- cuando el invitado ya está adentro de una pareja de una fecha no
-- CLOSED— dejaba pasar el caso "invitado suelto en una fecha DRAFT sin
-- sortear": ahí no hay nada que copiar ni que saltear, así que convertirlo
-- de una sería tan válido como la puerta que ya existe (sacarlo de invitado y
-- agregarlo con `add_squad_seat`). El problema es que "válido hoy" no es
-- "gratis para siempre": una fecha DRAFT se puede seguir editando —tildar
-- asistencia, cambiar con quién juega el invitado, volver a sortear— y el
-- entry recién convertido en SQUAD seguiría teniendo una `pair_locks` que
-- exige un invitado de un lado (0001_schema.sql:122-125, la garantía "toda
-- pareja trabada incluye a un invitado"), y `syncGuestSeat` seguiría
-- pudiendo decidir agregar OTRO invitado suelto sin enterarse de que éste ya
-- se fue del pool de invitados. Ninguno de los dos casos se probó ni se
-- descartó, y la puerta angosta no cuesta nada cerrarla: en DRAFT el admin ya
-- tiene el camino largo. Un guard en vez de dos.
--
-- **Los tres casos del reparto**, todos resueltos por el MISMO `insert ...
-- select` con un solo `join`, sin ninguna rama:
--   1. El compañero es del plantel y tiene award en esta fecha (el incidente
--      original) → el join encuentra la fila, se copia UNA fila.
--   2. El compañero es OTRO invitado (pareja toda invitada, excluida de
--      posiciones pagas por `computeAwards`) → el compañero no tiene fila en
--      `awards`, el join no encuentra nada, no se inserta nada.
--   3. El invitado nunca quedó adentro de una `pairs` de esta fecha (se
--      puede armar a mano contra la base, aunque el flujo normal de la app no
--      debería dejarlo pasar) → el join no encuentra pareja, no se inserta
--      nada.
-- "el compañero tiene award" es literalmente el predicado `paying` que usa
-- `computeAwards` (core/awards.ts:26-28: `championshipMembers(row).length >
-- 0`), así que preguntar por el award es una prueba MÁS fuerte que preguntar
-- `kind = 'SQUAD'`: cubre sin ninguna rama extra el caso — hoy inexistente,
-- pero no imposible del lado de la base— de un asiento SQUAD sin award
-- propio en esa fecha por cualquier otro motivo.
--
-- **El flip es seguro ANTES del insert de awards.** `entries_seed`
-- (0001_schema.sql:86) es un índice único parcial `where kind = 'SQUAD'`:
-- mientras la fila es GUEST no está adentro de ese índice en absoluto, así
-- que su `seed_position` de invitado (que vive en un espacio de numeración
-- totalmente distinto, el de `entries_guest_order`) es invisible para él. El
-- mismo `update` que cambia `kind` a `SQUAD` cambia también `seed_position`
-- al lugar que reservó `shift_seeds_up` (o el `max + 1` de siempre): el
-- índice sólo empieza a mirar la fila en el mismo instante en que ya tiene el
-- valor final, nunca a mitad de camino. `db/promote.db.test.ts` inserta antes
-- de un asiento existente y confirma que no queda ni hueco ni duplicado, la
-- misma prueba que ya corre para `add_squad_seat` en 0013.
--
-- **Por qué una doble promoción no duplica el award.** Dos protecciones
-- independientes, no una sola:
--   1. El primer `select ... for update` sobre la fila del invitado la traba
--      hasta el commit. Una segunda llamada concurrente espera esa traba, y
--      cuando la consigue ve `kind = 'SQUAD'` — ya no `GUEST` — y el guard de
--      abajo la rechaza ANTES de llegar al insert. Nunca llega a intentar un
--      segundo award para el mismo entry.
--   2. Si esa primera línea de defensa fallara por cualquier motivo —un bug
--      que deje pasar el guard, o el escenario más raro de una fila de
--      `pairs` duplicada para el mismo invitado en la misma fecha—, el `unique
--      (matchday_id, entry_id)` de `awards` (0001_schema.sql:220) corta en
--      seco: un `insert ... select` que trae dos filas con la misma clave
--      levanta 23505 y deshace TODA la función, porque toda ella es una
--      transacción implícita. Nunca un duplicado silencioso — o graba una
--      fila, o no graba ninguna. Las dos protecciones se prueban por separado
--      en `db/promote.db.test.ts`.
--
-- **Lo que esta función NO hace, a propósito:**
--   - No borra el asiento SQUAD duplicado que pudo haber creado
--     `add_squad_seat` mientras el invitado todavía jugaba de invitado: ese
--     "Sacar" ya existe en Ajustes › Plantel (`removeSeat`, db/entries.ts) y
--     ya tiene su propio 23503 cuando el duplicado quedó adentro de una fecha
--     viva — inventar una segunda forma de borrarlo es la que no se prueba la
--     que se rompe.
--   - No toca `pairs` ni `pair_locks` de la fecha del invitado: promociona la
--     entry ORIGINAL, el mismo id que esas tablas ya referencian, así que no
--     hay nada que repuntar.
--   - No es DEFERRABLE ni usa un advisory lock por temporada: mismo techo
--     conocido que `shift_seeds_up` en 0013 — dos admins tocando el mismo
--     plantel a la vez no está probado fila por fila, sólo que si choca,
--     choca entero y no deja el plantel corrido a medias.
create or replace function public.promote_guest(p_entry uuid, p_before uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season   uuid;
  v_matchday uuid;
  v_kind     text;
  v_name     text;
  v_status   text;
  v_at       int;
begin
  select season_id, matchday_id, kind, display_name
    into v_season, v_matchday, v_kind, v_name
    from public.entries
   where id = p_entry
   for update;

  if v_season is null then
    raise exception 'Ese invitado no existe.';
  end if;

  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede sumar un invitado al plantel.';
  end if;

  -- Cubre TANTO "ya es del plantel" (incluida una segunda promoción del mismo
  -- invitado, ver el comentario de arriba) COMO "no existe" ya cubierto arriba
  -- — acá sólo puede valer 'SQUAD', porque el check `kind in ('SQUAD',
  -- 'GUEST')` no deja un tercer valor.
  if v_kind <> 'GUEST' then
    raise exception 'Ese asiento ya es del plantel.';
  end if;

  if trim(coalesce(v_name, '')) = '' then
    raise exception 'Falta ponerle nombre al invitado. Sin eso, no lo podés sumar al plantel.';
  end if;

  -- `entries_guest_matchday` (0001_schema.sql:74) garantiza que un GUEST
  -- siempre apunta a una fecha que existe — v_status no puede dar null en un
  -- camino normal. Igual se guarda la rama, mismo motivo que
  -- `cancel_matchday`: una fecha que desaparece por un `cancel_matchday`
  -- concurrente ANTES de este select (que cascadearía y borraría también esta
  -- fila) no puede dejar la función leyendo un estado a medias.
  select status into v_status from public.matchdays where id = v_matchday;
  if v_status is null then
    raise exception 'La fecha de este invitado ya no existe.';
  end if;

  if v_status = 'DRAFT' then
    raise exception 'Esta fecha todavía se está armando. Sacalo de invitado y agregalo al plantel como uno más.';
  end if;
  if v_status = 'OPEN' then
    raise exception 'Esta fecha está en juego y sus puntos se reparten al cerrarla. Cerrala primero y después sumalo.';
  end if;
  -- A partir de acá v_status sólo puede ser 'CLOSED': el check de
  -- `matchdays.status` no deja un cuarto valor.

  -- Mismo mecanismo que `add_squad_seat` (0013_squad_seat_position.sql):
  -- `p_before = null` va al final, un `p_before` puntual reserva el lugar
  -- corriendo la cola con `shift_seeds_up` antes de escribir nada.
  if p_before is null then
    select coalesce(max(seed_position), -1) + 1 into v_at
      from public.entries
     where season_id = v_season and kind = 'SQUAD';
  else
    select seed_position into v_at
      from public.entries
     where id = p_before and season_id = v_season and kind = 'SQUAD'
     for update;
    if v_at is null then
      raise exception 'Ese jugador no está en el plantel.';
    end if;
    perform public.shift_seeds_up(v_season, v_at);
  end if;

  -- Un solo `update`, `kind` y `matchday_id` juntos: `entries_shape`
  -- (0001_schema.sql:67-70) exige que un SQUAD tenga `matchday_id is null`, y
  -- un `check` corre contra los valores FINALES de la fila, nunca a mitad de
  -- un statement — así que no hay un instante intermedio donde la fila sea
  -- "SQUAD con matchday_id todavía puesto" que el check pueda objetar.
  update public.entries
     set kind = 'SQUAD', matchday_id = null, seed_position = v_at
   where id = p_entry;

  -- El reparto entero, sin ninguna rama: ver el comentario grande de arriba
  -- para los tres casos que resuelve este único `insert ... select`.
  insert into public.awards (matchday_id, entry_id, season_id, position, points)
  select pr.matchday_id, p_entry, v_season, a.position, a.points
    from public.pairs pr
    join public.awards a
      on a.matchday_id = pr.matchday_id
     and a.entry_id = case when pr.entry_a = p_entry then pr.entry_b else pr.entry_a end
   where pr.matchday_id = v_matchday
     and (pr.entry_a = p_entry or pr.entry_b = p_entry);
end;
$$;

revoke execute on function public.promote_guest(uuid, uuid) from public, anon;
grant  execute on function public.promote_guest(uuid, uuid) to authenticated;
