-- La RLS del partido casual (tablas en `0072_casual_matches.sql`): el helper
-- "¿jugué este partido?" y TODAS las políticas de las tres tablas, que lo
-- necesitan -- por eso viven acá y no en 0072 (regla "una función por
-- migración", `db/migrations.unit.test.ts`). Hasta esta migración las tablas
-- tenían RLS prendida y ninguna política: nadie veía nada.
--
-- Terreno nuevo: casi toda política de este repo se apoya en la temporada
-- (`is_participant`, `is_season_admin`, 0002_rls.sql) -- acá no hay ninguna.

-- Mismo molde que `is_participant` (0002_rls.sql:11): `security definer` y
-- `search_path = ''` con todo calificado. El definer es A PROPÓSITO y no por
-- costumbre: la política de lectura de `casual_match_players` pregunta "¿soy
-- uno de los jugadores de este partido?" leyendo `casual_match_players`, y
-- como invoker esa pregunta vuelve a pasar por la misma política -- recursión
-- infinita (`42P17`). Como definer la lectura de adentro saltea la RLS (el
-- dueño de la tabla no la sufre) y la pregunta se contesta una sola vez.
create function public.is_casual_participant(p_match uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.casual_match_players
     where match_id = p_match
       and player_id = public.my_player_id()
  )
$$;

-- Postgres otorga EXECUTE a PUBLIC en toda función nueva (0002_rls.sql:83-93).
-- `authenticated` SÍ la necesita: una política corre con los permisos de quien
-- consulta, así que sin este grant toda lectura de las tres tablas fallaría
-- con "permission denied for function".
revoke execute on function public.is_casual_participant(uuid) from public, anon;
grant execute on function public.is_casual_participant(uuid) to authenticated;

-- ── casual_matches ─────────────────────────────────────────────────────────
-- ESTA política y el `using` de `casual_matches_update`/`_delete` de más
-- abajo están acoplados, y quien toque cualquiera de las tres tiene que
-- saberlo: ningún camino de escritura real de esta app puede invocar un
-- UPDATE/DELETE sin `WHERE` -- `safeupdate`, una librería precargada en el
-- rol `authenticator` de Supabase (`session_preload_libraries=supautils,
-- safeupdate` en `pg_roles.rolconfig` de ese rol), lo rechaza con SQLSTATE
-- 21000 (`cardinality_violation`) DENTRO de Postgres antes de que la
-- sentencia corra -- y todo UPDATE/DELETE con `WHERE` sobre esta tabla
-- ANDea el `using` de la política de SELECT junto con el de su propio
-- comando (verificado en vivo, incluso con un filtro que no apunta a una
-- fila puntual). Como resultado, `casual_matches_update.using` y
-- `casual_matches_delete.using` NUNCA actúan solos hoy: EL DÍA QUE ESTA
-- política se ensanche, esos dos `using` pasan de redundantes a única
-- puerta. Repetir esta advertencia si se toca cualquiera de las tres.
--
-- `created_by = my_player_id()` además de "soy participante": la RPC
-- (0092) inserta el partido ANTES que sus jugadores, y la política de
-- insert de `casual_match_players` de abajo pregunta "¿este partido es
-- mío?" leyendo esta tabla -- en ese momento todavía no hay jugadores, así
-- que sin esta rama el creador no vería su propio partido recién creado.
-- No ensancha nada en régimen: el trigger de forma (0091) exige que quien
-- carga sea uno de los jugadores.
create policy casual_matches_read on public.casual_matches
  for select to authenticated
  using (created_by = public.my_player_id() or public.is_casual_participant(id));

-- Cargar: sólo a tu nombre. Quién más juega, y si son amigos, lo decide la
-- política de `casual_match_players` de abajo -- el partido sin jugadores no
-- sobrevive al commit (trigger de forma, 0091).
create policy casual_matches_insert on public.casual_matches
  for insert to authenticated
  with check (
    created_by = public.my_player_id()
    and updated_by = public.my_player_id()
  );

-- Actualizar: cualquiera de los que jugaron puede editar (§3.1), y el
-- `with check` sólo exige dejar asentado quién tocó último. NO repite la
-- puerta de amistad: la puerta de amistad aceptada (§4.5) es de alta, no de
-- por vida. Un jugador cuya amistad se borró después de cargar el partido lo
-- sigue pudiendo editar -- es §4.5 funcionando como se diseñó ("dejar de ser
-- amigos no borra los partidos ya cargados. Es historia.").
create policy casual_matches_update on public.casual_matches
  for update to authenticated
  using (public.is_casual_participant(id))
  with check (updated_by = public.my_player_id());

-- Borrar: cualquiera de los que jugaron, en cualquier momento (§3.3) -- si tu
-- amigo te borra los partidos que perdió, es un problema de amigo, no de
-- software. Jugadores y sets se van con él (`on delete cascade`).
create policy casual_matches_delete on public.casual_matches
  for delete to authenticated
  using (public.is_casual_participant(id));

-- ── casual_match_players ───────────────────────────────────────────────────
-- Leer: los jugadores de un partido los ve quien lo jugó, y nadie más -- ni
-- un amigo tuyo que no estuvo.
create policy casual_match_players_read on public.casual_match_players
  for select to authenticated
  using (public.is_casual_participant(match_id));

-- La puerta §4.5, movida de tabla: antes vivía en el insert de
-- `casual_matches` (los dos jugadores eran columnas de esa fila); ahora cada
-- jugador es una fila de acá, y la puerta se pide POR JUGADOR. Éste es el
-- párrafo más importante de la migración.
--
-- Leer el historial NO chequea amistad, y está bien: la RLS de `matches` ya
-- acota todo a temporadas donde el que consulta participa -- el partido de
-- torneo tiene esa RLS aguas arriba respaldándolo. EL CASUAL NO TIENE
-- NINGUNA. Si este insert sólo pidiera "el partido es mío", cualquiera
-- fabrica "le gané 5-0 a [player_id de cualquiera]" contra un desconocido, y
-- esa persona lo ve en su propio historial, porque la lectura está abierta a
-- los jugadores a propósito. La rama de amistad no es una formalidad: es un
-- canal de acoso, y esto lo cierra. Sin una amistad ACEPTADA entre quien
-- carga y cada jugador con cuenta, no hay insert.
--
-- Las tres ramas del `or`: un invitado (`player_id is null`, sólo un nombre,
-- no aparece en el historial de nadie), yo mismo, o alguien con quien tengo
-- una amistad aceptada. `least`/`greatest` arman el par en el MISMO orden
-- canónico que `friendships` (`player_a < player_b`, 0070) -- un `or` con el
-- par al revés no hace falta. Y `casual_match_players.player_id`/`.match_id`,
-- calificados, son necesarios y no cosméticos: dentro de un `exists`, una
-- columna sin calificar puede resolver contra la tabla de la subconsulta en
-- vez de contra la fila que se está insertando, y la puerta quedaría
-- comparando una columna contra sí misma.
--
-- "El partido es MÍO" (no "lo jugué"): sólo quien cargó suma jugadores, y
-- SÓLO en la transacción que creó el partido: `m.created_at = now()`, y
-- `now()` es el comienzo de la transacción en curso, así que eso sólo es
-- cierto adentro de la misma llamada a la RPC (0092) que insertó la fila. El
-- plantel es fijo: sin esta condición, quien cargó podía sumar dos filas en un
-- request posterior y convertir un 1v1 en un 2v2 que el trigger de forma
-- (0091) acepta. Funciona porque nadie puede escribir `created_at`: no está en
-- el grant de insert (0072) ni en el de update. Los demás jugadores no meten a
-- nadie nunca, y no hay grant de update/delete, así que tampoco se saca.
create policy casual_match_players_insert on public.casual_match_players
  for insert to authenticated
  with check (
    exists (
      select 1
        from public.casual_matches m
       where m.id = casual_match_players.match_id
         and m.created_by = public.my_player_id()
         and m.created_at = now()
    )
    and (
      casual_match_players.player_id is null
      or casual_match_players.player_id = public.my_player_id()
      or exists (
        select 1
          from public.friendships f
         where f.player_a = least(public.my_player_id(), casual_match_players.player_id)
           and f.player_b = greatest(public.my_player_id(), casual_match_players.player_id)
           and f.accepted_at is not null
      )
    )
  );

-- ── casual_match_sets ──────────────────────────────────────────────────────
-- Los sets son del partido: los ve, carga y reemplaza quien lo jugó. Editar
-- es borrar e insertar (no hay grant de update), siempre dentro de la RPC.
create policy casual_match_sets_read on public.casual_match_sets
  for select to authenticated
  using (public.is_casual_participant(match_id));

create policy casual_match_sets_insert on public.casual_match_sets
  for insert to authenticated
  with check (public.is_casual_participant(match_id));

create policy casual_match_sets_delete on public.casual_match_sets
  for delete to authenticated
  using (public.is_casual_participant(match_id));
