-- ── season_invite ordena por season_seed_order, no por la primaria ─────────
-- (torneo-multi-disciplina, tanda 1). Restatement quirúrgico de la
-- definición viva (0063_season_invite_no_entries_seed.sql), verificada
-- contra `pg_get_functiondef` antes de copiarla.
--
-- 0063 dejó a `season_invite` ordenando por `discipline_entries` de la
-- disciplina PRIMARIA de la temporada (decisión #4044). Esa respuesta era
-- correcta mientras el orden de cada disciplina fuera siempre el mismo, y
-- deja de serlo con `seedNames` (PR anterior a esta): una primaria con
-- orden propio secuestraba en silencio la pantalla de Unirse, exactamente
-- el mismo síntoma que 0026 corrigió en su momento contra
-- `entries.seed_position` — acá el problema reaparece un nivel más arriba.
--
-- Cambian exactamente dos cosas:
--
--   1. El `left join` deja de resolver "la disciplina por defecto" contra
--      `discipline_entries` — pasa a ser un `left join` directo contra
--      `season_seed_order` (0080_season_seed_order.sql) por
--      `(entry_id, season_id)`. Ninguna disciplina interviene.
--   2. La columna `seed_position` del `returns table` pasa a ser
--      `sso.seed_position` — el mismo campo con el mismo tipo, otra fuente.
--
-- El `order by` no pierde su forma: sigue siendo "quien no tiene fila va al
-- final, los demás por su posición, y `entry_id` como desempate final para
-- que el orden entre los que no tienen fila sea determinístico" — el mismo
-- criterio de 0063, ahora sobre `season_seed_order` en vez de
-- `discipline_entries`.
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
         sso.seed_position,
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
    left join public.season_seed_order sso
      on sso.entry_id = e.id and sso.season_id = s.id
   where s.invite_token = p_token
   order by (sso.seed_position is null), sso.seed_position, e.id
$$;
