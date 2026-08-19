# Poner la app en producción

Qué está hecho, qué falta y con qué credenciales. Lo que está acá no vive en
ningún otro lado: si este documento se pierde, hay que redescubrirlo.

---

## Lo que ya está

| | |
|---|---|
| **Código en GitHub** | [`Stefanopellegrinoo/padelApp`](https://github.com/Stefanopellegrinoo/padelApp), **privado**. `main` es la rama por defecto. También están subidas las tres ramas de plan que nombra `estado.md` |
| **Base de producción** | Supabase Cloud, proyecto **`padelApp`** — ref `<tu-proyecto-ref>`, región `sa-east-1` (São Paulo), plan free |
| **Las 10 migraciones** | Aplicadas y verificadas con SQL: 10 tablas, **las 10 con RLS**, 21 políticas, 15 funciones `security definer` |
| **La base está vacía** | 0 usuarios, 0 temporadas, y **sin el usuario del seed** — `supabase/seed.sql` nunca corre contra la nube |
| **El trigger de alta** | Probado **en producción**: un alta de prueba creó su `players` con el nombre del metadata. Después se borró |

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
