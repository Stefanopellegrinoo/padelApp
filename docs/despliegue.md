# Poner la app en producción

Qué está hecho, qué falta y con qué credenciales. Lo que está acá no vive en
ningún otro lado: si este documento se pierde, hay que redescubrirlo.

---

## Lo que ya está

| | |
|---|---|
| **Código en GitHub** | [`Stefanopellegrinoo/padelApp`](https://github.com/Stefanopellegrinoo/padelApp), **privado**. `main` es la rama por defecto. La otra rama subida es `feature/torneo-multi-disciplina`. Las ramas de plan se borraron el 30/08: su contenido está adentro de `main` |
| **Base de producción** | Supabase Cloud, proyecto **`padelApp`** — ref `<tu-proyecto-ref>`, región `sa-east-1` (São Paulo), plan free |
| **Las migraciones aplicadas** | **15**: de `0001` a `0014`, más la `0089` (el hotfix del 11/09), o sea **exactamente `main`**. **Están registradas con timestamps**, no con el número del archivo (`20260811191556 schema` … `20260911214125 seasons_players_can_score`), así que el CLI no las reconoce: ver [El corte a producción](#el-corte-a-producción). Medido el 2026-10-17 contra `supabase_migrations.schema_migrations` |
| **La base TIENE datos reales** | Al 2026-10-17: 15 usuarios · 15 players · 2 torneos · 27 entries (22 del plantel) · 7 fechas (6 cerradas, 1 en armado) · 69 partidos · 54 sets · **52 premios otorgados**. `supabase/seed.sql` nunca corrió contra la nube: esto lo cargó gente usando la app |
| **El trigger de alta** | Probado **en producción**: un alta de prueba creó su `players` con el nombre del metadata. Después se borró |

> **Este cuadro es una FOTO, y ya mintió una vez.** Hasta el 2026-08-24 decía
> *"las 10 migraciones"* y *"la base está vacía: 0 usuarios, 0 temporadas"* —
> las dos cosas falsas, y sobre esa base se armó un análisis de riesgo
> equivocado para el merge a `main`. Antes de decidir cualquier cosa contra
> producción, **medila**, no la leas de acá:
>
> ```sql
> select count(*) from supabase_migrations.schema_migrations;  -- migraciones
> select count(*) from public.seasons;                          -- ¿vacía?
> ```
>
> Es el mismo error que el repo ya tiene documentado para las migraciones y
> para los verify-report: tomar un artefacto histórico por el estado presente.

---

## El corte a producción

`integracion/multi-disciplina-con-rapidos` trae de la `0015` a la `0099` (83
archivos) sin aplicar contra la nube. **Nada automatiza el `db push`**: el CI
levanta Supabase en el runner y no toca la nube. Y `vercel.json` no frena el
deploy, así que un merge a `main` sale a producción solo.

### Lo que demostró el ensayo (2026-10-17)

Con un dump de prod de ese día se armó una copia en un stack local aparte y se
corrió encima **exactamente la secuencia de abajo**:

- **No se perdió ni cambió nada.** Cada fila de antes sigue igual en las
  columnas que quedan, y las invariantes de `scripts/corte-prod/post.sql` dan
  24/24 OK. Los puntos (228) y los games (363) suman lo mismo.
- **Las pantallas son las mismas.** Se compararon 29: `main` sobre la copia sin
  migrar contra `integracion` sobre la copia migrada. Tablas, posiciones,
  puntos, fechas y stats de los dos torneos salieron idénticos byte a byte. Lo
  único que cambió fue el orden de los partidos dentro de una ronda, y eso ya
  está arreglado.
- **El push tarda unos 9 segundos.**

Tres cosas que descubrió el ensayo y que el guion ya resuelve:

1. **El historial de prod no coincide con los archivos.** Prod registró las
   migraciones con timestamps, así que `db push` se niega a correr
   (`Remote migration versions not found in local migrations directory`). Falla
   sin tocar nada. Para alinearlo está `migration repair`, que toca sólo
   `supabase_migrations.schema_migrations`. Se comprobó comparando el catálogo,
   el dump del esquema y un hash de los datos antes y después.
2. **Cada archivo corre en su propia transacción.** Si falla el archivo N,
   quedan aplicados de la 0015 a N-1 y el resto no se intenta. **Después de la
   `0066` no hay vuelta atrás sin restore**, porque borra `seasons.config` y
   `seasons.status`. Antes las copia a `disciplines`, que es por qué no se pierde
   nada.
3. **Entre el push y el deploy, el código de `main` da 500 en todas las
   páginas** (`column seasons.status does not exist`). Es una caída visible, no
   escrituras silenciosas. Por eso el merge va inmediatamente después del push,
   y nadie usa la app durante la ventana.

### El día del corte

Todo se corre desde un checkout de `integracion` con `node_modules`, para que
`npx supabase` use el CLI fijado en el repo y no uno bajado al vuelo. **Nunca
`supabase link`:** deja el repo apuntando a prod y un `db push` distraído
llega a la nube.

**0. Avisar al grupo:** unos 15 minutos sin usar la app. Sacar una captura de
la tabla de cada torneo para comparar al final.

**1. La URL de prod.** Sale de *Connect → Session pooler*; la conexión directa
es sólo IPv6. La contraseña se escapa porque puede tener `@`. Pegar las líneas
de a una (si se juntan dos, el `echo` imprime la contraseña):

```bash
printf 'Contraseña: '; read -rs PW; echo; ENC=$(printf %s "$PW" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read(),safe=""))'); echo "largo: ${#ENC}"
```

```bash
export PROD_DB_URL="postgresql://postgres.<tu-proyecto-ref>:${ENC}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres"; unset PW ENC
```

**2. Backup fresco, más el historial aparte:**

```bash
B=~/backups/padelapp/$(date +%F)-corte; mkdir -p "$B"
npx supabase db dump --db-url "$PROD_DB_URL" -f "$B/roles.sql" --role-only
npx supabase db dump --db-url "$PROD_DB_URL" -f "$B/schema.sql"
npx supabase db dump --db-url "$PROD_DB_URL" -f "$B/data.sql" --data-only --use-copy
psql "$PROD_DB_URL" -c "\copy supabase_migrations.schema_migrations to '$B/schema_migrations.tsv'"
rg -c '^COPY "auth"."users"' "$B/data.sql"   # tiene que dar 1
```

**3. PRE.** Congela todo en el schema `audit_pre` y chequea lo que haría fallar
a alguna migración. Lo que dice "debe dar 0" tiene que dar 0, y todos los
nombres tienen que dar `t`. Anotá las cantidades. Si algo no da, se para acá.

```bash
psql "$PROD_DB_URL" --single-transaction -f scripts/corte-prod/pre.sql
```

**4. Alinear el historial:**

```bash
npx supabase migration list --db-url "$PROD_DB_URL"   # los 15 timestamps aparecen sólo como remotos
npx supabase migration repair --db-url "$PROD_DB_URL" --status reverted 20260811191556 20260811191630 20260811191646 20260811191704 20260811191738 20260811191747 20260811191812 20260811191827 20260811192144 20260811193416 20260813214453 20260816144332 20260816144347 20260816144415 20260911214125
npx supabase migration repair --db-url "$PROD_DB_URL" --status applied 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013 0014 0089
```

**5. Dry run.** Tiene que listar 83 archivos, de la `0015` a la `0099`, **sin la
`0089`**. Si lista otra cosa, se para acá.

```bash
npx supabase db push --db-url "$PROD_DB_URL" --include-all --dry-run
```

**6. El push** (pide `[Y/n]`):

```bash
npx supabase db push --db-url "$PROD_DB_URL" --include-all
```

**7. Inmediatamente:** merge de `integracion` a `main` y push. Vercel deploya
solo.

**8. POST.** La sección A tiene que dar 0 / 0, la B todo OK, la C sólo las dos
constraints que nombra y la D vacía. Después, `migration list`: cada local con
su remoto.

```bash
psql "$PROD_DB_URL" --single-transaction -f scripts/corte-prod/post.sql
npx supabase migration list --db-url "$PROD_DB_URL"
```

**9.** Con el deploy nuevo arriba, comparar la tabla de cada torneo con las
capturas del paso 0.

**10. Limpiar.** Borrar `audit_pre`, que guarda una copia de los mails. Después
`unset PROD_DB_URL` y resetear la contraseña de la base.

```bash
psql "$PROD_DB_URL" -c 'drop schema audit_pre cascade'
```

### Si algo sale mal

- **Falla el PRE o el dry run.** No se tocó nada más que `audit_pre` (borrala).
  Si ya se corrió el repair, se vuelve el historial a como estaba con el `.tsv`
  del paso 2 (si cambiaste de terminal, volvé a definir `B`). Probado sobre la
  copia:

  ```bash
  psql "$PROD_DB_URL" --single-transaction -c 'delete from supabase_migrations.schema_migrations' -c "\copy supabase_migrations.schema_migrations from '$B/schema_migrations.tsv'"
  ```

- **Falla el push en el archivo N.** Parar y no reintentar a ciegas. Quedan
  aplicados de la 0015 a N-1. La app queda sin usar hasta que se arregle el
  archivo en una rama, se re-ensaye sobre una copia y se vuelva a correr
  `--include-all`, que sigue desde N. No se probó si el código de `main` anda
  con una cadena aplicada a medias.
- **El POST da FAIL o una tabla no coincide.** `audit_pre` tiene la foto de
  antes y el paso 2 el dump completo. Restaurar el dump en prod o en un
  proyecto nuevo (y cambiar las dos variables de Vercel) pide tres ajustes, los
  mismos del ensayo:
  - sacar de `roles.sql` el `GRANT SET ON PARAMETER "log_min_messages"`, que
    sólo puede dar un superusuario;
  - sacar de `data.sql` los bloques `COPY` de auth o storage con 0 filas cuyas
    tablas no existan en la versión de destino;
  - **recrear a mano el trigger `on_auth_user_created`** sobre `auth.users`
    (está en `0003_new_user.sql`), porque `db dump` no exporta objetos del
    schema `auth`.

---

## Las dos variables, y por qué son sólo dos

```
NEXT_PUBLIC_SUPABASE_URL=https://<tu-proyecto-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<tu-anon-key>
```

**La `service_role` key NO va al hosting.** Verificado: `SUPABASE_SERVICE_ROLE_KEY`
aparece únicamente en `db/test/admin.ts` y en las suites `.db.test.ts`. Nunca en
`app/`, ni en `db/client.ts`, ni en `db/server.ts`, ni en `middleware.ts`. Esa es
la propiedad que hace que subir esto sea seguro: la llave que saltea RLS no entra
al bundle.

La anon key es pública por diseño — va al navegador. Lo que protege los datos es
RLS, no el secreto de esa clave.

---

## Lo que falta, en orden

### 1. Vercel

Importar el repo y cargar las dos variables de arriba. Next 15 se detecta solo:
no hay que tocar build command ni output directory, y el repo no tiene
`vercel.json` ni lo necesita.

### 2. Las URLs de Auth, apenas exista el dominio

**Es lo que más se rompe y lo menos obvio.** Supabase tiene que conocer el
dominio de Vercel o el mail de confirmación y el flujo de OAuth rebotan.

Dashboard → **Authentication → URL Configuration**: cargar el dominio en
*Site URL* y en *Redirect URLs*.

### 3. La confirmación de mail

**Está prendida, medido:** un alta contra producción devolvió
`confirmation_sent_at` y **ningún `access_token`` — o sea que la persona se
registra y no entra hasta abrir el mail. En local está en `false`
(`supabase/config.toml`), por eso nunca se vio.

Para apagarla: **Authentication → Sign In / Providers → Email → "Confirm email"**.

Se decidió apagarla: el mail acá **no se usa para nada más que autenticar**. Lo
único que lo toca es `handle_new_user`, y sólo como tercer fallback del nombre
(`split_part(email, '@', 1)`), que no se usa nunca porque el registro siempre
manda `display_name`.

> Lo único a tener en cuenta el día que se construya **recuperar contraseña**
> —hoy `/login/recuperar` es un placeholder—: ahí el mail pasa a ser el canal de
> recuperación, y un mail mal tipeado deja a esa persona sin poder recuperar su
> cuenta. No es un agujero de seguridad, es una molestia para quien se equivocó.

### 4. Google OAuth

**El código está entero y no hay que tocar nada:** el botón en Login y Registro,
`signInWithOAuth` con el `redirectTo`, y `app/auth/callback/route.ts` que
intercambia el code por sesión. Falta sólo la credencial.

**a) Google Cloud** (`console.cloud.google.com`)

- *APIs y servicios → Pantalla de consentimiento OAuth*: tipo **Externo**,
  nombre, mail de soporte y de contacto. Queda en modo *Testing*, y ahí **sólo
  entran los mails agregados como usuarios de prueba** — si tiene que entrar
  cualquiera del grupo sin listarlo, hay que *Publicar*.
- *Credenciales → Crear credenciales → ID de cliente de OAuth →* **Aplicación web**.
- En **URI de redireccionamiento autorizados**, estas dos:

  ```
  https://<tu-proyecto-ref>.supabase.co/auth/v1/callback
  http://localhost:54321/auth/v1/callback
  ```

  **La URL es la de Supabase, no la de la app en Vercel.** Sin barra al final ni
  un caracter de más: si no coincide exacto, Google devuelve
  `redirect_uri_mismatch`, y es el error que más tiempo hace perder acá.

**b) Supabase** → *Authentication → Sign In / Providers → Google*: habilitar y
pegar el Client ID y el Client Secret.

**c) Para probarlo en local** (opcional): en `supabase/config.toml` ya está el
bloque `[auth.external.google]` listo, apagado. Poner el `client_id`,
`enabled = true`, y

```bash
export SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET="el-secret"
npm run db:start     # la config se lee al arrancar, no en caliente
```

**El secret no va en el archivo**, que está versionado — por eso la línea usa
`env(...)`.

**Dos cosas que ya están resueltas y no hay que tocar:** el nombre sale de Google
solo, porque `handle_new_user` usa `full_name` del metadata como segundo
fallback; y el `next` sobrevive el viaje, así que quien abre el link de
invitación sin cuenta y entra con Google vuelve a la invitación.

---

## Ni se te ocurra

- **Correr `npm run test:db` o `npm run db:reset` apuntando a producción.** Las
  suites borran y crean con `service_role`. Hay una guarda que lo impide
  (`db/test/env.ts` se niega si la URL no es local, probado en tres
  direcciones), pero la guarda cubre los tests, no un `psql` a mano.
- **Aplicar `supabase/seed.sql` a producción.** Crea `admin@demo.com` con la
  contraseña `demodemo` escrita en el archivo.

## ⚠ `.env.local` no parsea — hay que arreglarlo antes de correr nada

Al cerrar la sesión, `npm run db:reset` empezó a fallar con:

```
{"code":"LegacyDbConfigLoadError","message":"failed to parse environment file: .env.local"}
```

**Y con eso caen las 156 pruebas contra la base**, porque corren sobre el reset.
`npm run typecheck`, `npm test` (275) y `npm run build` siguen verdes: sólo se
cae lo que toca la base local.

**No lo causó ningún cambio del repo.** Se verificó sacando el bloque de Google
de `config.toml` por completo y el error queda igual, así que el problema está
en el archivo `.env.local` mismo, que no está versionado.

Qué mirar, en orden: una línea que no sea `VAR=valor`, un valor pegado en varias
líneas (una key JWT cortada), comillas sin cerrar, o un `=` en un valor sin
comillas. El archivo tiene que tener exactamente estas tres:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<la anon key que imprime `npm run db:start`>
SUPABASE_SERVICE_ROLE_KEY=<la service_role que imprime `npm run db:start`>
```

**Las tres apuntan a LOCAL.** Si alguna quedó apuntando a producción, sacala:
`db/test/env.ts` se niega a correr las suites igual, pero `psql` a mano no.

## Y una trampa del entorno que costó media hora

**Dos dev servers del mismo proyecto comparten `.next` y se corrompen entre
ellos.** El síntoma no dice eso: chunks de JS en 404, `Failed to find Server
Action`, y un login cuyo botón nunca se habilita porque React no hidrata. Antes
de culpar al código: `ss -ltnp | rg :300` y contar cuántos hay. Lo mismo pasa si
se corre `npm run build` con el dev server vivo, o `npm run dev` sobre un `.next`
de producción. Y para matarlos, por el PID que tiene el puerto — matar el wrapper
de `npm` deja `next-server` vivo.
