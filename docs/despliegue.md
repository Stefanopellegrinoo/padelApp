# Poner la app en producción

Qué está hecho, qué falta y con qué credenciales. Lo que está acá no vive en
ningún otro lado: si este documento se pierde, hay que redescubrirlo.

---

## Lo que ya está

| | |
|---|---|
| **Código en GitHub** | [`Stefanopellegrinoo/padelApp`](https://github.com/Stefanopellegrinoo/padelApp), **privado**. `main` es la rama por defecto. Las otras ramas subidas son `feature/torneo-multi-disciplina` e `integracion/multi-disciplina-con-rapidos`, que es la que va a `main` en [El corte](#el-corte-a-producción). Las ramas de plan se borraron el 30/08: su contenido está adentro de `main` |
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
corrió encima **exactamente la secuencia que hace `scripts/corte-prod/corte.sh`**
(primero a mano y después con el script, de punta a punta):

- **No se perdió ni cambió nada.** Cada fila de antes sigue igual en las
  columnas que quedan, y las invariantes de `scripts/corte-prod/post.sql` dan
  24/24 OK. Los puntos (228) y los games (363) suman lo mismo.
- **Las pantallas son las mismas.** Se compararon 29: `main` sobre la copia sin
  migrar contra `integracion` sobre la copia migrada. Tablas, posiciones,
  puntos, fechas y stats de los dos torneos salieron idénticos byte a byte. Lo
  único que cambió fue el orden de los partidos dentro de una ronda, que tenía
  un desempate faltante y se arregló en `db/matchday.ts`.
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
   escrituras silenciosas. Por eso el merge va enseguida del push (con el POST
   en el medio, que tarda segundos), y nadie usa la app durante la ventana.

### Antes del día

- **`integracion` subida y actualizada** en el checkout desde donde se corre,
  con `node_modules` instalado.
- **El PR de `integracion` a `main` abierto, con el CI y el preview de Vercel en
  verde.** Así el merge es apretar un botón.
- **Docker corriendo:** `supabase db dump` lo usa.
- **Un lugar libre para un proyecto de Supabase.** La única vuelta atrás después
  de la `0066` es restaurar el backup en un proyecto nuevo (ver *Si algo sale
  mal*), y el plan free tiene un límite de proyectos activos. Saber de antemano
  cuál pausar si hace falta.

### El día del corte

1. **Avisar al grupo** que nadie use la app por unos 15 minutos, y sacar una
   captura de la tabla de cada torneo.
2. **Correr el script** desde el repo, en `integracion`:

   ```bash
   bash scripts/corte-prod/corte.sh
   ```

   Pide la URI de *Connect → Session pooler* (la que dice `[YOUR-PASSWORD]`) y
   la contraseña de la base, que no se ve al escribir. Después hace solo, en
   orden:
   - el backup y su validación: usuarios, todas las tablas y el historial;
   - el PRE;
   - el `migration repair`;
   - el dry run, comparado contra los archivos del repo.

   Hasta ahí no cambia ningún dato. **Antes de aplicar las migraciones pide
   escribir `CORTE`.** Después aplica y corre el POST. Si algo no da, frena,
   deshace lo que se puede deshacer y dice qué hacer. Ensayado sobre una copia
   de prod: tarda unos 20 segundos.
3. **Cuando diga `LISTO`, mergear el PR** de `integracion` a `main`. Vercel
   deploya solo.
4. **Con el deploy nuevo arriba, comparar la tabla de cada torneo** con las
   capturas. Si se ven bien, escribir `LIMPIAR` en el script: borra la foto
   `audit_pre`, que guarda una copia de los mails.
5. **Resetear la contraseña de la base** en el dashboard.

El backup queda en `~/backups/padelapp/<fecha_hora>-corte/`, junto con la salida
de cada paso (`pre.txt`, `dry-run.txt`, `push.txt`, `post.txt`).

**Nunca `supabase link`:** deja el repo apuntando a prod y un `db push`
distraído llega a la nube. El script se niega a correr si el repo está
linkeado.

### Si algo sale mal

- **El script frena antes de escribir `CORTE`.** Deshace solo: devuelve el
  historial al `.tsv` del backup y borra `audit_pre`. Prod queda exactamente
  como estaba; está probado comparando el catálogo y los datos. Si dice que
  **no** pudo restaurar el historial, el comando a mano es el de abajo, con `B`
  = la carpeta del backup. Antes, armar `PROD_DB_URL` con estas dos líneas,
  pegadas de a una (la contraseña se escapa porque puede tener `@`; la URI es
  la de *Connect → Session pooler*):

  ```bash
  printf 'Contraseña: '; IFS= read -rs PW; echo; ENC=$(printf %s "$PW" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read(),safe=""))'); echo "largo: ${#ENC}"
  ```

  ```bash
  export PROD_DB_URL="postgresql://postgres.<tu-proyecto-ref>:${ENC}@<host del pooler>:5432/postgres"; unset PW ENC
  ```

  ```bash
  if test -s "$B/schema_migrations.tsv"; then psql "$PROD_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -c 'delete from supabase_migrations.schema_migrations' -c "\copy supabase_migrations.schema_migrations from '$B/schema_migrations.tsv'"; else echo "NO EXISTE o está vacío: $B/schema_migrations.tsv — no se tocó nada"; fi
  ```

- **Falla el push.** Parar y no reintentar a ciegas. Quedan aplicadas las
  migraciones anteriores a la que falló (está en `push.txt`). La app queda sin
  usar hasta que se arregle el archivo en una rama, se re-ensaye sobre una copia
  y se vuelva a correr el push con `--include-all`, que sigue desde donde quedó.
  No se probó si el código de `main` anda con una cadena aplicada a medias.
- **El POST no da.** No mergear. La app está caída, pero nadie escribió nada
  nuevo, así que `audit_pre` y el backup siguen siendo todo lo que hay. Mandar
  `post.txt` antes de decidir entre arreglar hacia adelante o restaurar.
- **Algo no cuadra después del merge.** La vuelta atrás es completa: restaurar
  en un proyecto nuevo (abajo) y revertir el merge en `main`. Lo que se haya
  escrito desde el deploy se pierde. *Instant Rollback* solo no alcanza: el
  build viejo trae fija la URL de prod, y ese código no anda contra el esquema
  migrado.
- **Restaurar, sólo en un proyecto nuevo.** Restaurar encima de prod choca con
  las filas que ya están (`auth.users`) y con el esquema ya migrado, y eso no se
  ensayó. Lo que sí se ensayó, dos veces, es restaurar este dump en un stack
  vacío, que es lo que es un proyecto nuevo. Hacen falta tres ajustes:
  - sacar de `roles.sql` el `GRANT SET ON PARAMETER "log_min_messages"`, que
    sólo puede dar un superusuario;
  - sacar de `data.sql` los bloques `COPY` de auth o storage con 0 filas cuyas
    tablas no existan en la versión de destino;
  - **recrear a mano el trigger `on_auth_user_created`** sobre `auth.users`
    (está en `0003_new_user.sql`), porque `db dump` no exporta objetos del
    schema `auth`.

  Después, apuntar las dos variables de Vercel al proyecto nuevo y **hacer un
  redeploy de `main`** (el de antes del merge), porque las `NEXT_PUBLIC_*` se
  fijan en el build. Hay que repetir la config de Auth de las secciones de
  abajo (URLs, confirmación de mail, Google), porque no viene en el dump.

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
no hay que tocar build command ni output directory. El `vercel.json` del repo
sólo fija la región (`gru1`, São Paulo, la misma de la base).

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
