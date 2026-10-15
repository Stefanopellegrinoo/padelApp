-- docs/plan-torneos-deportes.md (Tarea 2), docs/torneos-deportes.md §7 y §9:
-- a cuánto se juega una fecha se elige al armarla y no se toca después. Una
-- fecha con resultados cargados a "1 set a 4" no puede pasar a "2 sets a 6"
-- por un PATCH directo: los resultados ya guardados dejarían de ser válidos.
--
-- Mismo molde que `matchdays_formato_immutable_after_draft` (0045), y por la
-- misma razón: `grant update (match_format)` (0096) deja escribir la columna
-- en CUALQUIER estado, y un guard sólo de aplicación no cubre el PATCH
-- directo. Un trigger y no un CHECK porque la regla compara `NEW` contra
-- `OLD` ("¿cambió, y en qué estado estaba ANTES?"). Corre para cualquier rol;
-- los RPC `security definer` (`open_matchday`, `close_matchday`,
-- `reopen_matchday`) no tocan `match_format`, así que no les molesta.
-- `is distinct from`: reenviar el mismo valor no es un cambio.
create or replace function public.matchdays_match_format_immutable_after_draft()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.match_format is distinct from old.match_format and old.status <> 'DRAFT' then
    raise exception 'A cuánto se juega la fecha sólo se cambia con la fecha en armado.';
  end if;
  return new;
end;
$$;

create trigger matchdays_match_format_immutable_after_draft
  before update on public.matchdays
  for each row execute function public.matchdays_match_format_immutable_after_draft();
