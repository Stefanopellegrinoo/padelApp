-- Promover a un invitado al plantel: el invitado que ya jugó una fecha pasa a
-- ser un asiento SQUAD más, sin perder lo que ganó jugando.
--
-- **El mecanismo, en una frase.** `promote_guest` NUNCA recalcula: copia el
-- award CONGELADO que ya tiene la pareja de este invitado en esta fecha, o
-- REFUSA la promoción entera. No hay una tercera opción, y no hay ningún `if`
-- que decida "está bien recalcular acá": el único `insert into awards` de esta
-- función es el de abajo, un `insert ... select` cuyos `position` y `points`
-- salen de filas de `awards` que YA existen. El reparto nuevo lo trae
-- `close_matchday` (0005:114) desde afuera, en su parámetro `p_awards`, y esta
-- función no lo llama.
--
-- Dos cosas que NO se están diciendo, porque no son ciertas y una versión
-- anterior de este comentario las afirmaba:
--   · que `close_matchday` sea la única que escribe en `awards`. Los `insert
--     into public.awards` de todo el esquema son exactamente dos —0005:114 y
--     el de abajo— y el borrado vive en `reopen_matchday` (0005:187).
--   · que nadie más pueda escribirlos. `awards_write` (0002_rls.sql:213-216) es
--     `for all to authenticated` con `is_season_admin` y sin revoke por
--     columna, así que un `POST /awards` desde el cliente autenticado de quien
--     organiza la temporada entra sin pasar por ninguna función (medido).
-- La garantía de acá abajo es sobre lo que ESTA función hace, no sobre lo que
-- el esquema impide.
--
-- **Por qué copiar es lo mismo que reabrir y volver a cerrar — SÓLO en el caso
-- que esta función acepta.** `computeAwards` (core/awards.ts) le da a LOS DOS
-- integrantes de una pareja el mismo `position` y los mismos `points`. Pero eso
-- solo NO alcanza para afirmar que el award copiado es el que un recálculo le
-- habría dado: antes de repartir, `computeAwards` FILTRA las parejas que cobran
-- (`paying`, core/awards.ts:26-28) y recién después asigna puntos por índice.
-- Sacar a alguien del conjunto de invitados puede METER a su pareja adentro de
-- `paying` y correr un lugar a todas las de abajo. Medido con
-- `defaultConfig(12)` sobre la misma tabla, con gA y gB invitados en la misma
-- pareja:
--   congelado:   s5,s6 -> position 3, 5 puntos | gA -> sin fila
--   recalculado: gA    -> position 3, 5 puntos | s5,s6 -> position 4, 3 puntos
-- O sea: el teorema es FALSO cuando el compañero es otro invitado. Vale —y se
-- puede demostrar— sólo cuando TODAS las parejas del invitado en esta fecha ya
-- estaban adentro de `paying`, que es exactamente decir "en cada una de ellas
-- su compañero tiene un award congelado". El cuantificador importa: "alguna
-- pareja suya cobraba" NO alcanza, porque las otras entran a `paying` igual al
-- voltear `kind`. Ése es el único caso que esta función acepta; los demás los
-- rechaza (ver abajo). Pinneado con valores tipeados a mano —nunca comparando
-- una corrida de `computeAwards` contra otra— en `core/awards.test.ts`,
-- incluyendo un caso con una pareja toda invitada ADENTRO de la tabla, que es
-- el que hace fallar al pin si alguien toca el filtro `paying`.
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
-- **Los casos del reparto: uno se acepta y el resto se refusan.**
--   1. En cada pareja suya de esta fecha el compañero es del plantel y tiene
--      award (el incidente original: una sola pareja) → se copia una fila por
--      pareja. ACEPTADO.
--   2. En ALGUNA de sus parejas el compañero es OTRO invitado (pareja toda
--      invitada, excluida de posiciones pagas por `computeAwards`) → REFUSADO,
--      aunque en otra pareja suya el compañero sí cobre.
--   3. El invitado nunca quedó adentro de una `pairs` de esta fecha (se puede
--      armar a mano contra la base, aunque el flujo normal de la app no
--      debería dejarlo pasar) → REFUSADO.
-- El caso 2 con dos parejas no lo produce la app —`generatePairs`
-- (db/matchday.ts:458) borra las `pairs` de la fecha antes de insertar, así que
-- `buildPairs` nunca mete un entry en dos— pero sí se arma a mano contra la
-- base, está adentro del contrato que esta función defiende, y tiene su test.
-- "el compañero tiene award" es literalmente el predicado `paying` que usa
-- `computeAwards` (core/awards.ts:26-28: `championshipMembers(row).length >
-- 0`), así que preguntar por el award es una prueba MÁS fuerte que preguntar
-- `kind = 'SQUAD'`: cubre sin ninguna rama extra el caso — hoy inexistente,
-- pero no imposible del lado de la base— de un asiento SQUAD sin award
-- propio en esa fecha por cualquier otro motivo.
--
-- **Por qué 2 y 3 se refusan en vez de saltearse.** La versión anterior
-- insertaba cero filas y devolvía éxito, y eso ROMPÍA la fecha. La pantalla de
-- la fecha (`app/torneo/[id]/fechas/[n]/page.tsx:274-285`) no lee `awards`
-- para pintar la columna de puntos: la RECALCULA en vivo con
-- `computeAwards(standings, config, detail.guestIds)`. Promover a un miembro
-- de una pareja toda invitada lo saca de `guestIds` sin tocar `pairs`, esa
-- pareja pasa de no-paga a paga, `paying.length` crece en uno — y en una fecha
-- que tenía más parejas que valores de puntos (legal JUSTAMENTE porque la
-- pareja toda invitada estaba excluida) `computeAwards` tira adentro de un
-- server component. Reproducido con la fecha de `db/promote.db.test.ts` spec
-- 3.2 (8 del plantel + 2 invitados trabados = 5 parejas, `defaultConfig(8)`
-- tiene 4 valores de puntos):
--   antes de promover: la página renderiza, 8 awards
--   después:           "La fecha tiene 5 parejas del torneo pero la lista de
--                       puntos sólo tiene 4 valores."
--   `reopen_matchday`: funciona, y BORRA los awards
--   `close_matchday`:  vuelve a tirar el mismo error
-- La fecha queda OPEN para siempre —`matchdays_one_live` traba todas las demás
-- de la temporada— y los puntos ya no están. `removeSeat` tampoco lo deshace
-- (23503 por `pairs`): sólo queda `cancel_matchday`, o sea borrar la fecha.
-- Refusando, toda promoción exitosa es un invitado cuyas parejas YA cobraban
-- todas: la longitud de `paying` no cambia por NINGUNA puerta que esta función
-- abra.
--
-- Lo que eso NO dice —y lo que una versión anterior de este comentario decía
-- de más— es que el error sea inalcanzable. No lo es: el cliente autenticado
-- de quien organiza la temporada puede hacer el mismo flip sin pasar por acá,
-- porque `entries_write` (0002_rls.sql:164-167) es `for all to authenticated`
-- con `is_season_admin` y sin revoke por columna. Medido sobre esta misma
-- fecha, con el cliente del admin (no con `service_role`):
--   PATCH entries {kind:'SQUAD', matchday_id:null}                   -> 23505,
--     `entries_seed`: el seed_position de invitado choca con el de un asiento
--   PATCH entries {kind:'SQUAD', matchday_id:null, seed_position:99} -> PERMITIDO
--   la página, después de ese segundo PATCH -> "La fecha tiene 5 parejas del
--     torneo pero la lista de puntos sólo tiene 4 valores."
-- O sea: RLS no lo frena, lo frena un índice único que se esquiva eligiendo
-- un `seed_position` libre. El defecto de fondo es el recálculo en vivo de la
-- página, y arreglarlo —que lea los awards congelados— es otra PR. Ésta cierra
-- todas las puertas que abre; no cierra las que nunca fueron suyas.
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
-- **Por qué una doble promoción no duplica el award.** Dos protecciones, y
-- conviene ser preciso sobre qué cubre cada una:
--   1. El primer `select ... for update` sobre la fila del invitado la traba
--      hasta el commit. Una segunda llamada concurrente espera esa traba, y
--      cuando la consigue ve `kind = 'SQUAD'` — ya no `GUEST` — y el guard de
--      abajo la rechaza ANTES de llegar al insert. Nunca llega a intentar un
--      segundo award para el mismo entry. Lo que hay probado de esto es el
--      camino SECUENCIAL (`db/promote.db.test.ts`: promover, y volver a
--      promover, da "ya es del plantel" y un solo award). La versión
--      CONCURRENTE —dos transacciones peleándose la traba— no tiene test:
--      montarlo pide dos conexiones crudas y no está escrito.
--   2. Si esa primera línea de defensa fallara y el invitado tuviera DOS filas
--      de `pairs` en la misma fecha, el `unique (matchday_id, entry_id)` de
--      `awards` (0001_schema.sql:220) corta en seco: el `insert ... select`
--      trae dos filas con la misma clave, levanta 23505 y deshace TODA la
--      función, porque toda ella es una transacción implícita (probado en
--      `db/promote.db.test.ts`). Nada del esquema impide ese estado de `pairs`:
--      el `unique (matchday_id, entry_a)` / `(entry_b)` está en `pair_locks`
--      (0001_schema.sql:135-136), NO en `pairs`. El caso que antes se colaba
--      —sólo UNO de los dos compañeros cobrando, el join devolviendo una sola
--      fila y el invitado heredando el award de una pareja elegida
--      arbitrariamente, sin error— ya no llega hasta acá: el guard de abajo
--      pide que cobren TODOS, y lo refusa antes.
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
--     choca entero y no deja el plantel corrido a medias. Adentro de ese mismo
--     techo entra una inversión de orden de trabas: acá se toma `entries`
--     (el `for update` de abajo) y DESPUÉS `matchdays`, mientras que
--     `cancel_matchday` toma `matchdays` (0012:71) y después cascadea sobre las
--     `entries` del invitado — dos admins de la misma temporada, uno sumando y
--     el otro borrando la fecha, pueden dar 40P01 (deadlock detected), que sale
--     crudo y en inglés a través de `EdgeError`. No corrompe nada: Postgres mata
--     una de las dos transacciones entera.
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

  -- `for update`, como TODOS sus hermanos que leen este `status` para decidir:
  -- `open_matchday` (0005:24), `close_matchday` (0005:65-66),
  -- `reopen_matchday` (0005:154-155), `cancel_matchday` (0012:71). Leerlo
  -- suelto deja pasar un `reopen_matchday` concurrente por el medio, y las dos
  -- formas de que salga mal ya están identificadas:
  --   A) esta función lee CLOSED → reopen commitea (borra los awards, deja la
  --      fecha OPEN) → el insert de acá no encuentra nada. El asiento queda
  --      SQUAD adentro de una fecha EN JUEGO, todavía referenciado por sus
  --      `pairs` y `pair_locks`: exactamente el estado que el guard de OPEN
  --      existe para que no pase.
  --   B) el insert de acá aterriza antes de que el `delete from awards` de
  --      reopen lo vea → reopen borra las filas viejas pero no ésta → el
  --      próximo `close_matchday` choca con 23505 en (matchday_id, entry_id) y
  --      la fecha no se puede cerrar más.
  -- Traba además contra `cancel_matchday`, que es de lo que se preocupa el
  -- párrafo de acá abajo.
  --
  -- `entries_guest_matchday` (0001_schema.sql:74) garantiza que un GUEST
  -- siempre apunta a una fecha que existe — v_status no puede dar null en un
  -- camino normal. Igual se guarda la rama, mismo motivo que
  -- `cancel_matchday`: una fecha que desaparece por un `cancel_matchday`
  -- concurrente ANTES de este select (que cascadearía y borraría también esta
  -- fila) no puede dejar la función leyendo un estado a medias.
  select status into v_status from public.matchdays where id = v_matchday for update;

  -- Lista blanca, no lista negra: la forma que quedó en `cancel_matchday:80`
  -- después de la corrección de la PR1. Enumerar los estados prohibidos y
  -- confiar en un comentario para el resto deja que un quinto valor de
  -- `matchdays.status` —o un null que ya no llega por donde pensábamos— entre
  -- derecho a la función que escribe puntos de campeonato. Acá sólo pasa
  -- 'CLOSED'; el `case` conserva los dos mensajes distintos.
  if v_status is null or v_status <> 'CLOSED' then
    raise exception '%', case
      when v_status is null then 'La fecha de este invitado ya no existe.'
      when v_status = 'DRAFT' then 'Esta fecha todavía se está armando. Sacalo de invitado y agregalo al plantel como uno más.'
      when v_status = 'OPEN' then 'Esta fecha está en juego y sus puntos se reparten al cerrarla. Cerrala primero y después sumalo.'
      else 'Esta fecha no está cerrada, así que todavía no repartió ningún punto.'
    end;
  end if;

  -- Los dos refusos, ANTES de escribir una sola fila: el que no cumple estas
  -- dos condiciones no se puede promover DESDE ESTA FECHA sin cambiarle los
  -- puntos a los demás (ver el comentario grande de arriba, con la
  -- reproducción medida). Salir por acá no deja nada a medias ni corre la cola
  -- de `seed_position` al pedo.
  perform 1
     from public.pairs
    where matchday_id = v_matchday
      and (entry_a = p_entry or entry_b = p_entry);
  if not found then
    raise exception 'En esta fecha no quedó en ninguna pareja, así que no hay ningún punto suyo que conservar. Agregalo al plantel desde Ajustes › Plantel.';
  end if;

  -- El cuantificador va al derecho: se refusa si EXISTE UNA SOLA pareja suya
  -- sin compañero cobrando, no si FALTAN TODAS. Con un `join` que sólo pide
  -- "alguna pareja tiene compañero con award", un invitado metido en dos filas
  -- de `pairs` —una con un asiento que cobró y otra toda invitada— pasaba el
  -- guard por la primera, y la SEGUNDA entraba a `paying` igual al voltear
  -- `kind`: el incidente original, tal cual, medido en `db/promote.db.test.ts`
  -- ("dos parejas"). En el caso de una sola pareja —el único que la app
  -- produce, `generatePairs` borra antes de insertar— las dos formas deciden
  -- exactamente lo mismo y cuestan lo mismo.
  if exists (
    select 1
      from public.pairs pr
     where pr.matchday_id = v_matchday
       and (pr.entry_a = p_entry or pr.entry_b = p_entry)
       and not exists (
         select 1
           from public.awards a
          where a.matchday_id = pr.matchday_id
            and a.entry_id = case when pr.entry_a = p_entry then pr.entry_b else pr.entry_a end)
  ) then
    raise exception 'En esta fecha jugó en una pareja que no cobró puntos —lo habitual es que haya jugado con otro invitado—. Sumarlo acá le cambiaría los puntos a los demás, así que no se puede desde esta fecha.';
  end if;

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

  -- La copia. Los guards de arriba ya garantizan que este join encuentra al
  -- menos una fila, así que llegar acá y no insertar nada no es un caso
  -- posible. Sigue siendo un `insert ... select` y no un `insert ... values`
  -- con los valores leídos antes: si el invitado tuviera DOS filas de `pairs`
  -- con los dos compañeros cobrando, el select trae dos filas con la misma
  -- clave y el `unique` de `awards` corta la función entera — un `values` con
  -- un valor ya elegido se comería ese estado en silencio.
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
