-- Contract de 0077: valida lo que quedó `not valid`. Archivo separado a
-- propósito, mismo criterio que
-- `0054_disciplines_has_masters_needs_pair_validate.sql` -- `validate
-- constraint` escanea la tabla entera, y correrlo en la MISMA transacción
-- que agrega la regla no ahorra nada.
--
-- El argumento de 0077 (`fixed_teams` nace en `false` y no tenía escritor de
-- producción antes de esta rebanada) ya dice que esto pasa sin tocar una
-- fila real, en cualquier base.
alter table public.disciplines validate constraint disciplines_fixed_teams_needs_pair;
