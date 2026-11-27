-- amigos-faciles, S2-S3 (L13) ─────────────────────────────────────────────────
--
-- `players_with_account`: de una lista de jugadores, cuáles siguen teniendo
-- cuenta. Quien borró la suya (0108) queda con `players.user_id = null` y su
-- asiento intacto, así que la app lo seguía mostrando con "Agregar" en el
-- perfil del torneo y en "Gente de tus torneos" ("tienen cuenta"). La app no
-- puede leer `players.user_id` (0006, 0103) y así sigue: esta función da la
-- respuesta sin abrir la columna.
--
-- * Responde sólo por gente con la que quien llama ya tiene contexto: la
--   intersección con `player_display_names` (0103), con su misma regla. De un
--   extraño no dice nada, tenga cuenta o no; no sirve para averiguar si un id
--   cualquiera tiene cuenta.
-- * Devuelve ids que ya vinieron en `p_ids`, nunca un `user_id`.

create or replace function public.players_with_account(p_ids uuid[])
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
    from public.player_display_names(p_ids) v
    join public.players p on p.id = v.id
   where p.user_id is not null
$$;

revoke execute on function public.players_with_account(uuid[]) from public, anon;
grant  execute on function public.players_with_account(uuid[]) to authenticated;
