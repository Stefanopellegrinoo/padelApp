-- W68 (verify-report-pr21, #4004): `grant update (formato)` (0040) deja
-- PATCHear `formato` en CUALQUIER estado, no sólo en DRAFT. `setMatchdayFormat`
-- (`db/matchday.ts`) ya rechaza el cambio fuera de DRAFT ("El formato sólo se
-- cambia con la fecha en armado.") pero ese guard es SÓLO de TypeScript —
-- medido con el MISMO usuario `authenticated` (season admin): un
-- `PATCH /matchdays?id=eq.X {"formato":…}` directo pasa en OPEN y en CLOSED.
--
-- Consecuencia medida: con una fecha ya armada y TODOS los resultados
-- cargados, un PATCH a otro `kind` la deja imposible de cerrar ("La llave
-- todavía no llegó a la final"); y con una fecha YA CERRADA, el mismo PATCH
-- la deja lista para que `reopen_matchday` + `close_matchday` la cierren de
-- vuelta con un formato distinto al que se jugó.
--
-- Mismo patrón que #3989 (guards en serie): un guard de aplicación no cubre
-- el PATCH directo — el arreglo tiene que vivir acá, donde PostgREST no
-- puede saltearlo. `0002_rls.sql:230-238` ya lo dice para las OTRAS columnas
-- de `matchdays`: "PostgREST no distingue qué columna se actualizó" — eso
-- resuelve QUÉ columna se puede tocar, pero no CUÁNDO. `formato` es la única
-- columna de `matchdays` con `grant update` (0040) y la única que necesita
-- ese "cuándo": las otras tres (`discipline_id`, `pair_size`, `allows_draw`)
-- sólo tienen `grant insert`, a propósito, y no llegan a esta pregunta.
--
-- Un trigger, no un CHECK: la regla compara `NEW` contra `OLD`
-- ("¿cambió, Y en qué estado estaba ANTES?"), y un CHECK CONSTRAINT no ve la
-- fila anterior. Corre para CUALQUIER rol, incluidos los RPC `security
-- definer` (`open_matchday`/`close_matchday`/`reopen_matchday`) — ninguno de
-- ellos toca `formato` en su propio UPDATE, así que `NEW.formato IS NOT
-- DISTINCT FROM OLD.formato` ahí siempre, y el trigger no les molesta.
create or replace function public.matchdays_formato_immutable_after_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.formato is distinct from old.formato and old.status <> 'DRAFT' then
    raise exception 'El formato sólo se cambia con la fecha en armado.';
  end if;
  return new;
end;
$$;

create trigger matchdays_formato_immutable_after_draft
  before update on public.matchdays
  for each row execute function public.matchdays_formato_immutable_after_draft();
