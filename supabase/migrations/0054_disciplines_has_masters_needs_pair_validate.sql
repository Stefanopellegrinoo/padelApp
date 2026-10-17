-- Contract de 0053: valida lo que quedó `not valid`. Archivo separado a
-- propósito, mismo criterio que `0029_side_size_validate.sql` -- `validate
-- constraint` escanea la tabla entera para confirmar que ninguna fila la
-- viola, y correrlo en el MISMO archivo que el `add constraint ... not
-- valid` no ahorra nada: el punto del patrón es no tener el scan largo
-- adentro de la MISMA transacción que agrega la columna/regla.
--
-- El backfill de 0053 ya dejó `has_masters=false` en toda fila existente con
-- `pair_size=1`, así que esto tiene que pasar sin tocar una fila.
alter table public.disciplines validate constraint disciplines_has_masters_needs_pair;
