-- docs/plan-torneos-deportes.md (Tarea 2, ronda de arreglo), docs/torneos-deportes.md
-- §7 y §9: 0096 validaba `setsToWin` y `gamesPerSet` con `->>` (texto) y un
-- regex, así que un JSON de texto pasaba por número: `{"setsToWin":"2",
-- "gamesPerSet":"6"}` se guardaba, y la app, que lee `typeof === 'number'`,
-- lo habría tratado como un formato roto. 0096 ya está aplicada y no se
-- reescribe; esto la enmienda.
--
-- Mismo constraint, mismo nombre (los mensajes de error no cambian), mismo CASE
-- que 0096, más el tipo JSON de cada valor (`jsonb_typeof(...) = 'number'`,
-- como ya se hace en 0084). El `coalesce` es para que una clave que falta
-- dé `false` y no `null`: un CHECK en `null` pasa.
--
-- `not valid`: las filas nuevas y las que se actualicen se chequean; las que
-- ya existen no se re-escanean. En una base real 0096 y 0098 salen juntas y
-- ninguna fila tiene textos. La base local de desarrollo tiene 4 filas de
-- test de una corrida en rojo que la violan; una vez limpias,
-- `alter table public.matchdays validate constraint matchdays_match_format_shape;`
-- la deja validada del todo.
--
-- `drop constraint` sin `if exists`: si el nombre estuviera mal, que falle fuerte.
alter table public.matchdays
  drop constraint matchdays_match_format_shape,
  add constraint matchdays_match_format_shape check (
    case
      when match_format is null then true
      when jsonb_typeof(match_format) <> 'object' then false
      else match_format - 'setsToWin' - 'gamesPerSet' = '{}'::jsonb
       and coalesce(jsonb_typeof(match_format -> 'setsToWin') = 'number', false)
       and coalesce(jsonb_typeof(match_format -> 'gamesPerSet') = 'number', false)
       and coalesce((match_format ->> 'setsToWin') ~ '^[1-9]$', false)
       and coalesce((match_format ->> 'gamesPerSet') ~ '^[1-9][0-9]?$', false)
    end) not valid;
