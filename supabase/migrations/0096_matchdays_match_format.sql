-- docs/plan-torneos-deportes.md (Tarea 2), docs/torneos-deportes.md §7 y §9:
-- cada fecha puede jugarse a un formato de partido PROPIO ("Fecha 3 · a 6
-- games"). Es opcional: `null` = usa el del deporte en el torneo, que vive en
-- `disciplines.config`. La app lee el efectivo con una sola regla.
--
-- Forma: `{ "setsToWin": n, "gamesPerSet": m }` y nada más. Lo único que la
-- base puede decir sin conocer deportes es que `setsToWin` va de 1 a 9 y
-- `gamesPerSet` de 1 a 99; los rangos de CADA deporte los valida la app
-- (`sportFormatError`), como 0093 deja la forma del resultado a
-- `parseCasualResult`. Esta migración no toca triggers ni funciones: que sólo
-- se cambie en DRAFT lo pone 0097.
alter table public.matchdays
  add column match_format jsonb,
  add constraint matchdays_match_format_shape check (
    case
      when match_format is null then true
      when jsonb_typeof(match_format) <> 'object' then false
      else match_format - 'setsToWin' - 'gamesPerSet' = '{}'::jsonb
       and coalesce((match_format ->> 'setsToWin') ~ '^[1-9]$', false)
       and coalesce((match_format ->> 'gamesPerSet') ~ '^[1-9][0-9]?$', false)
    end);

-- Los rangos por deporte los valida la app (`sportFormatError`): la base no conoce deportes (0093).
-- Igual que `formato` (0040), la escribe quien organiza vía RLS (`matchdays_write`).
grant update (match_format) on public.matchdays to authenticated;
