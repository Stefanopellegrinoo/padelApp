-- ── create_discipline_team — arma un equipo fijo, serializado ──────────────
-- Ronda de fix (review a ciegas, BLOQUEA 1, docs/tipos-de-torneo.md §1). El
-- chequeo de aplicación que `createTeam` tenía (`db/discipline-teams.ts`,
-- el `Set` armado desde `teamsOf`) mira `discipline_teams`, decide "está
-- libre" y DESPUÉS inserta -- dos consultas separadas, sin nada que las
-- una. Medido, 7/7 rondas, 100% reproducible: `createTeam(a,b)` y
-- `createTeam(b,c)` en paralelo para la MISMA disciplina -- las DOS leen
-- `taken = []` antes de que cualquiera inserte, `unique(discipline_id,
-- entry_a)` ve `{a,b}` y `unique(discipline_id, entry_b)` ve `{b,c}`, así
-- que ninguna choca -- y `b` termina en DOS equipos. Alcanzable por el
-- mismo admin en dos pestañas, no hace falta un atacante.
--
-- El chequeo y el insert tienen que viajar en la MISMA transacción,
-- serializados -- mismo patrón que `add_squad_seat` (0013/0061) y
-- `promote_guest` (0014): un `select ... for update` sobre la fila que
-- las dos llamadas comparten hace que la SEGUNDA espere a que la PRIMERA
-- termine (commit o rollback) antes de leer nada, así que para cuando lee
-- el estado es el real, no uno stale. Acá la fila compartida es
-- `disciplines` por `id = p_discipline`: más ancho que "sólo las dos
-- personas de este alta" (traba TODAS las altas de esta disciplina, no
-- sólo las que se pisan), mismo criterio que `promote_guest` trabando la
-- fecha ENTERA para cualquier cambio de invitados.
--
-- Alternativas declarativas, descartadas y medidas antes de escribir esto:
--   - Un `check` es de una fila, no puede comparar contra las demás filas
--     de la tabla.
--   - Ningún índice de expresión hace único un PAR de personas a través de
--     dos ROLES distintos (`entry_a` en una fila, `entry_b` en otra) --
--     `unique(discipline_id, entry_a)` y `unique(discipline_id, entry_b)`
--     son exactamente ese intento, y por eso dejan la mitad cruzada sin
--     cubrir (`0068_fixed_teams.sql:56-58`).
--   - `exclude using gist` necesitaría la extensión `btree_gist` (no
--     instalada) más una opclass de igualdad para `uuid`, que no viene con
--     esa extensión.
--   - `insert ... select ... where not exists (...)` sigue siendo racy en
--     READ COMMITTED (el nivel de aislamiento default, y el que usa
--     PostgREST): dos transacciones pueden evaluar el mismo `where not
--     exists` como verdadero ANTES de que cualquiera de las dos commitee.
--
-- Los códigos que un insert normal ya tira (23514 misma persona, 23503 no
-- juega la disciplina, 23505 -- ahora sólo alcanzable si dos altas piden
-- lock al mismo tiempo y sobre la MISMA fila exacta de `disciplines`, lo
-- que el `for update` serializa de todos modos, así que en la práctica no
-- debería salir más) NO se traducen acá adentro: la traducción en
-- castellano se queda en `createTeam` (`db/discipline-teams.ts`), mismo
-- criterio que toda RPC de este repo (`db/entries.ts`, `db/matchday.ts`).
-- Los `raise exception` de acá abajo son SÓLO para lo que el insert solo no
-- puede rechazar: `fixed_teams` apagado, y "ya tiene equipo" bajo el lock.
create or replace function public.create_discipline_team(
  p_discipline uuid, p_season uuid, p_entry_a uuid, p_entry_b uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_fixed_teams boolean;
begin
  if not public.is_season_admin(p_season) then
    raise exception 'Sólo quien organiza puede armar equipos.';
  end if;

  select fixed_teams into v_fixed_teams
    from public.disciplines where id = p_discipline for update;
  if not coalesce(v_fixed_teams, false) then
    raise exception 'Esta disciplina no es de equipos fijos.';
  end if;

  if exists (
    select 1 from public.discipline_teams
     where discipline_id = p_discipline
       and (entry_a in (p_entry_a, p_entry_b) or entry_b in (p_entry_a, p_entry_b))
  ) then
    raise exception 'Alguien de los dos ya tiene equipo en esta disciplina.';
  end if;

  insert into public.discipline_teams (discipline_id, entry_a, entry_b, season_id)
  values (p_discipline, p_entry_a, p_entry_b, p_season)
  returning id into v_id;

  return v_id;
end;
$$;

-- Mismo par que TODA función nueva de este repo (`add_squad_seat`,
-- `0013_squad_seat_position.sql:187-188`): una función nueva NO nace
-- ejecutable por `authenticated` sola -- verificado contra la base
-- (`pg_default_acl` para el rol `postgres`, el que corre las migraciones,
-- da `{postgres=X/postgres}` para funciones nuevas, sin `authenticated` ni
-- `public`). Sin el `grant` de acá abajo, todo alta rebota con "permission
-- denied for function create_discipline_team" -- medido, exactamente ese
-- mensaje, antes de agregar esta línea.
revoke execute on function public.create_discipline_team(uuid, uuid, uuid, uuid) from public, anon;
grant  execute on function public.create_discipline_team(uuid, uuid, uuid, uuid) to authenticated;
