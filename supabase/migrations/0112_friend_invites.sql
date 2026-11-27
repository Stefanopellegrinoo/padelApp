-- amigos-faciles, S5 (odd/tasks/amigos-faciles.md, T4) ──────────────────────
--
-- El link de amistad: un token por jugador. Quien lo abre y confirma queda
-- como su amigo al toque ("Amigos al toque": compartir el link ya es el sí,
-- como el link de invitación al torneo). Reemplaza al ID de 36 caracteres.
--
-- La tabla no se escribe directo: la crean, la cambian y la leen por token
-- cuatro funciones `security definer`, una por migración (0113-0116), que
-- sacan la identidad de `auth.uid()` y nunca la reciben por parámetro
-- (docs/historial-entre-amigos.md §6).
--
-- `token`: la misma entropía que el link del torneo (0105,
-- `replace(gen_random_uuid()::text, '-', '')`, 122 bits al azar). No es tu ID
-- ni sale de él: si se filtra, se cambia (0114) y el viejo deja de andar.
--
-- `user_id` es la cuenta dueña del link, y está por una sola razón: borrar la
-- cuenta. `delete_my_account` (0108) desvincula al jugador y después borra
-- `auth.users`; con la cascada de acá, ese mismo borrado se lleva el link, sin
-- reescribir 0108. Si el link colgara sólo de `players`, que queda vivo sin
-- cuenta, el nombre de alguien que se fue seguiría a la vista de quien tenga
-- el link. Lo ponen las funciones, siempre desde `auth.uid()`.
create table public.friend_invites (
  player_id  uuid primary key references public.players on delete cascade,
  user_id    uuid not null unique references auth.users on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_invites_token_shape check (token ~ '^[0-9a-f]{32}$')
);

alter table public.friend_invites enable row level security;

-- ── permisos ────────────────────────────────────────────────────────────────
-- Las dos cosas de siempre (0070): el grant a `authenticated`/`service_role`
-- y el `revoke all ... from anon`. A `authenticated` sólo le toca leer: sin
-- insert/update/delete no hay política que pueda colar una fila o un token
-- elegido a mano. El `revoke` de `authenticated` va primero para no depender
-- de los privilegios por defecto de la plataforma.
revoke all on public.friend_invites from anon, authenticated;
grant select on public.friend_invites to authenticated;
grant all on public.friend_invites to service_role;

-- ── políticas ───────────────────────────────────────────────────────────────
-- Cada uno lee sólo su propio link. El de otro se ve únicamente con el token
-- en la mano, y por `friend_invite_preview` (0115), que no lista nada.
create policy friend_invites_read on public.friend_invites
  for select to authenticated
  using (user_id = (select auth.uid()));
