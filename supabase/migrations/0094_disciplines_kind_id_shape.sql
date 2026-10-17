-- docs/plan-torneos-deportes.md (Tarea 2), docs/torneos-deportes.md §9: un
-- torneo puede jugarse con CUALQUIER deporte del registro (`core/sports.ts`),
-- no sólo PADEL y FIFA. El deporte es dato de la app, no de la base (0093
-- hizo lo mismo con `casual_matches`); 0015 ya está pusheada y no se
-- reescribe, esto la enmienda.
--
-- Se va `disciplines_kind_check` (`kind in ('PADEL','FIFA')`), que habría que
-- tocar por cada deporte nuevo, y entra lo único que se puede decir de un
-- deporte sin nombrarlo: la forma de su id (mismo regex que 0093 y que
-- `core/sports.test.ts`). Las filas de hoy ('PADEL', 'FIFA') la cumplen.
--
-- `drop constraint` sin `if exists` a propósito: si el nombre estuviera mal,
-- la migración tiene que fallar fuerte, no pasar en silencio.
alter table public.disciplines
  drop constraint disciplines_kind_check,
  add constraint disciplines_kind_id check (kind ~ '^[A-Z][A-Z_]{0,31}$');
