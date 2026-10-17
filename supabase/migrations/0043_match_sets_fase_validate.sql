-- Archivo SEPARADO a propósito (secuencia_expand_contract del design #3801):
-- `not valid` + `validate` en el MISMO archivo no compra nada -- el patrón
-- sólo paga con los dos pasos en transacciones distintas. Mismo criterio que
-- 0034/0035 para estas dos mismas tablas.
alter table public.match_sets validate constraint match_sets_match_fase;
alter table public.match_sets validate constraint match_sets_no_draw;
