-- ── add_squad_seat: corrige un comentario falso sobre lo que el advisory
--    lock garantiza (WU5, tanda 7, BLOQUEA) ──────────────────────────────────
-- Restatement quirúrgico de la definición viva (0081_add_squad_seat_season_
-- seed_order.sql), verificada contra `pg_get_functiondef` antes de
-- copiarla. Cambia UNA sola cosa: el comentario que vivía junto al bloque
-- de `season_seed_order`. El código -- guards, loop por disciplina,
-- `p_before` a los dos niveles -- es byte a byte lo que ya estaba.
--
-- **El comentario que se reemplaza decía**: "Acá abajo no hace falta
-- lockear nada más: para cuando se llega a este punto, esta transacción es
-- la única corriendo esta sección para esta temporada." **Es falso, y lo
-- era desde que se escribió (0081).** El advisory lock sólo serializa a
-- quien lo PIDE -- esta función y `promote_guest`, las dos con el mismo
-- hash de temporada -- no es un lock de tabla ni de fila, así que no le
-- importa a nadie que no lo pida. `removeSeat` (`db/entries.ts`) es un
-- `supabase.from('entries').delete()` que nunca lo toma: para cuando se
-- llega a este punto, esta transacción NO es necesariamente la única
-- corriendo esta sección -- `removeSeat` puede estar corriendo, en
-- paralelo, sin que el advisory se entere.
--
-- Este archivo no arregla esa carrera -- lo mismo que 0023 ya dejó sin
-- resolver del lado de `discipline_entries` ("techo conocido y aceptado")
-- -- sólo corrige el comentario para que diga lo que el advisory
-- REALMENTE garantiza: que ninguna OTRA alta ni promoción de la MISMA
-- temporada corre a la vez. La medición de la carrera con `removeSeat`
-- (30/200 contra `shift_seeds_up`, 29/200 contra `shift_season_seeds_up`,
-- básicamente la misma probabilidad) queda escrita en `db/entries.ts`,
-- junto a `removeSeat`, que es donde el próximo que la toque la va a leer.
create or replace function public.add_squad_seat(
  p_season uuid, p_name text, p_before uuid default null,
  p_disciplines uuid[] default null   -- null = todas las de la temporada
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_at int; v_disc uuid; v_season_at int;
begin
  if not public.is_season_admin(p_season) then
    raise exception 'Sólo quien organiza la temporada puede agregar un asiento.';
  end if;

  -- WU1 (tanda 5, round 3 review fix): advisory lock por temporada, PRIMERO
  -- de todo lo que sigue —antes de validar `p_name`/`p_before`, antes del
  -- insert en `entries`, antes de tocar `season_seed_order` o
  -- `discipline_entries`—. Reemplaza el `perform 1 from public.seasons ...
  -- for update` que WU5 (tanda 3, round 2 review fix) había agregado acá
  -- como mutex: esa fila era el mutex EQUIVOCADO, por tres motivos medidos
  -- en la ronda 3 de review:
  --
  --   B1 (auto-deadlock): el `insert into public.entries` de más abajo ya
  --   toma `FOR KEY SHARE` sobre esta MISMA fila de `seasons` —lo hace el
  --   trigger de la FK `entries_season_id_fkey`, no una línea visible acá—, y
  --   el `for update` que WU5 agregaba DESPUÉS la subía a exclusiva. Dos
  --   altas concurrentes a la misma temporada quedan cada una con su propio
  --   KEY SHARE y las dos esperando subir a FOR UPDATE — ninguna puede,
  --   deadlock. Reproducido determinísticamente con dos sesiones psql (una
  --   sola fila de `entries`, `insert` + `pg_sleep(2)` + el mismo `for
  --   update`): 1/1. Con el advisory lock ANTES del insert —nadie más entra
  --   a la sección hasta que la primera transacción termina—: 0/6 en el
  --   mismo repro.
  --
  --   B2 (orden opuesto con `promote_guest`): esta función toma `seasons` →
  --   `season_seed_order` → `discipline_entries`; `promote_guest` (0082)
  --   toma `discipline_entries` → `seasons` → `season_seed_order` — orden
  --   INVERTIDO, las dos hasta el commit. Un alta y una promoción
  --   concurrentes a la misma temporada, ambas con `p_before` sobre la misma
  --   disciplina, deadlockeaban cruzado — reproducido determinísticamente
  --   (`seasons for update` + sleep + `update discipline_entries` de un lado,
  --   al revés del otro): 1/1. El advisory lock, tomado PRIMERO en las DOS
  --   funciones, hace que las dos acuerden el mismo orden — no hay "opuesto"
  --   que romper: 0/6 en el mismo repro.
  --
  --   M3 (sobre-serialización): la fila de `seasons` es el padre de FK de
  --   TODA la temporada — lockearla con `for update` bloquea cualquier
  --   insert concurrente no relacionado que la referencie (otro
  --   `matchdays`, por ejemplo, vía su propio `FOR KEY SHARE`). Medido: un
  --   `insert into matchdays` concurrente esperó 1762 ms detrás del lock de
  --   `seasons`; con el advisory lock (que no toca esa fila) el mismo insert
  --   tardó 65 ms. Un advisory lock scopeado a la temporada por
  --   `hashtextextended` no es una fila real de ninguna tabla: sólo serializa
  --   a quien pida ESTE mismo lock (acá y en `promote_guest`), nunca a un
  --   insert que sólo referencia la temporada por FK.
  perform pg_advisory_xact_lock(hashtextextended(p_season::text, 0));

  if coalesce(p_name, '') !~ '\S' then
    raise exception 'El asiento necesita un nombre.';
  end if;

  -- Guard que 0013 ya tenía sobre `entries` y que el corrimiento a
  -- `discipline_entries` no puede perder: un `p_before` que no es NINGÚN
  -- asiento SQUAD de esta temporada se rechaza ENTERO, sin agregar nada — no
  -- alcanza con "no está en la disciplina que estoy iterando" (eso, más
  -- abajo, es el caso legítimo "no juega esta disciplina" y va al final ahí,
  -- no en todas).
  if p_before is not null then
    perform 1 from public.entries
     where id = p_before and season_id = p_season and kind = 'SQUAD';
    if not found then
      raise exception 'Ese jugador no está en el plantel.';
    end if;
  end if;

  -- C37: sin `seed_position`. El dual-write tail-only que 0023 dejó acá
  -- (`v_tail`, `max + 1`) escribía una réplica degradada del orden que ya
  -- nadie leía, y el CHECK `entries_seed_shape` del contract la va a
  -- prohibir. El orden REAL de este asiento se escribe en el loop de abajo,
  -- una fila de `discipline_entries` por disciplina — que es donde `p_before`
  -- posiciona de verdad desde PR 7.
  insert into public.entries (season_id, kind, display_name)
  values (p_season, 'SQUAD', trim(p_name)) returning id into v_id;

  -- El mutex que serializa dos altas concurrentes a la MISMA temporada —y
  -- evita que las dos lean el mismo `max(seed_position)` y la segunda choque
  -- contra `season_seed_order_seed` (23505)— ya se tomó arriba, con el
  -- advisory lock (WU1, tanda 5).
  --
  -- WU5 (tanda 7, BLOQUEA): lo que decía ACÁ ABAJO -- "no hace falta
  -- lockear nada más: para cuando se llega a este punto, esta transacción
  -- es la única corriendo esta sección para esta temporada" -- es FALSO, y
  -- lo era desde que se escribió. El advisory lock sólo serializa a quien
  -- lo PIDE -- esta función y `promote_guest`, las dos con el mismo hash de
  -- temporada -- no es un lock de tabla ni de fila, así que no le importa
  -- a nadie que no lo pida. `removeSeat` (`db/entries.ts`) es un
  -- `supabase.from('entries').delete()` que nunca lo toma: corre en
  -- paralelo, sin serializar con esta sección para nada.
  --
  -- Lo que el advisory de verdad garantiza es más angosto: que NINGUNA
  -- otra alta (`add_squad_seat`) ni promoción (`promote_guest`) de la
  -- MISMA temporada corre a la vez -- por eso el `max(seed_position)` que
  -- se lee abajo, para `season_seed_order`, no se pisa con el de otra
  -- transacción de ESE tipo. Contra `removeSeat` no hay ninguna garantía,
  -- y es la MISMA clase de carrera que el camino por disciplina
  -- (`shift_seeds_up`, más abajo) ya tenía desde 0023 -- "techo conocido y
  -- aceptado", sin arreglar acá tampoco. Medida (ver `db/entries.ts`,
  -- comentario de `removeSeat`): 30/200 para `removeSeat` ‖
  -- `shift_seeds_up`, 29/200 para `removeSeat` ‖ `shift_season_seeds_up` --
  -- básicamente la misma probabilidad, la misma causa.

  -- season_seed_order (0080): WU1 -- `p_before` corre la cola acá también,
  -- con `shift_season_seeds_up` (arriba). El caso "no tiene fila en
  -- season_seed_order" no debería darse -- `p_before` ya se validó arriba
  -- como un SQUAD real de esta temporada, y todo SQUAD tiene exactamente una
  -- fila acá (a diferencia de `discipline_entries`, donde "no juega esta
  -- disciplina" sí es legítimo) -- pero se cubre igual que el loop de abajo,
  -- al final, en vez de asumir `not null`.
  if p_before is null then
    select coalesce(max(seed_position), -1) + 1 into v_season_at
      from public.season_seed_order where season_id = p_season;
  else
    select seed_position into v_season_at from public.season_seed_order
     where season_id = p_season and entry_id = p_before for update;
    if v_season_at is null then
      select coalesce(max(seed_position), -1) + 1 into v_season_at
        from public.season_seed_order where season_id = p_season;
    else
      perform public.shift_season_seeds_up(p_season, v_season_at);
    end if;
  end if;
  insert into public.season_seed_order (season_id, entry_id, seed_position)
  values (p_season, v_id, v_season_at);

  for v_disc in
    select d.id from public.disciplines d
     where d.season_id = p_season and (p_disciplines is null or d.id = any(p_disciplines))
     order by d.position, d.created_at
  loop
    if p_before is null then
      select coalesce(max(seed_position), -1) + 1 into v_at
        from public.discipline_entries where discipline_id = v_disc;
    else
      select seed_position into v_at from public.discipline_entries
       where discipline_id = v_disc and entry_id = p_before for update;
      if v_at is null then
        -- El asiento de referencia no juega ESTA disciplina: va al final acá
        -- y en su lugar en las que sí. No hay lugar que respetar.
        select coalesce(max(seed_position), -1) + 1 into v_at
          from public.discipline_entries where discipline_id = v_disc;
      else
        perform public.shift_seeds_up(v_disc, v_at);
      end if;
    end if;
    insert into public.discipline_entries (discipline_id, entry_id, season_id, seed_position)
    values (v_disc, v_id, p_season, v_at);
  end loop;
  return v_id;
end;
$$;
