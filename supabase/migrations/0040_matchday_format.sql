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
--
-- El check exige la FORMA completa de `GROUPS_KNOCKOUT`, no sólo `kind`
-- (REQ-D5-1, "la BASE rechaza, no un `if` de aplicación"): sin esto,
-- `{"kind":"GROUPS_KNOCKOUT"}` a secas era una fila LEGAL, y con
-- `grant update` abierto (más abajo) cualquier `authenticated` la podía
-- escribir. `groupedMatches`/`groupSides` (`db/matchday.ts`,
-- `core/knockout.ts`) confían en esa forma sin volver a validarla, así que
-- una fila así llegaba hasta `generatePairs`, reventaba DESPUÉS de borrar y
-- reinsertar las parejas (S69: sin transacción) con un mensaje que culpa al
-- código cuando el problema es el dato.
--
-- `groups ∈ {1,2,4}` y `qualifiersPerGroup = 2` son EXACTAMENTE lo que
-- `knockoutMatchups` (`core/knockout.ts`) sabe armar — las dos listas están
-- acopladas A PROPÓSITO y tienen que moverse JUNTAS.
--
-- CORRECCIÓN (W81, verify-report-pr21-cierre #4016, el mismo día que se
-- escribió lo de arriba): esto NO son dos lugares, son TRES —
-- `offerableFormats` (`core/knockout.ts`) tenía su propia copia hardcodeada
-- (`[2, 4]`) que nadie ataba acá. Ahora `offerableFormats` DERIVA de
-- `KNOCKOUT_GROUP_COUNTS` (la misma constante que documenta lo que
-- `knockoutMatchups` sabe armar), así que si mañana `knockoutMatchups`
-- aprende a armar 8 grupos, los lugares que hay que tocar son ESTE check y
-- `KNOCKOUT_GROUP_COUNTS` — nada más, y `db/matchday-format.db.test.ts`
-- (W74+W81) los ata a los dos contra el catálogo real.
--
-- El CASE anidado (no un AND plano) es lo que hace que un `groups` no
-- numérico RECHACE la fila en vez de reventar en un error de casteo: la
-- rama `then` con el `::int` sólo se evalúa cuando el `when` de arriba ya
-- confirmó con una regexp que el valor son puros dígitos — un CHECK que TIRA
-- no es lo mismo que un CHECK que RECHAZA. Con `groups`/`qualifiersPerGroup`
-- ausentes (NULL), la regexp da NULL, el `when` no matchea (NULL no es
-- `true`), y cae al `else false` — nunca al `::int`.
alter table public.matchdays
  add column formato jsonb not null default '{"kind":"ROUND_ROBIN"}'::jsonb,
  add constraint matchdays_formato_kind
    check (
      case formato ->> 'kind'
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
      end
    );

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
