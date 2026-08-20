-- ── matchdays.formato (REQ-D8-1, Rebanada C1) ────────────────────────────────
-- Cómo se arma una fecha: `ROUND_ROBIN` (todos contra todos, de siempre) o
-- `GROUPS_KNOCKOUT` (grupos + llave, W32/decisión #3863). Vive en la FECHA,
-- no en la disciplina: se elige por fecha, no queda fijo para toda la
-- disciplina (design PUNTO 7, #3801).
--
-- Default `ROUND_ROBIN`, y aditiva/plana igual que `0039` (matches.fase):
-- `matchdays` está lejísimos del umbral de ~100k filas donde el patrón
-- expand/contract paga algo. Con el default, una fecha de pádel recién
-- creada arranca en `ROUND_ROBIN` sin que ningún escritor existente lo
-- declare — REQ-D7-1, no-regresión.
alter table public.matchdays
  add column formato jsonb not null default '{"kind":"ROUND_ROBIN"}'::jsonb,
  add constraint matchdays_formato_kind
    check (formato ->> 'kind' in ('ROUND_ROBIN', 'GROUPS_KNOCKOUT'));

-- CUARTO column-grant de la misma trampa (`discipline_id` 0015, `pair_size`
-- 0028, `allows_draw` 0034): `matchdays` tiene grants a nivel COLUMNA
-- (0002_rls.sql:236-238), y sin el grant un insert/update de `authenticated`
-- que manda `formato` falla con "permission denied for table matchdays" — un
-- mensaje que NO nombra la columna.
--
-- A diferencia de los otros tres, éste es el ÚNICO que también necesita
-- `grant update`: el formato se elige DESPUÉS de crear la fecha, ANTES de
-- armar (REQ-D8-1, "editable antes de armar") — los otros tres se fijan al
-- crear y no cambian más. Test db obligatorio para los dos verbos, con
-- `authenticated`, nunca `service_role`.
grant insert (formato) on public.matchdays to authenticated;
grant update (formato) on public.matchdays to authenticated;
