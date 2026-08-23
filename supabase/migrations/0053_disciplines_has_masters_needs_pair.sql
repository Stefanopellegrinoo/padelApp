-- Decisión de Stefano (#4029): `disciplines.has_masters` nace de `pair_size`
-- desde esta tanda (parte 1, TS: `addDiscipline`/`createSeason`) y se puede
-- editar en Ajustes (parte 2, TS: `updateDisciplineHasMasters`). La parte 3
-- es el guard: NO se puede ENCENDER el Masters en una disciplina de a uno —
-- `generateMastersPairs` (`db/matchday.ts:985`) rechaza siempre una fecha
-- MASTERS con `pair_size=1`, así que ofrecer el check encendido ahí sería
-- ofrecer algo que la app ya rechaza.
--
-- El guard de aplicación (`updateDisciplineHasMasters`) no alcanza solo:
-- `0015_disciplines.sql:70` da `grant update (config, weight, has_masters,
-- position) to authenticated` a nivel de COLUMNA, así que un `PATCH` directo
-- a `disciplines` lo saltea entero (#3989 — guards en serie: el de atrás
-- queda sin test si nadie prueba el camino que de verdad usa producción). Un
-- CHECK es declarativo y no necesita saber nada del resto de la app: no hay
-- forma de esquivarlo que no sea esquivar la tabla entera.
--
-- Backfill PRIMERO: las disciplinas de a uno que ya existen (PR21 en
-- adelante) nacieron con el default viejo (`has_masters=true`, 0015) porque
-- hasta la tanda anterior (C34/W87) nada la escribía. Sin este UPDATE el
-- `add constraint` de abajo fallaría contra cualquier fila así.
update public.disciplines set has_masters = false where pair_size = 1 and has_masters;

-- `not valid`: el patrón ya establecido para agregar un CHECK sobre una
-- tabla con filas existentes (`0028_side_size.sql` + `0029_side_size_validate.sql`,
-- `0042`+`0043`) — separar el `add constraint` (barato, sólo valida las
-- escrituras NUEVAS) del escaneo de la tabla completa (`validate constraint`,
-- migración separada) para no meter un scan largo adentro de la misma
-- transacción que agrega la regla.
alter table public.disciplines add constraint disciplines_has_masters_needs_pair
  check (not (has_masters and pair_size = 1)) not valid;
