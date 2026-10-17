-- ── season_invite deja de leer entries.seed_position (C37) ─────────────────
-- Restatement quirúrgico de la definición viva
-- (0026_season_invite_discipline_order.sql), verificada contra
-- `pg_get_functiondef` antes de copiarla.
--
-- 0026 ya había movido el ORDEN a `discipline_entries` de la primaria y dejó
-- `e.seed_position` en dos lugares, con una deuda anotada ahí mismo "para PR
-- 11/27": el último desempate del `order by`, y la COLUMNA que la función
-- devuelve. Esta es esa PR.
--
-- Cambian exactamente dos cosas:
--
--   1. La columna `seed_position` del `returns table` pasa a ser
--      `de.seed_position` — la posición REAL en la primaria, la misma con la
--      que ya venía ordenado. Devolvía `e.seed_position`, que desde `0060`
--      es `null` para todo el SQUAD: la pantalla de Unirse mostraba el
--      plantel bien ordenado y con la posición en blanco.
--   2. El `order by` pierde su tercer criterio (`e.seed_position`), que ya no
--      desempata nada. Los dos primeros no se tocan: quien no juega la
--      primaria sigue yendo al final (`de.seed_position is null`), que es el
--      criterio que la decisión #4044 generalizó a toda la app.
--
-- `entry_id` se agrega como desempate final para que el orden entre los que
-- NO juegan la primaria sea determinístico: antes lo daba `e.seed_position`.
--
-- La firma NO cambia (`season_invite(text)` con las mismas 9 columnas y los
-- mismos tipos), así que va `create or replace` y los grants sobreviven.
create or replace function public.season_invite(p_token text)
returns table (
  season_id     uuid,
  season_name   text,
  admin_name    text,
  squad_size    int,
  entry_id      uuid,
  display_name  text,
  seed_position int,
  claimed       boolean,
  disciplines   text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         s.name,
         admin.display_name,
         (select count(*)::int from public.entries e2
           where e2.season_id = s.id and e2.kind = 'SQUAD'),
         e.id,
         e.display_name,
         de.seed_position,
         e.player_id is not null,
         coalesce((
           select array_agg(d2.kind order by d2.position, d2.created_at)
             from public.discipline_entries de2
             join public.disciplines d2 on d2.id = de2.discipline_id
            where de2.entry_id = e.id
         ), array[]::text[])
    from public.seasons s
    join public.players admin on admin.user_id = s.created_by
    join public.entries e on e.season_id = s.id and e.kind = 'SQUAD'
    left join public.discipline_entries de
      on de.entry_id = e.id
     and de.discipline_id = (
           select d.id from public.disciplines d
            where d.season_id = s.id
            order by d.position, d.created_at
            limit 1
         )
   where s.invite_token = p_token
   order by (de.seed_position is null), de.seed_position, e.id
$$;
