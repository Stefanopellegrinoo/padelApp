-- docs/plan-registro-de-deportes.md (Tarea 3): el deporte es DATO de la app
-- (`core/sports.ts`), no de la base -- opción B del dueño. 0072 ya está
-- pusheada y no se reescribe; esto la enmienda.
--
-- Se van las tres constraints que nombran un deporte:
--   - el CHECK de la lista (`sport in ('PADEL','FIFA')`), que haría falta
--     tocar por cada deporte nuevo;
--   - `casual_teams_fifa` y `casual_padel_shape`: la forma de un resultado
--     es de la FAMILIA del deporte, que la base no conoce. La valida
--     `parseCasualResult` (db/friends.ts), el único camino de escritura.
-- Queda lo genérico: `casual_score_pair`, `casual_sets_no_draw`, equipos no
-- vacíos, `winner_side in ('A','B')`. Y se suma lo único que se puede decir
-- de un deporte sin nombrarlo: la forma de su id (mismo regex que
-- `core/sports.test.ts`). Las filas de hoy ('PADEL', 'FIFA') la cumplen.
--
-- ponytail: una RPC directa puede guardar un PADEL con goles en SU partido
-- (ya era así con los sets incoherentes, riesgo 9 de plan-amigos-deporte-y-2v2).
-- Si importa: un trigger que valide por familia, con la lista de familias en SQL.
alter table public.casual_matches
  drop constraint casual_matches_sport_check,
  drop constraint casual_teams_fifa,
  drop constraint casual_padel_shape,
  add constraint casual_sport_id check (sport ~ '^[A-Z][A-Z_]{0,31}$');
