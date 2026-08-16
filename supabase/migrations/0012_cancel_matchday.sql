-- Borrar fecha: DRAFT u OPEN se van enteras, con todo lo que cuelga de ellas.
-- CLOSED se rechaza a propósito: ahí ya se repartieron puntos, y lo que
-- corresponde en ese caso es reabrir (0005_matchday_moves.sql:134), no
-- desaparecerla — el mensaje de acá manda para ese lado y no para "cancelar".
--
-- **La rama `is null` explícita es la que niega, y eso no es cosmético.** Esta
-- es la única función del esquema que pasa por encima del `revoke delete on
-- matchdays`, así que su default tiene que ser NEGARSE. Con la versión
-- anterior —`if v_status = 'CLOSED'`— alcanzaba con que la fila desapareciera
-- entre `matchday_season` y el `select … for update` (un `deleteSeason`
-- concurrente cascadeando) para que `v_status` quedara en null: `null =
-- 'CLOSED'` da null, la rama no dispara, el delete borra 0 filas y **la
-- función devuelve éxito**. La pantalla entonces redirige a una temporada que
-- ya no existe.
--
-- Por eso el null tiene su propia rama, con el mismo mensaje que la de arriba.
-- Quien lo carga es ESA rama y no la lista blanca de abajo: `null not in
-- ('DRAFT', 'OPEN')` también da null, así que la lista blanca tampoco niega el
-- null — lo suyo es dejar CLOSED afuera, nada más. Sacar el `is null` por
-- "redundante" contra la lista blanca reabre el agujero entero.
--
-- Las funciones hermanas NO son ejemplo de esto, al revés: los `<>` de
-- `open` (0005:25), `close` (0005:68), `reopen` (0005:157) y `redraft`
-- (0011:36) tampoco niegan null —`null <> 'OPEN'` da null, el `raise` no
-- dispara y la ejecución sigue de largo con todas las guardas pasando en
-- vacío—. Eso hasta ahora era inalcanzable: sin esta función no había manera
-- de que una fecha se borrara sola debajo de otra sesión. Esta función es
-- justamente la que lo vuelve alcanzable. Arreglarlo pide `create or replace`
-- sobre 0005 y 0011 restateando cuerpos enteros de guardas cargadas para
-- cambiar una línea en cada una, así que queda anotado como PR aparte y no se
-- toca acá.
--
-- Eso NO era una afirmación probada hasta ahora: los nueve tests que había
-- entraban todos con un status real, así que los nueve pasaban enteros con el
-- deny-list puesto. El que lo pinnea es "la fecha que desaparece entre la
-- lectura y la traba" (`db/cancel.db.test.ts`), que monta el entrelazado con
-- una segunda sesión de psql —una traba de fila que se suelta recién después
-- de borrar— y falla si esta guarda vuelve a la forma vieja.
--
-- No hace falta un solo delete además del de `matchdays`: attendances,
-- pair_locks, pairs, matches, match_sets y las entries GUEST de esta fecha
-- cuelgan todas de `matchday_id` con `on delete cascade` (0001_schema.sql).
-- El plantel SQUAD no tiene `matchday_id` —vive en la temporada, no en la
-- fecha— así que no hay ningún riesgo de arrastrarlo con esto. Los FK que
-- apuntan a `entries` con `on delete no action` —los únicos que podrían FRENAR
-- el borrado en vez de acompañarlo— son CUATRO, repartidos en TRES tablas
-- (verificable con `select conname, conrelid::regclass from pg_constraint
-- where contype = 'f' and confrelid = 'public.entries'::regclass`):
--   · `pairs.entry_a/entry_b → entries` (0001_schema.sql:170-171), que son
--     dos. Son los que esta función se cruza de verdad, y no frenan porque las
--     parejas se van en el mismo statement que los invitados, y el chequeo de
--     `no action` corre al final del statement, no fila por fila.
--     `db/cancel.db.test.ts` lo ejercita con un plantel impar, que es UNA de
--     las formas de tener un invitado ADENTRO de una pareja — `addGuestPair`
--     (`app/torneo/[id]/fechas/[n]/actions.ts:273`) mete dos invitados
--     trabados entre sí con el plantel perfectamente par, y es otra.
--   · `awards.entry_id → entries` (0001_schema.sql:225). Éste no se cruza
--     NUNCA por acá, y no porque el borrado lo esquive: `awards` sólo tiene
--     filas en una fecha CLOSED, y CLOSED queda afuera de la lista blanca de
--     abajo. O sea, es inalcanzable por construcción de la guarda, no inocuo
--     por la forma del cascade — si algún día la lista blanca aceptara CLOSED,
--     este FK pasaría a ser el problema.
--   · `attendances.(entry_id, entry_kind) → entries (id, kind)`
--     (0001_schema.sql:113). No lleva cláusula `on delete`, así que su default
--     TAMBIÉN es no action — es fácil de pasar por alto porque la otra FK de
--     la misma tabla, la de `(entry_id, season_id)`, sí cascadea. Tampoco
--     frena, por dos motivos independientes: `attendances` es SQUAD-only (esa
--     misma FK lo impone) y el plantel SQUAD no se borra acá, y además las
--     filas de asistencia se van solas colgadas de `matchday_id` en el mismo
--     statement.
--
-- **Sí toca `seasons.status`, en un solo sentido.** `open_matchday` mueve la
-- temporada de SETUP a ACTIVE al confirmar su primera fecha (0005:37). Si esa
-- fecha era la única y se borra, la temporada queda ACTIVE con cero fechas, y
-- las pantallas la anuncian como "En curso" cuando no empezó nada
-- (`app/torneos/page.tsx:27`, `app/torneo/[id]/page.tsx:50`) — un estado que
-- antes de esta función era inalcanzable. Por eso el trinquete se revierte, y
-- con la guarda más angosta posible: sólo desde ACTIVE y sólo si no quedó
-- ninguna fecha. Una temporada FINISHED nunca puede caminar para atrás por
-- acá.
--
-- FINISHED, además, es inalcanzable desde esta función por otro lado: el único
-- camino que la escribe es cerrar el Masters, y CLOSED queda afuera de la
-- lista blanca. Y no deja un hueco en `number`: `matchdays_one_live` garantiza
-- como máximo una fecha sin cerrar por temporada, y los números sólo crecen
-- (`max(number) + 1` en `createMatchday`), así que la que se borra siempre es
-- la última creada.
--
-- El mensaje de `reopen_matchday` en 0005_matchday_moves.sql:178 ("Borrala
-- vos antes de reabrir ésta") NO se toca acá: hasta ahora era una promesa sin
-- ninguna acción real detrás, y desde que existe esta función el "borrala
-- vos" pasa a ser literalmente cierto. Reescribirlo sería restatear ~65
-- líneas de guardas que ya funcionan para cambiar una palabra que ya dice lo
-- correcto.
create or replace function public.cancel_matchday(p_matchday uuid)
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
    raise exception 'Sólo quien organiza la temporada puede borrar una fecha.';
  end if;

  select status into v_status from public.matchdays where id = p_matchday for update;
  if v_status is null then
    raise exception 'La fecha no existe.';
  end if;
  -- No dice "reabrila" y listo: `reopen_matchday` sólo acepta la ÚLTIMA fecha
  -- cerrada (0005:180-185), así que mandar a reabrir la 3 cuando la 5 está
  -- cerrada es prometer una puerta que no abre — el mismo defecto que esta
  -- rama vino a pagar. El "si … es la última cerrada" es lo que lo hace cierto
  -- en los dos casos.
  if v_status not in ('DRAFT', 'OPEN') then
    raise exception 'Una fecha cerrada no se borra. Si hay que corregirla y es la última cerrada, reabrila.';
  end if;

  delete from public.matchdays where id = p_matchday;

  -- El trinquete de `open_matchday` (0005:37) al revés, y sólo cuando la
  -- temporada se quedó sin una sola fecha: si no, "En curso" en Mis torneos
  -- para una temporada vacía.
  update public.seasons set status = 'SETUP'
   where id = v_season
     and status = 'ACTIVE'
     and not exists (select 1 from public.matchdays where season_id = v_season);
end;
$$;

revoke execute on function public.cancel_matchday(uuid) from public, anon;
grant  execute on function public.cancel_matchday(uuid) to authenticated;
