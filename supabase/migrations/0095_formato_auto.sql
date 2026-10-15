-- docs/plan-torneos-deportes.md (Tarea 2), docs/torneos-deportes.md §7 y §9:
-- "Automático" es un formato más. Mientras la fecha se arma, la pantalla
-- muestra lo que `suggestFormat` calcularía con los presentes; al confirmar el
-- armado (`openMatchday`) se guarda el formato CONCRETO.
--
-- Por eso `AUTO` entra en los dos CHECK de forma (`disciplines_formato_default_kind`,
-- 0074, y `matchdays_formato_kind`, 0040) con el mismo CASE anidado de siempre,
-- y una fecha sólo puede estar en `AUTO` mientras está en DRAFT
-- (`matchdays_formato_auto_draft`): nunca sale de armado sin resolverse. Que
-- el formato de una fecha no cambie fuera de DRAFT ya lo garantiza 0045.
--
-- `drop constraint` sin `if exists`: si un nombre estuviera mal, que falle fuerte.
alter table public.disciplines
  drop constraint disciplines_formato_default_kind,
  add constraint disciplines_formato_default_kind check (
    case formato_default ->> 'kind'
      when 'AUTO' then true
      when 'ROUND_ROBIN' then true
      when 'GROUPS_KNOCKOUT' then
        case
          when (formato_default ->> 'groups') ~ '^[0-9]+$'
           and (formato_default ->> 'qualifiersPerGroup') ~ '^[0-9]+$'
          then (formato_default ->> 'groups')::int in (2, 4)
           and (formato_default ->> 'qualifiersPerGroup')::int = 2
          else false
        end
      else false
    end);

alter table public.matchdays
  drop constraint matchdays_formato_kind,
  add constraint matchdays_formato_kind check (
    case formato ->> 'kind'
      when 'AUTO' then true
      when 'ROUND_ROBIN' then true
      when 'GROUPS_KNOCKOUT' then
        case
          when (formato ->> 'groups') ~ '^[0-9]+$'
           and (formato ->> 'qualifiersPerGroup') ~ '^[0-9]+$'
          then (formato ->> 'groups')::int in (1, 2, 4)
           and (formato ->> 'qualifiersPerGroup')::int = 2
          else false
        end
      else false
    end),
  -- `AUTO` se resuelve al confirmar el armado (`openMatchday`): una fecha nunca sale de DRAFT en AUTO.
  add constraint matchdays_formato_auto_draft check (formato ->> 'kind' <> 'AUTO' or status = 'DRAFT');
