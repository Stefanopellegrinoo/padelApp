-- PR 20 rebanada A — contract de 0034: valida lo que quedó `not valid` ─────
--
-- Archivo separado a propósito (secuencia_expand_contract del design #3801):
-- `validate constraint` escanea la tabla entera para confirmar que ninguna
-- fila viola la constraint; correrlo en el MISMO archivo que el `add
-- constraint ... not valid` no ahorra nada — el punto del patrón es no tener
-- el scan largo adentro de la MISMA transacción que agrega la columna.
--
-- Backfill de 0034 ya dejó `match_sets.allows_draw` igual al de su partido (y
-- por transitividad, al de su fecha y su disciplina) para toda fila
-- existente, y ningún `match_sets` de producción hoy tiene `games_a =
-- games_b` (el check viejo, incondicional, lo impidió siempre). Las dos
-- validaciones de abajo tienen que pasar sin tocar una fila.
alter table public.match_sets validate constraint match_sets_match_draw;
alter table public.match_sets validate constraint match_sets_no_draw;
