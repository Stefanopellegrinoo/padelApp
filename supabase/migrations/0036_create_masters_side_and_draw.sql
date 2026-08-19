-- ── W61 (verify-report ronda 19) + S40 (ronda 12, re-medida por la 19):
-- `create_masters` inserta en `matchdays` sin `pair_size` NI `allows_draw`, y
-- las dos columnas están atadas a su disciplina por una FK compuesta ────────
--
-- `0028_side_size.sql` agregó `matchdays_discipline_size` y `0034_allows_draw
-- .sql` agregó `matchdays_discipline_draw`: las dos exigen que el valor de la
-- FECHA coincida con el de SU disciplina. El insert de `0021:72-73` manda
-- `(season_id, discipline_id, number, kind, played_on)` y nada más, así que
-- las dos columnas caen en su default (`2` y `false`) y la fila rebota contra
-- la FK apenas la disciplina no es un pádel de a dos sin empates:
--
--   disciplina pair_size = 1    → violates FK "matchdays_discipline_size"  (S40)
--   disciplina allows_draw = t  → violates FK "matchdays_discipline_draw"  (W61)
--
-- Es la MISMA línea rota dos veces, medido contra la base ejerciendo la
-- función real. Se cierran juntas porque separarlas dejaría la segunda
-- disparando en el mismo `insert` que la primera acaba de arreglar.
--
-- Es también la MISMA forma que el bug de PR18a (`insertPairs` sin
-- `pair_size`) y que la que esta tanda arregla en `createMatchday`: una
-- columna denormalizada con default de columna NO es opcional cuando hay una
-- FK compuesta del otro lado — el default es un valor tan explícito como
-- cualquier otro, y sólo casualmente es el correcto para el pádel.
--
-- El valor sale de la MISMA fila de `disciplines` que ya se lee para resolver
-- `v_discipline`: cero selects nuevos, y por construcción no puede
-- desalinearse de lo que la FK va a verificar.
--
-- Restatement quirúrgica: sólo cambia esa lectura y ese insert; el resto de la
-- función es byte a byte igual a `0021_create_masters_discipline_tiebreak.sql`
-- (y el criterio de desempate `order by position, created_at limit 1` que N1
-- introdujo ahí sigue intacto). `0021` define UNA sola función —verificado con
-- `rg '^create( or replace)? function|^drop function'` antes de copiar, que es
-- la trampa que `0025` le tendió a `0031`—, así que copiarla entera no
-- arrastra nada ajeno. `db/migrations.unit.test.ts` lo fija.
--
-- `create_masters` es `security definer`: los column-grants de `matchdays`
-- (`0034` agregó el de `allows_draw`) no la alcanzan ni le hacen falta.
create or replace function public.create_masters(p_season uuid, p_played_on date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_discipline  uuid;
  v_pair_size   int;
  v_allows_draw boolean;
  v_regular     int;
  v_closed      int;
  v_number      int;
  v_new         uuid;
begin
  if not public.is_season_admin(p_season) then
    raise exception 'Sólo quien organiza la temporada puede armar el Masters.';
  end if;

  select (config ->> 'regularMatchdays')::int into v_regular
    from public.seasons where id = p_season;
  if v_regular is null then
    raise exception 'La temporada no existe.';
  end if;

  select id, pair_size, allows_draw
    into v_discipline, v_pair_size, v_allows_draw
    from public.disciplines
   where season_id = p_season
   order by position, created_at
   limit 1;
  if v_discipline is null then
    raise exception 'La temporada no tiene disciplina.';
  end if;

  select count(*) into v_closed
    from public.matchdays
   where discipline_id = v_discipline and kind = 'REGULAR' and status = 'CLOSED';

  if v_closed < v_regular then
    raise exception 'El Masters se juega al terminar las % fechas: faltan %.',
      v_regular, v_regular - v_closed;
  end if;

  select coalesce(max(number), 0) + 1 into v_number
    from public.matchdays where discipline_id = v_discipline;

  -- `matchdays_one_masters` frena el segundo Masters y `matchdays_one_live`
  -- frena crearlo con otra fecha sin cerrar. Los dos levantan 23505; el borde
  -- de TypeScript traduce ese código a un mensaje que se pueda leer.
  --
  -- `pair_size` y `allows_draw` van EXPLÍCITOS (W61/S40): son las dos mitades
  -- variables de `matchdays_discipline_size` y `matchdays_discipline_draw`.
  insert into public.matchdays (season_id, discipline_id, number, kind, played_on, pair_size, allows_draw)
  values (p_season, v_discipline, v_number, 'MASTERS', p_played_on, v_pair_size, v_allows_draw)
  returning id into v_new;

  return v_new;
end;
$$;

-- Grants ya vivían para esta función (0016) y `create or replace` los
-- conserva; se repiten acá por explicitud y porque es el mismo idioma que ya
-- usan `0019` y `0021`.
revoke execute on function public.create_masters(uuid, date) from public, anon;
grant  execute on function public.create_masters(uuid, date) to authenticated;
