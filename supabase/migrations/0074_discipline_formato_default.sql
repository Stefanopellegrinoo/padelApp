-- ── disciplines.formato_default (docs/tipos-de-torneo.md §2.5) ──────────────
-- Hoy el formato se elige POR FECHA: `matchdays.formato jsonb not null
-- default '{"kind":"ROUND_ROBIN"}'` (`0040_matchday_format.sql:45`), y
-- `disciplines` no tiene uno propio. Para FIFA —donde, en palabras de
-- Stefano, "siempre cerrás con campeón"— hay que elegir "grupos + llave" en
-- CADA fecha nueva, a mano, vía `setMatchdayFormat` (`db/matchday.ts`).
--
-- Arreglo (§2.5): un formato por default en `disciplines`, del que cada
-- fecha nueva hereda (`createMatchday`, `db/matchday.ts`). La fecha lo sigue
-- pudiendo pisar después: `setMatchdayFormat` no cambia.
--
-- `formato_default`, no `formato`: `disciplines.config` ya está expuesta en
-- Ajustes bajo el label "Formato" (`app/torneo/[id]/ajustes/formato.tsx`,
-- que edita `config` y `has_masters` — no esta elección ROUND_ROBIN/
-- GROUPS_KNOCKOUT). Llamar a esta columna `formato` pondría dos significados
-- distintos detrás de la misma palabra en la misma tabla.
--
-- Mismo tipo, mismo default que `matchdays.formato`:
-- `not null default '{"kind":"ROUND_ROBIN"}'::jsonb`. Sin backfill aparte:
-- un `alter table add column ... not null default ...` puebla las filas
-- YA EXISTENTES con ese default como parte de la propia sentencia, Postgres
-- no necesita un `update` separado para dejar la columna consistente. Y ese
-- default reproduce lo de hoy sin cambiar nada: toda fecha existente nació
-- bajo el default de columna de `matchdays.formato` (el mismo,
-- `ROUND_ROBIN`), así que toda disciplina que herede ESTE default entrega,
-- a partir de `createMatchday`, exactamente el mismo `ROUND_ROBIN` que ya
-- recibía.
--
-- El CHECK reusa el mismo CASE anidado que `matchdays_formato_kind`
-- (`0040_matchday_format.sql:46-60`): mismo guard con regexp antes del
-- `::int` — con `groups`/`qualifiersPerGroup` ausentes (NULL), la regexp da
-- NULL, el `when` no matchea (NULL no es `true`), y cae al `else false`,
-- nunca al `::int` (mismo mecanismo que `0040_matchday_format.sql:41-43`
-- describe para su propio CHECK).
--
-- La lista de `groups` NO es la misma: acá es `in (2, 4)`, sin el `1` que
-- `matchdays_formato_kind` sí acepta. Difiere a propósito de
-- `KNOCKOUT_GROUP_COUNTS` (`core/knockout.ts`, `[1, 2, 4]`), que es la lista
-- que ese otro CHECK sigue reflejando: `offerableFormats` (misma fuente)
-- excluye `groups: 1` SIEMPRE, incondicional y ANTES de mirar cuántos lados
-- hay (`core/knockout.ts:531`, decisión #4014 — "1 grupo + llave" nunca
-- ahorra nada sobre un round robin liso). `groups: 1` no es ofrecible para
-- NINGUNA cantidad de lados.
--
-- Hasta este cambio eso no importaba acá: el único escritor de
-- `matchdays.formato` era `setMatchdayFormat`, que rechaza cualquier valor
-- no ofrecible vía `formatoOfrecible` (`db/matchday.ts:337`) antes de
-- escribir, y `createMatchday` no mandaba la columna. Esta migración agrega
-- un SEGUNDO escritor de `matchdays.formato` —`createMatchday`, que copia
-- `formato_default`— que no pasa por ese guard. Sin el `1` afuera de ESTE
-- CHECK, un `formato_default` con `groups: 1` (legal para
-- `matchdays_formato_kind`, que sigue aceptando `1` sin cambios) nacería en
-- cada fecha nueva de esa disciplina ya rechazado por `setMatchdayFormat` y
-- por `generatePairs` — una fecha imposible de armar de fábrica, la tarea
-- manual exacta que §2.5 vino a sacar.
--
-- `groups: 4` sí se queda en la lista, a diferencia de `groups: 1`: si es
-- ofrecible depende de `smallestGroupSize(sides, 4) >= 3` (`core/knockout.ts`),
-- y `sides` es cuánta gente confirmó asistencia — un dato que no existe
-- todavía cuando se fija el `formato_default` de una disciplina (no hay
-- fecha, no hay `attendances`). Esa cuenta se queda donde siempre vivió, al
-- armar (`setMatchdayFormat`/`generatePairs`); este CHECK sólo excluye lo
-- que NINGÚN valor de `sides` vuelve ofrecible.
--
-- El CHECK es la única capa que un PATCH directo no puede saltear — mismo
-- argumento que ya hace `0045_matchdays_formato_immutable_after_draft.sql:14-16`
-- para su propio trigger. Validar contra `formatoOfrecible` en
-- `createMatchday`, en cambio, no sirve: a esa altura no hay `attendances`
-- todavía, `sides` es 0, y no hay nada real contra qué evaluarlo.
alter table public.disciplines
  add column formato_default jsonb not null default '{"kind":"ROUND_ROBIN"}'::jsonb,
  add constraint disciplines_formato_default_kind
    check (
      case formato_default ->> 'kind'
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
      end
    );

-- Grant de UPDATE, no de INSERT: nada escribe esta columna al CREAR una
-- disciplina todavía (`addDiscipline`/`createSeason`, `db/discipline.ts` /
-- `db/season.ts`, no la tocan en este cambio) — nace con el default de
-- columna de arriba. Se va a editar DESPUÉS de creada, desde una pantalla
-- que todavía no existe (fuera de este cambio) — mismo verbo que `config`/
-- `weight`/`has_masters`/`position` (`0015_disciplines.sql:70`) y que
-- `rules_text` (`0069_discipline_rules.sql:59`).
--
-- Una sola columna, no la lista entera: `0069_discipline_rules.sql`
-- (sección 3, "EL GRANT DE COLUMNA") ya lo dice de una: "`0015_disciplines.sql:69`
-- revoca UPDATE entero y `:70` regrant una lista de columnas con nombre.
-- Los grants de columna son aditivos, así que esta única sentencia es todo
-- el arreglo; `0015` no se edita (las migraciones son append-only)." Mismo
-- mecanismo acá con `formato_default`: no hace falta revocar ni repetir
-- `config`/`weight`/`has_masters`/`position`/`rules_text`, sólo sumar la
-- columna nueva.
--
-- Sin este grant: un `update` de `authenticated` que mande `formato_default`
-- falla con "permission denied for table disciplines" — mismo mensaje sin
-- nombre de columna que ya documentó el párrafo de grant de `0040`
-- (`0040_matchday_format.sql:62-66`) para `matchdays.formato`, y `0069` para
-- `rules_text`. Test db obligatorio para este grant, con `authenticated`,
-- nunca `service_role` (mismo criterio que `0040` para `matchdays.formato`).
grant update (formato_default) on public.disciplines to authenticated;
