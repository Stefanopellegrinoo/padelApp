-- ── close_matchday recupera el guard de v_regular is null (S97) ────────────
-- Restatement QUIRÚRGICO de la definición viva (`0056`), verificada contra
-- `pg_proc.prosrc` antes de copiarla — no contra el archivo.
--
-- **Va en una migración NUEVA y no editando `0056`** porque la cadena YA ESTÁ
-- PUSHEADA: mientras estuvo sin pushear, corregir una migración aplicada en
-- local era legítimo (convención del repo, #3981); desde el push esa libertad
-- se terminó y cualquier corrección de schema necesita su propio archivo.
--
-- Cambia SÓLO tres líneas: el `raise` que `0021` tenía y `0049` perdió al
-- mudar la lectura de `seasons` a `disciplines`. Los ocho guards que #4034
-- verificó por mutación sobre `0056` siguen byte a byte donde estaban.
--
-- Cierra la mitad de S97 que `0064` había dejado declarada como abierta: la
-- otra mitad (`create_discipline_masters`) ya está cerrada allá.
create or replace function public.close_matchday(p_matchday uuid, p_awards jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_season         uuid;
  v_discipline     uuid;
  v_status         text;
  v_kind           text;
  v_formato        jsonb;
  v_has_masters    boolean;
  v_regular        int;
  v_closed_regular int;
begin
  v_season := public.matchday_season(p_matchday);
  if v_season is null then
    raise exception 'La fecha no existe.';
  end if;
  if not public.is_season_admin(v_season) then
    raise exception 'Sólo quien organiza la temporada puede cerrar una fecha.';
  end if;

  select discipline_id, status, kind, formato into v_discipline, v_status, v_kind, v_formato
    from public.matchdays where id = p_matchday for update;

  if v_status <> 'OPEN' then
    raise exception 'Sólo se cierra una fecha que está en juego.';
  end if;

  -- Sin esto, un `p_awards` en null cierra la fecha sin repartir un solo punto
  -- y sin decir nada: `jsonb_array_length(null)` da null, el `if` de abajo no
  -- dispara, y `jsonb_array_elements(null)` no devuelve filas. La función la
  -- puede llamar cualquier admin por RPC, así que el payload se valida.
  if p_awards is null or jsonb_typeof(p_awards) <> 'array' then
    raise exception 'La lista de puntos llegó mal formada.';
  end if;

  -- El payload lo arma quien llama, y `p_awards` puede nombrar a cualquiera:
  -- sin este control, un admin paga puntos a un jugador que ni jugó esta
  -- fecha (o a cualquier uuid inventado). Sólo entra quien está en alguna
  -- pareja de la fecha que se está cerrando. `not exists` correlacionado,
  -- no `not in` sobre un `union`: ver comentario de cabecera de 0047.
  if exists (
    select 1
      from jsonb_array_elements(p_awards) as award
     where not exists (
       select 1
         from public.pairs p
        where p.matchday_id = p_matchday
          and (award ->> 'entryId')::uuid in (p.entry_a, p.entry_b)
     )
  ) then
    raise exception 'Hay puntos para alguien que no jugó esta fecha.';
  end if;

  -- El Masters no paga puntos: define al campeón del año (spec 2.7). Se cierra
  -- con la lista vacía y el campeón se deriva de los partidos, como todo.
  if v_kind = 'MASTERS' and jsonb_array_length(p_awards) > 0 then
    raise exception 'El Masters no reparte puntos.';
  end if;

  if exists (
    select 1
      from public.matches m
     where m.matchday_id = p_matchday
       and not exists (select 1 from public.match_sets s where s.match_id = m.id)
       -- La rendija (C31, ver comentario de cabecera de 0044): TERCER_PUESTO
       -- queda afuera de este chequeo SÓLO si la fecha sigue siendo la llave
       -- que lo generó (`formato.kind = 'GROUPS_KNOCKOUT'`). Con `ROUND_ROBIN`
       -- —incluida una fecha que LLEGÓ ahí después de tener una llave— no
       -- hay excepción: cualquier otra fase, y siempre en el pádel, sigue
       -- exigiendo resultado como hoy.
       and not (m.fase = 'TERCER_PUESTO' and v_formato ->> 'kind' = 'GROUPS_KNOCKOUT')
  ) then
    raise exception 'Faltan resultados por cargar.';
  end if;

  -- REQ-D10-1 (design #3801, decisión #15): el desglose de cada award tiene
  -- que sumar el total, o el histórico miente desde el día uno. Cruza dos
  -- "tablas" (el total de `award` y la suma de sus `lines`), así que no hay
  -- forma declarativa (CHECK de una sola fila) de expresarlo -- va acá, el
  -- único escritor de `awards`/`award_lines`.
  if exists (
    select 1
      from jsonb_array_elements(p_awards) as award
     where (award ->> 'points')::int is distinct from (
       select coalesce(sum((line ->> 'points')::int), 0)
         from jsonb_array_elements(coalesce(award -> 'lines', '[]'::jsonb)) as line
     )
  ) then
    raise exception 'El desglose no suma el total del premio.';
  end if;

  -- `season_id` no está en el bloque original del plan: la tabla lo exige
  -- (FK compuesta a `entries` y a `matchdays`) desde que el esquema se
  -- amplió después de escribirlo. Sin él, todo insert de awards falla.
  insert into public.awards (matchday_id, entry_id, season_id, position, points)
  select p_matchday,
         (award ->> 'entryId')::uuid,
         v_season,
         (award ->> 'position')::int,
         (award ->> 'points')::int
    from jsonb_array_elements(p_awards) as award;

  -- REQ-D10-1: una fila por línea del desglose, con el `ordinal` que le dio
  -- `with ordinality` (1-based) corrido a 0-based -- coherente con el
  -- `check (ordinal >= 0)` de la tabla.
  insert into public.award_lines (matchday_id, entry_id, ordinal, reason, points)
  select p_matchday, (award ->> 'entryId')::uuid, (line.ord - 1)::int,
         line.value ->> 'reason', (line.value ->> 'points')::int
    from jsonb_array_elements(p_awards) as award,
         lateral jsonb_array_elements(coalesce(award -> 'lines', '[]'::jsonb)) with ordinality as line(value, ord);

  update public.matchdays set status = 'CLOSED', closed_at = now() where id = p_matchday;

  -- El año se termina cuando se cierra el Masters, y en ningún otro momento
  -- salvo el caso de abajo (C34, decisión #4027): una disciplina sin Masters
  -- termina con su última fecha REGULAR. `seasons.status` ya no se toca en
  -- ninguna de las dos ramas.
  if v_kind = 'MASTERS' then
    update public.disciplines set status = 'FINISHED' where id = v_discipline;
  elsif v_kind = 'REGULAR' then
    select has_masters, (config ->> 'regularMatchdays')::int
      into v_has_masters, v_regular
      from public.disciplines where id = v_discipline;

    -- S97: el guard que `0049` perdió al mudar la lectura de `seasons` a
    -- `disciplines`. Sin él, un `config` sin `regularMatchdays` deja
    -- `v_regular` en NULL y el `if v_closed_regular >= v_regular` de abajo
    -- evalúa NULL -> falso: la disciplina NO TERMINA NUNCA, sin un error.
    -- Sólo se chequea en esta rama porque es la única que lo LEE.
    if v_regular is null then
      raise exception 'La disciplina no tiene definida la cantidad de fechas.';
    end if;

    -- El mismo trinquete, a nivel disciplina: es SU Masters el que terminó.
    if not v_has_masters then
      select count(*) into v_closed_regular
        from public.matchdays
       where discipline_id = v_discipline and kind = 'REGULAR' and status = 'CLOSED';

      if v_closed_regular >= v_regular then
        update public.disciplines set status = 'FINISHED' where id = v_discipline;
      end if;
    end if;
  end if;
end;
$$;
