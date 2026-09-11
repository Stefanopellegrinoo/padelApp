-- ── remove_squad_seat: sacar un asiento toma el MISMO advisory lock por
--    temporada que add_squad_seat y promote_guest ────────────────────────────
-- Cierra la carrera que 0023 dejó escrita como "techo conocido y aceptado" y
-- que 0085 volvió a registrar sin resolver: `removeSeat` (`db/entries.ts`) era
-- un `supabase.from('entries').delete()` crudo, un round trip que no pedía
-- ningún lock y no coordinaba con nada.
--
-- **Qué deadlockeaba, y por qué el advisory de 0081/0084 no alcanzaba.** El
-- advisory serializa sólo a quien lo PIDE. La cascada de ese delete
-- (`entries` → `discipline_entries` y `entries` → `season_seed_order`, las dos
-- `on delete cascade`, en el orden que fije el OID del trigger) se cruzaba con
-- el `for update` y los `update ... where seed_position >= ...` que
-- `shift_seeds_up` (0023) y `shift_season_seeds_up` (0080) ya tenían tomados
-- sobre otras filas de esas mismas tablas. Dos transacciones esperándose en
-- círculo.
--
-- **Medido con dos sesiones psql reales y barrera de arranque (los dos
-- corredores se anotan en una tabla y un controlador abre la compuerta cuando
-- los dos están adentro, así el solapamiento no lo decide el jitter de
-- arranque de los procesos), N=60 por par:**
--
--   antes de esta migración:
--     `add_squad_seat(p_before)` ‖ delete crudo ....... 60/60 deadlock (40P01)
--     `shift_seeds_up`           ‖ delete crudo ....... 60/60 deadlock
--   control negativo, para que esos números signifiquen algo:
--     `add_squad_seat`           ‖ `add_squad_seat` .... 0/60 (el advisory ya
--                                                       funcionaba ENTRE ellas)
--
-- Sin barrera, contra PostgREST, la misma carrera medía 17/240 y 30/200: la
-- barrera amplifica ~10x la probabilidad de solaparse, no inventa el ciclo.
--
-- **La autorización se muda de RLS a un `raise` explícito**, mismo camino que
-- `add_squad_seat` recorrió en 0013: la función corre `security definer`, así
-- que RLS ya no la filtra y el guard tiene que estar acá. Eso arregla, de
-- paso, el único de los cuatro escritores del plantel que callaba: un delete
-- que RLS filtraba NO es un error en PostgREST, así que a quien no organiza se
-- le decía que sacó al jugador mientras el plantel seguía intacto (los otros
-- tres lo avisan con `count: 'exact'` desde W49).
--
-- El 23503 de un asiento que ya jugó se sigue traduciendo en TypeScript, donde
-- ya estaba: la FK (`pairs`/`awards` con `on delete no action`,
-- 0001_schema.sql) se chequea al final de la sentencia y sale de acá con su
-- SQLSTATE intacto, que es lo que `db/entries.ts` mira.
create function public.remove_squad_seat(p_entry uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_season uuid;
begin
  -- `select` SIN `for update`. El advisory tiene que ser el PRIMER lock de la
  -- transacción -- la lección que costó la ronda 4 (0084): ahí el advisory
  -- había quedado insertado DENTRO de otra cadena de locks ya tomada
  -- (`entries` → `matchdays`) y el deadlock pasó a 6/6. Un `for update` en
  -- esta línea repetiría exactamente ese error.
  select season_id into v_season from public.entries where id = p_entry;
  if v_season is null then
    raise exception 'Ese asiento no existe.';
  end if;

  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede sacar un asiento.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_season::text, 0));

  -- El hueco que queda en `seed_position` no se renumera, a propósito: es el
  -- contrato que 0023 fijó y que `db/squad-position.db.test.ts` custodia --
  -- renumerar sería reescribir el desempate inicial de todos los demás por
  -- sacar a uno.
  delete from public.entries where id = p_entry;
end $$;

revoke execute on function public.remove_squad_seat(uuid) from public, anon;
grant  execute on function public.remove_squad_seat(uuid) to authenticated;
