-- security-hardening, S2 ─────────────────────────────────────────────────────
--
-- `authenticated` (y `anon`) pueden `TRUNCATE` cualquier tabla pública: RLS
-- no aplica a TRUNCATE (Postgres lo documenta explícitamente), así que un
-- participante cualquiera vacía `match_sets` —los resultados de TODAS las
-- temporadas, de todos los torneos— con un `set role authenticated; truncate
-- table public.match_sets;`. Ninguna política lo frena.
--
-- La fuente NO es el blanket grant de 0002_rls.sql:117 (que otorga sólo
-- select/insert/update/delete, sin TRUNCATE). Es `pg_default_acl` del rol
-- `postgres` (el que corre las migraciones): toda tabla NUEVA del esquema
-- `public` nace con `Dxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) para
-- `anon`/`authenticated`/`service_role`, y el grant de 0002 le suma `arwd`
-- encima, quedando `arwdDxtm`. 0080 ya revocó TRUNCATE en `season_seed_order`
-- (y dejó escrita la causa en su comentario); acá se extiende a TODAS las
-- tablas públicas.
--
-- `service_role` CONSERVA TRUNCATE: es el rol de administración, saltea RLS
-- por diseño y los andamios de `db/test/` escriben con esa llave. Por eso el
-- revoke es sólo de `authenticated` y `anon`.
--
-- No-destructivo y reversible (L5): no toca datos ni filas, sólo privilegios.

revoke truncate on all tables in schema public from authenticated, anon;

-- Para que una tabla FUTURA no nazca de nuevo con el hueco: se le saca
-- TRUNCATE al default privilege del rol que crea las tablas. Sigue dejando
-- el resto del `Dxtm` (REFERENCES, TRIGGER, MAINTAIN) y no toca a
-- `service_role`, que necesita TRUNCATE.
alter default privileges for role postgres in schema public
  revoke truncate on tables from authenticated, anon;
