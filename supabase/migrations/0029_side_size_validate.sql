-- PR 14 slice C — contract de 0028: valida lo que quedó `not valid` ────────
--
-- Archivo separado a propósito (secuencia_expand_contract del design #3801):
-- `validate constraint` escanea la tabla entera para confirmar que ninguna
-- fila viola la constraint; correrlo en el MISMO archivo que el `add
-- constraint ... not valid` no ahorra nada — el punto del patrón es no tener
-- el scan largo adentro de la MISMA transacción que agrega la columna.
--
-- Backfill de 0028 ya dejó `pairs.pair_size` igual al de su matchday (y por
-- transitividad, al de su disciplina) para toda fila existente, y todo
-- `pairs` de producción hoy es `pair_size=2, entry_b not null` (pádel, el
-- único caso real hasta que exista un productor de lados de uno — PR15). Las
-- dos validaciones de abajo tienen que pasar sin tocar una fila.
alter table public.pairs validate constraint pairs_matchday_size;
alter table public.pairs validate constraint pairs_side_shape;
