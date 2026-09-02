# Estado del proyecto

**Última actualización:** 31 de agosto de 2026. `torneo-multi-disciplina` terminada
y verificada en la rama, **sin publicar** — con el hotfix de producción
adentro (ver "Producción") y, desde ayer, con el SDD `reglas-por-disciplina`
también cerrado encima (seis commits, `8f1f04d`..`1bae705`: las reglas pasan a
ser por disciplina).

> **Lo que este documento describe abajo —planes 2, 3 y 4— es la app que está
> ONLINE hoy: un torneo, un deporte.** Encima de eso hay **una feature entera y todas las migraciones de la `0015` en adelante** en
> `feature/torneo-multi-disciplina` que la vuelven multi-disciplina y que
> todavía NO se publicaron. Lo de esa rama está en "Dónde estamos".

Este documento es el punto de entrada. Dice qué está hecho, qué falta, y qué hay
que decidir antes de seguir. Los detalles viven en los documentos que se enlazan.

---

## Producción

La base de producción existe y **tiene datos reales**: proyecto **`padelApp`** en
Supabase Cloud (`<tu-proyecto-ref>`, São Paulo), con **14 migraciones aplicadas**
—exactamente las de `main`— y **12 jugadores, 2 torneos activos, 3 fechas (2
cerradas) y 15 premios otorgados**. Medido el 2026-08-24, no asumido.

**`main` se movió el 28/08, y eso es nuevo desde esa foto.** El PR
[#16](https://github.com/Stefanopellegrinoo/padelApp/pull/16) (`5dd5794`) arregló
en producción que una fecha admita **más de un invitado suelto**, cada uno trabado
a un jugador distinto del torneo. **No trajo ninguna migración**, así que las 14
de arriba siguen siendo la cuenta exacta de `main` y no hace falta re-medir la
base por esto. Ese hotfix ya está adentro de `feature/torneo-multi-disciplina`
(merge `60c9418`, 30/08), probado en la app.

> **Este párrafo decía "las 10 migraciones" y "0 usuarios y 0 temporadas" hasta
> el 24/08.** Las dos cosas eran falsas y sobre ellas se armó un análisis de
> riesgo equivocado para publicar. **Antes de decidir algo contra producción,
> medila** — las dos consultas están en [`despliegue.md`](despliegue.md), que
> manda sobre todo esto.

**Lo que encontró subirla, y sólo pasa en la nube:** Supabase Cloud le otorga a
`anon` select/insert/update/delete sobre cada tabla nueva del schema `public`.
`0002_rls.sql` se los da explícitamente a `authenticated` y `service_role` y deja
a `anon` afuera *a propósito*, pero **nunca se los saca** — en local no hacía
falta, porque ahí las tablas nacen sin un solo privilegio. Medido antes de
arreglarlo: `anon` tenía SELECT sobre las nueve tablas del campeonato. No era
explotable —RLS prendida y ninguna política lo nombra— pero dejaba todo apoyado
en una sola línea de defensa. Lo cierra `0009_anon_surface.sql`, aplicada **en
local y en producción**. Después: `anon` con cero permisos de tabla y una sola
función, `season_public_rules`.

**El código está en GitHub:**
[`Stefanopellegrinoo/padelApp`](https://github.com/Stefanopellegrinoo/padelApp),
privado, con dos ramas: `main` y `feature/torneo-multi-disciplina`. Las
ramas de plan se borraron el 30/08 — su contenido está entero adentro de `main`.

**Lo que falta para que esté online está todo en
[`despliegue.md`](despliegue.md)**, con las credenciales y los pasos exactos:
Vercel con dos variables, las URLs de Auth apenas exista el dominio, apagar la
confirmación de mail —está prendida, medido contra producción— y las
credenciales de Google. **Ese documento manda para todo lo de producción**; acá
sólo se resume.

---

## Dónde estamos

| Plan | Qué produce | Estado |
|---|---|---|
| **1. `core/`** | Toda la lógica del campeonato, funciones puras | [Completado] **Terminado y en `main`** |
| **2. Datos y auth** | Schema Supabase, migraciones, RLS, login + Google | [Completado] **Terminado**, en `main` |
| **3. Pantallas de lectura** | Tabla, Fechas, Estadísticas, Reglas, Perfil | [Completado] **Terminado**, en `main` |
| **4. Pantallas de escritura** | Crear torneo, abrir fecha, cargar resultados, Ajustes, Masters | [Completado] **Terminado** (13 de 14 tareas; la 7 se descartó), en `main` |
| **5. `torneo-multi-disciplina`** | Un torneo con VARIAS disciplinas: pádel y FIFA, de a dos y de a uno, cada una con su formato, su tabla y su Masters | **Terminada y verificada, SIN PUBLICAR.** Rama `feature/torneo-multi-disciplina`, todas las migraciones de la `0015` en adelante |

> **Si estás retomando: hay DOS versiones de esta app y conviene no confundirlas.**
>
> **La que está ONLINE** es `main`: un torneo, un deporte. Terminada, jugada por
> gente de verdad — 12 jugadores y 2 torneos en producción.
>
> **La que está EN LA RAMA** es multi-disciplina: todas las migraciones de la `0015` en adelante, terminada
> y verificada (typecheck 0 · **826 tests · 446 tests de base** · navegador
> de punta a punta con `scripts/smoke.mjs`), **y deliberadamente sin
> publicar**. Los números subieron desde la foto anterior (770/425) porque
> después de ella se cerró **`reglas-por-disciplina`** — ver el párrafo de
> abajo. Publicarla son dos pasos que van JUNTOS —aplicar esas migraciones y
> mergear a `main`— porque el código viejo no sobrevive al schema nuevo: hay
> una ventana de unos 5 minutos con la app caída. El detalle está en
> [`despliegue.md`](despliegue.md), con el backup ya hecho.
>
> **Lo que agregó `reglas-por-disciplina` (30-31/08), encima de la rama:** las
> reglas dejaron de ser una sola por torneo. `disciplines.rules_text`
> (migración `0069`) más `narrateRules(config, shape)` corriendo una vez por
> disciplina hacen que la pantalla de Reglas —con sesión y sin ella— dibuje un
> bloque por disciplina, cada uno con su propio Masters, su propia regla de
> parejas, su propio empate y su propio tope de partidos. Con una sola
> disciplina (el 100% de lo que hay hoy) la pantalla sale byte a byte como
> salía antes — probado con `.toBe()` contra el HTML real, no asumido. Costo
> de despliegue: cero — `0069` toca `season_public_formats`, una función que
> todavía no existe en producción, así que no hay ventana que abrir. **No está
> commiteado a `main` ni pusheado**: vive entero en
> `feature/torneo-multi-disciplina`.
>
> **Lo que falta antes de publicar no es código: es que alguien la USE.** Los
> gates los corrió un agente; nadie recorrió todavía la app nueva a mano.
>
> Si en cambio venís a tocar código, lo que queda es la deuda chica del final de
> esta página. El detalle de cada decisión y cada desvío vive en "Dónde quedó la
> ejecución" y "Aparecidos" del
> el plan 4 (borrado en el commit de public release); esta página resume,
> ese documento manda.

**`core/` en números:** 23 módulos, 403 tests, cero dependencias de producción. (Eran 13 y 145 antes de multi-disciplina; 391 antes de `reglas-por-disciplina`, que sumó los 12 de `narrate`.)
Verificado de forma independiente: ningún archivo usa `Date`, `Math.random`,
`fetch` ni `process`; nada importa fuera de `core/`; el grafo de dependencias es
acíclico. Eso es lo que permite recalcular una fecha vieja y obtener exactamente
lo mismo que salió la noche que se jugó.

**El Plan 2 en números:** 5 migraciones, 10 tablas con RLS, 4 funciones `security
definer`, **215 tests unitarios y 92 contra la base**. `npm run build` compila.

**La superficie pública es `core/index.ts`.** Importar de una ruta profunda
funciona igual —TypeScript no lo puede impedir— pero lo que no está en el index
es detalle de implementación y puede cambiar sin aviso. Dos cosas quedaron
adentro a propósito: `allMatchings` (sólo la usa `buildPairs`) y `orderByPoints`
(los callers quieren `computeRanking`, que ya devuelve las filas ordenadas).

---

## Los documentos

| Documento | Qué es |
|---|---|
| _(borrado en el commit de public release)_ | **Las reglas del juego.** Fuente de verdad de todo lo que es el campeonato: formato, puntos, armado de parejas, desempates, Masters. Ante cualquier duda de comportamiento, manda este. |
| [`despliegue.md`](despliegue.md) | **Producción.** Las credenciales, qué está hecho y qué falta para estar online: Vercel, las URLs de Auth, la confirmación de mail y Google. Manda sobre cualquier cosa de despliegue. |
| [`ui-screens.md`](ui-screens.md) | **La app.** Las 13 pantallas con su contenido, roles y estados. La navegación y por qué es como es. |
| [`hacia-una-app-de-torneos.md`](hacia-una-app-de-torneos.md) | **A futuro, sin fecha.** Qué costaría que esto sirva para cualquier juego, cualquier tamaño de equipo y otros formatos (zonas, llaves). Trae las mediciones hechas —qué parte del código ya es agnóstica al deporte y cuántos lugares asumen que el equipo son dos— para no tener que volver a medir. No es un plan: es la foto para decidir. |
| [`padel_design/README.md`](padel_design/README.md) | **El handoff visual** de Google Stitch, ya adaptado al formato de 8 a 12. Colores, tipografía, medidas, copys. Los `.dc.html` muestran el caso de 8 y no se pueden regenerar. |
| _(borrado en el commit de public release)_ | **El plan 1**, ya ejecutado. Su tabla final —"Qué queda afuera de este plan, a propósito"— es la lista de requisitos que hereda el plan 2. |
| _(borrado en el commit de public release)_ | **El plan 2**, ejecutado. 14 tareas. Sus secciones "Las tres decisiones" y "Decisiones registradas" son las que mandan sobre cualquier cosa que diga este documento. Su "Aparecidos" tiene lo que quedó sin hacer. |
| _(borrado en el commit de public release)_ | **El plan 3**, ejecutado. 11 tareas, formato liviano: interfaces y "qué NO hace", con bloques de código completos sólo donde había lógica nueva. Su "Aparecidos" es la deuda conocida de las pantallas. |
| _(borrado en el commit de public release)_ | **El plan 4**, ejecutado: 13 de 14 tareas (la 7 se descartó). Su tabla "El trazado" dice qué dato necesita cada pantalla y de ahí salen las primeras cuatro tareas; sus "Decisiones registradas" mandan sobre lo que dice este documento —una de ellas corrige el alcance de acá abajo—. |
| `.superpowers/sdd/2026-08-10-core-championship-logic/progress.md` | **El ledger de ejecución.** Cada fix round, cada minor diferido, cada decisión tomada y por qué. No está versionado (es scratch), pero es donde está el detalle de cada hallazgo. |

---

## Las tres decisiones que estaban abiertas, resueltas

Las tres se cerraron al escribir el plan 2. El detalle completo, con lo que cada
una arrastra, está en ese plan; acá va el resultado.

### 1. El contexto de la fecha anterior se deriva en `core/`

Módulo nuevo `core/history.ts`, no una query en la capa de Supabase. Recibe las
filas crudas de las dos fechas anteriores y devuelve `defenders`,
`defendersAlreadyRepeated` y `previousPairs`.

**No hace falta recomputar la tabla de la fecha anterior:** `awards` congela
`position`, así que el campeón es la pareja que contiene un asiento con
`position: 1`. Eso resuelve gratis el caso de la pareja mixta, porque el
compañero del torneo sí cobra.

### 2. Varios invitados por fecha, y el admin decide si juegan juntos

Se descartó "uno solo con un unique en el schema". Puede sumarse un equipo de
invitados a una fecha: juegan, no suman puntos, es un amistoso adentro de la
fecha. **Como máximo un invitado juega con alguien del torneo; el resto entra de
a dos.**

Lo que casi se nos pasa: el armado **no** los deja juntos solo. `orderPool` los
manda al fondo y `buildPairs` empareja primero-con-último, así que dos invitados
sueltos salen en dos parejas mixtas. Que jueguen juntos es una regla nueva
—parejas fijas, como los defensores—, no un efecto automático.

De ahí salen: `guestIds` en vez de `guestId`, `fixedPairs` en `PairingInput`,
`computeAwards` compactando posiciones sobre las parejas del torneo, y
`Award.position` pasando a significar posición del campeonato.

### 3. La tabla que arma las parejas es el ranking, mejores N de M

Nunca una suma cruda. La razón que decide: `snapshots.ts:31` ya construye la
cadena de desempate con `computeRanking`, así que emparejar por suma cruda
mezclaría dos bases. Además, la tabla que ves en pantalla tiene que ser la que
te empareja.

`matchday.test.ts:191` (`tally`) es la suma cruda y queda arreglado en la Task 2
del plan 2.

---

## Lo que falta implementar, por plan

### Plan 2 — datos y auth [Completado]

Las 14 tareas están hechas. Lo que quedó construido: schema y migraciones, RLS
sobre las diez tablas, auth con mail y contraseña más Google, reclamo de asiento
por link, y las tres operaciones que mueven una fecha —abrir, cerrar, reabrir—
cada una en una función `security definer` con chequeo de admin propio.

**Lo único que falta es a mano, y necesita a una persona:**

- **Google OAuth no está configurado.** Necesita credenciales reales de Google
  Cloud y un bloque `[auth.external.google]` en `supabase/config.toml`. El plan
  lo dejó como checklist manual a propósito; el botón está en pantalla y el
  callback funciona.
- **El recorrido a mano del criterio de terminado:** registrarse, salir, entrar,
  entrar con Google, reclamar un asiento por el link.

**Tres cosas que aprendimos ejecutándolo y conviene no volver a aprender:**

1. **El plan no corría `npm run build` en ninguna de sus 14 tareas**, sólo
   `typecheck` y `test`. Dos roturas reales de producción pasaron desapercibidas
   con las dos suites en verde: un componente `'use client'` arrastrando
   `next/headers`, y un `useSearchParams()` sin límite de Suspense. Ahora
   `db/client.ts` tiene sólo la mitad del browser y `db/server.ts` la del
   servidor. **Correr `build` en cada tarea de los planes 3 y 4.**
2. **Esta versión del CLI de Supabase no le da DML a los roles de la API.** Las
   diez tablas nacen con ACL `Dxtm` y sin select/insert/update/delete, así que
   `anon`, `authenticated` y `service_role` reciben `42501`. Y una política
   nunca ensancha un privilegio que no existe: sin el `grant` de base, toda la
   RLS es decorativa. Está en `0002_rls.sql`.
3. **Un test de permisos en verde no prueba nada hasta que lo ves fallar.** La
   suite de RLS pasaba sus 13 tests y aun así se podía apagar RLS entera en 7 de
   las 10 tablas sin que nada se pusiera rojo — cubría 3. Dos tests manejados por
   tabla cerraron ~40 de 47 mutaciones. **Para cualquier cosa de permisos:
   rompela a propósito y mirá si la suite se entera.**

**No queda ninguna decisión de modelo abierta.** Las tres que faltaban se
cerraron antes de arrancar:

- **El Masters es una fecha más**, con `matchdays.kind`. Reusa `pairs`,
  `matches` y `match_sets`; no escribe `awards`, porque define al campeón del
  año y no reparte puntos. Al cerrarlo, la temporada pasa a `FINISHED`. El
  flujo lo construye el plan 3, ya sin migración.
- **`pair_locks` reemplaza a `guest_team`.** Una tabla de parejas trabadas antes
  del sorteo cubre las dos cosas con un mecanismo: el equipo invitado que juega
  junto, y el invitado puesto con alguien en concreto — que es la regla del
  spec §2.6 que el modelo anterior dejaba sin implementar. Con un límite: toda
  pareja trabada tiene que incluir a un invitado, o el admin podría saltearse la
  regla de no repetir.
- **Reabrir borra la fecha siguiente si está vacía.** Si ya tiene asistencias,
  invitados o parejas, no la toca y hay que borrarla a mano.

### Plan 3 — pantallas de lectura [Completado]

Las 11 tareas están hechas. Quedaron construidas las seis pantallas (Tabla con su
sheet de desempate, Fechas, Fecha `[n]` con el acordeón de rondas, Estadísticas,
Reglas y Perfil), más tres funciones puras nuevas en `core/` —racha de títulos,
posición con movimiento, agregados por jugador— y `db/read.ts`, la capa de
lectura, que **no existía**: `db/` sólo tenía escrituras.

**Números:** 248 tests unitarios, 104 contra la base, `npm run build` compila.

### Lo que encontró abrir el navegador, y por qué importa

Con las dos suites en verde, el typecheck limpio y el build compilando, se
recorrieron las pantallas a mano por primera vez. **Aparecieron cinco defectos
reales en veinte minutos.** Ninguno era detectable por lo que había: el Plan 3 no
tenía un solo test de pantalla.

| Qué pasaba | Por qué |
|---|---|
| Entrabas y volvías a la landing, igual que deslogueado | `signIn` redirigía a `/` fijo, y no hay "Mis torneos" |
| La primera pantalla podía tirar 500 | `JWT issued at future`, carrera de sub-segundo |
| La Tabla decía "EN CURSO" con la temporada sin arrancar | `status` colapsaba `SETUP` con `ACTIVE` |
| Fechas salía vacía | Dibujaba filas de la tabla, no de `regularMatchdays` |
| Reglas decía "Marce lo creó" en todos los torneos | Nombre de ejemplo del handoff, hardcodeado |

Los cinco están arreglados. **La lección para el Plan 4: una pantalla que tipa y
compila puede estar mintiendo en cada línea.** Hace falta un smoke test de
navegador que abra cada ruta, asierte 200 y compare lo que dice contra el estado
real de los datos.

**Y hay una segunda mitad de esa lección, que costó veintiún días descubrir.**
El 31/08 se encontró que **la app estuvo OSCURA SIEMPRE, para todos, desde el
10/08**: `app/globals.css` tenía el tema oscuro adentro de un
`@media (prefers-color-scheme: dark) { @theme { … } }`, y **`@theme` no es un
bloque de CSS** — Tailwind v4 lo procesa en build, vuelca sus variables a
`:root` y descarta el `@media` que lo envuelve. Los dos temas terminaban en
`:root`, el oscuro segundo, pisando al claro. El tema claro estaba escrito y
nunca se sirvió.

Lo que importa no es el bug sino **por qué sobrevivió tres planes con todo en
verde**: el paso 12 del smoke recorría las pantallas *"en claro y en oscuro"* y
sólo asertaba **200**. Nunca comparó un color. Un recorrido de temas que no mira
un píxel prueba que las rutas existen, no que el tema exista. Ahora compara el
fondo computado de los dos esquemas y exige que sean distintos — verificado
poniendo el bug de vuelta y viendo los dos chequeos en rojo.

**Generalizado: asertar que una pantalla responde no es asertar que la pantalla
está bien.** Es el mismo error de forma que dejó dos agujeros de RLS con los
cuatro gates en verde (tests que consultaban con `service_role`, que saltea RLS
por diseño).

**Sobre el arreglo del JWT, para que nadie lo dé por probado:** la carrera **no se
pudo reproducir a pedido**. Diez logins seguidos pasan igual con y sin el
arreglo; la falla apareció con tres agentes cargando la máquina y no vuelve con
la máquina tranquila. Eso respalda el diagnóstico —contención de CPU, no relojes
desfasados— pero es circunstancial. Lo que sí está probado es el helper en
aislamiento (`db/client.unit.test.ts`): reintenta sólo ante `PGRST303`, deja
pasar el `42501` de RLS, y se rinde después de un reintento.

**Dos cosas quedaron decididas y anotadas, no olvidadas:**

- **La página de Reglas quedó detrás del login**, aunque el diseño la pensó como
  el link que se pega en el grupo. El layout del torneo es la guardia de acceso y
  envuelve también a esa pantalla. Hacerla pública necesita que `anon` pueda leer
  las reglas de una temporada: política de RLS nueva o RPC, o sea migración. El
  sanitizado del markdown está hecho y probado igual.
- **La racha se cuenta por jugador, no por pareja.** El spec §2.4 dice que existe
  pero no cómo se cuenta, y no puede ser de la pareja: la regla del tope hace que
  una pareja defienda como máximo una vez. La decisión, con su alternativa, está
  en el plan.

**La lección que dejó, y sirve para el Plan 4:** los tres huecos que aparecieron
son de la misma familia. La capa de lectura se especificó desde el schema y no
desde las pantallas, así que le faltaron justo las cosas que no son tablas sino
preguntas sobre quien mira: "¿estoy anotado?" y "¿cuál asiento soy yo?". Antes de
escribir el Plan 4, **trazar qué dato necesita cada pantalla y recién ahí definir
las funciones de datos.**

### Plan 4 — pantallas de escritura [Completado]

**Hecho: 13 de las 14 tareas** (la 7 se descartó), en `main`.
Toda la capa de datos, "Mis torneos", el wizard de crear torneo, **el flujo
entero de jugar una fecha** —abrirla, tildar quién viene, el invitado con su
compañero, el sorteo, confirmar, cargar los resultados en dos toques, cerrar y
reabrir—, **Ajustes** (plantel, formato y reglas) y **el Masters** de punta a
punta. **273 tests unitarios, 153 contra la base, `build` compilando.**

**Una temporada entera se juega desde el navegador, de crear el torneo a coronar
al campeón del año.** Está probado recorriéndolo, no deducido: `scripts/smoke.mjs`
más un recorrido que juega tres fechas y otro que llega al Masters con sus dos
desenlaces posibles.

**Y el recorrido con navegador ya corrió** (`scripts/smoke.mjs`, Task 14): pasa
entero, de crear el torneo a cerrar la fecha con su tabla. Encontró un defecto
real que ningún test podía ver —la pareja campeona mostraba **0 puntos** cuando
jugaba con el invitado, contradiciendo la nota que tiene dos líneas más abajo—,
arreglado y anotado.

**Reglas sin login está hecha** (Task 12): se abre en una ventana privada, el
`<script>` del admin sale escapado, y las otras cuatro pantallas del torneo no le
muestran nada a un anónimo. **La Task 7 se descartó** por decisión de producto:
el jugador no marca su propia asistencia, la marca el admin en el armado.

**El diseño está auditado contra el handoff.** Los 34 tokens de color, la tipografía, los radios, el tracking del kicker y la regla de "sin sombras" estaban exactos. Lo que no estaba eran las cuatro pantallas de entrada del Plan 2, que usaban la escala redondeada de Tailwind en vez de los valores del handoff — corregidas: **en toda la app no queda una sola medida redondeada**.

**Y la guardia de acceso quedó bien puesta.** Antes, abrir el link de un torneo
sin sesión mostraba la página blanca de Next en inglés. Ahora `middleware.ts`
manda a `/login?next={ruta}` y después de entrar caés en el link que abriste; y
`app/error.tsx` —que no existía— muestra cualquier otro error como la app y en
castellano, sin filtrar el mensaje crudo. Reglas sigue pública, con barra final o
sin ella. Los seis `redirect()` de la app se recorrieron contra `npm start` para
confirmar que el error boundary no se los come.

**El equipo invitado ya se administra desde la pantalla.** Se suma una pareja
invitada, se le ponen los nombres, el sorteo los deja **juntos**, y al cerrar la
fecha **no cobran un punto** mientras los del plantel sí — jugado de punta a
punta para probarlo. El bloqueante estaba en `db/` y no en la UI:
`syncGuestSeat` contaba **todos** los invitados para decidir si faltaba uno, y
una pareja suma dos sin cambiar la paridad, así que una fecha de 7 + pareja
quedaba en 9 y no se podía generar.

**Con eso, el Plan 4 no tiene nada de producto pendiente.**

### Lo que se agregó después de cerrar el plan

Cuatro cambios pedidos por el dueño del producto, cada uno con su verificación:

- **Los puntos pueden ser 0** (`141bbcf`). Vivía prohibido en cuatro capas y las
  cuatro se movieron: `validateConfig`, el `check` de `awards.points`
  (migración `0010`), y los dos steppers. **La base era la que importaba**: sin
  la migración, la config se guardaba con un 0 y la fecha reventaba recién al
  cerrarla, con los resultados ya cargados. Lo que sigue prohibido es el
  negativo y repetir un valor, así que el 0 aparece una sola vez y al final.
- **"En alza" y "En baja" en Estadísticas** (`6f4a440`): quién más subió y quién
  más bajó al cerrar la última fecha. Reusa `rankingWithMovement` —la misma
  cuenta que la flecha de la Tabla, no una segunda opinión—; lo que agrega es el
  extremo, que en la Tabla hay que buscarlo recorriendo doce filas.
- **"Cómo viene": la trayectoria del año en el Perfil** (`3fbaeb4`). En qué
  puesto de la tabla general estaba el jugador al cerrar cada fecha, dibujado
  como una línea. **Nada guardado responde eso** —`awards.position` congela el
  puesto DE ESA FECHA, no el del año— así que se recomputa el ranking con las
  fechas disponibles en cada momento. **El eje va invertido, el 1° arriba**: un
  puesto más chico es mejor, y una línea que baja cuando mejorás se lee al
  revés. SVG en línea, sin librería.
- **La guarda de los tests contra la base** (`09de9b9`): `db/test/env.ts` se
  niega a correr si `NEXT_PUBLIC_SUPABASE_URL` no es local. Las suites borran y
  crean con `service_role`; apuntarlas a producción por un descuido borra el
  campeonato. Va en el `setupFiles` de vitest y no en un `pretest:db` para que
  también corte un `npx vitest` directo.

**Y un bug que apareció escribiendo lo anterior:** el plantel en Estadísticas no
estaba ordenado por siembra, salía en el orden que devolvía la base.
`computeRanking` cae en ese orden cuando dos jugadores no están en el snapshot,
así que el desempate era **no determinista**: la misma temporada podía dar dos
tablas distintas.

**Y la lista corta de deuda visible.** Ninguna impide jugar; las cuatro están
medidas y anotadas en `Aparecidos` del plan 4, y la cuarta ya está saldada. Si la
próxima sesión viene a tocar código, esto es lo que queda:

1. **Plurales en singular:** `"faltan 1 partidos"` (cerrar la fecha) y
   `"jugaron 1 fechas"` (Estadísticas). Los dos salen de copys con `{n}` que el
   handoff no trae en singular — **es un string nuevo que hay que decidir**, por
   eso quedó sin inventar.
2. **"Mejor dupla del torneo" lista once duplas, no una.** `ui-screens.md` §10
   pide "la pareja con mejor récord". La pantalla pone la mejor primera y el
   resto **ordenado por fechas jugadas juntas, no por récord**, así que la
   segunda fila puede decir 0%.
3. **El botón de Google falla hasta que se configure** — ver
   [`despliegue.md`](despliegue.md). O se configura, o se esconde.

**Y una de esa lista que ya está saldada:** ~~el mensaje de `reopen_matchday`
pedía algo imposible~~. Decía "Borrala vos antes de reabrir ésta" y **no existía
ninguna forma de borrar una fecha** en todo el producto — ni pantalla ni función
en `db/`. Ahora existe: `cancel_matchday` (`0012_cancel_matchday.sql`) borra una
fecha DRAFT u OPEN entera, con presentismo, invitados, parejas, partidos y
resultados, y "Borrar fecha" está en el armado, en la carga y en el Masters. El
mensaje pasó a ser literalmente cierto, así que no se tocó: lo que estaba mal era
que faltara la acción, no las palabras. Lo cerrado sigue afuera —para eso está
reabrir— y borrar la única fecha de una temporada la devuelve a `SETUP`, que si
no quedaba "En curso" con cero fechas.

#### Dos cosas rotas que nadie sabía, y ya están arregladas

Las dos aparecieron ejecutando, con las dos suites en verde, y ninguna era
detectable por lo que había:

| Qué estaba roto | Por qué no lo agarró nadie |
|---|---|
| **Crear una temporada desde la app tiraba `42501`** | `is_participant` responde con un SELECT adentro de una función `security definer`, y ese subselect no ve la fila que la propia sentencia está insertando — así que el `returning` se rechaza aunque el `WITH CHECK` pase. Los tests arman temporadas con `service_role`, que saltea RLS, y hasta el Plan 4 no había pantalla que creara un torneo. Arreglado en `0008_seasons_returning.sql` |
| **El Masters no se podía ni abrir ni cerrar** | `openMatchday` corría `assertMatchdaySize` sobre un `present` vacío (el Masters tiene 4 clasificados, no asistencias) y `closeMatchday` mandaba awards que `close_matchday` rebota. Ninguna prueba llegaba nunca al Masters |

**La lección, y es la misma de siempre:** una capa entera puede estar en verde y
tener un camino que nunca corrió nadie. Los dos agujeros estaban exactamente en
el borde entre dos piezas que cada una probaba sola.

**Y una que vale repetir:** en la primera tanda de tests, uno pasaba **por
vacuidad** — `expect(error).not.toBeNull()` se conformaba con "la función no
existe", así que estaba en verde antes de que existiera nada. Es el mismo modo de
falla que este documento ya tenía anotado del Plan 2.

#### El alcance original, para referencia

- Crear torneo (wizard de 5 pasos), abrir fecha, cargar resultados, Ajustes
- **Decidir el tamaño de la fecha desde las asistencias** y agregar el asiento de
  invitado cuando el número da impar
- ~~**Que el admin pueda mover al invitado** en el orden (spec §2.6). `core/` lo
  pone último y respeta el orden que le den; la UI tiene que ofrecer el
  arrastre~~ — **esta línea está mal y el plan 4 la corrige** (decisión
  registrada 2). `orderPool` (`core/pairing.ts:178`) manda a los invitados al
  final del pool *siempre*, y sólo respeta el orden *entre ellos*: con un solo
  invitado —el caso normal— el arrastre no cambia nada. Lo que sí implementa el
  spec §2.6 es elegir con quién juega, o sea `pair_locks`

**Lo que el Plan 3 le dejó, con lo que ya se resolvió:**

- [Completado] **"Mis torneos".** Construida (`/torneos`). Después de entrar van todos ahí:
  el caso especial de "una sola temporada, directo a su tabla" se borró, porque
  un camino distinto para el mismo destino es una rama más que puede quedar mal.
- [Completado] **La lectura de asistencias** (`attendancesOf`), y el permiso para que un
  jugador escriba la suya (`set_my_attendance`). **La Task 7 (el toggle en la
  Tabla) se descartó** por decisión de producto: el jugador no marca su propia
  asistencia, la marca el admin en el armado.
- [Completado] **El flujo `DRAFT`** y **la carga de resultados** (Tasks 9 y 10): abrir la
  fecha, armar, cargar resultados en dos toques, cerrar y reabrir.
- [Completado] **Editar las reglas** desde Ajustes (Task 11). La función que las escribe
  ya no es `updateSeasonRules` — el SDD `reglas-por-disciplina` la reemplazó
  por `updateDisciplineRules` (`db/discipline.ts`), que escribe por
  disciplina y mantiene `seasons.rules_text` al día con un dual-write. Ver
  "Dónde estamos".
- [Completado] **El flujo del Masters** (Task 13): armar, abrir y cerrar, con su pantalla.
- [Completado] **La página de Reglas pública** (Task 12): guardia del layout aflojada,
  `anon` la lee vía `season_public_rules`.

**Cómo escribirlo, aprendido a los golpes en el Plan 3:**

1. **Trazar qué dato necesita cada pantalla ANTES de definir las funciones de
   datos.** La capa de lectura del Plan 3 se especificó desde el schema, y por eso
   le faltaron justo las preguntas que no son tablas: "¿estoy anotado?" y "¿cuál
   asiento soy yo?". Las dos tuvieron que resolverse a los parches.
2. **Correr `npm run build` en cada tarea.** El Plan 2 no lo corría y se le
   pasaron dos roturas de producción con las dos suites en verde.
3. **Un smoke test de navegador**, aunque sea mínimo. Cinco defectos reales
   salieron en veinte minutos de mirar la app, y cero de ellos era visible desde
   los tests.

### Dos pantallas que cambiaron de layout y todavía nadie miró

Al adaptar el diseño de Stitch al formato de 8 a 12, dos pantallas necesitaron
un layout nuevo, no sólo otro copy. Están marcadas con  en el handoff:

- [Completado] **Wizard paso 4:** los puntos eran 4 columnas. Con 12 jugadores son 6 valores
  y no entran a lo ancho de un teléfono. Pasaron a filas — construido en la Task
  6 del Plan 4, una fila por posición con `−`/`+` de 34px.
- [Completado] **Fecha en juego:** eran 3 rondas × 2 partidos fijas. Con 6 parejas son 15
  partidos, así que las rondas pasaron a acordeón, con la ronda en curso abierta
  y las completas colapsadas — construido en la Task 8 del Plan 3
  (`fechas/[n]/rondas.tsx`). **La Task 10 del Plan 4 le enchufa la carga de
  resultados encima, sin rehacer el acordeón.**

Los dos layouts están construidos y ninguno se discutió después de escrito, que
era el riesgo.

---

## Deuda conocida en `core/`

Nada de esto rompe nada hoy. Está todo verificado y triageado; queda anotado para
que sea una decisión y no un olvido.

**Un test que no protege lo que dice.** `core/standings.test.ts`, el test
"does not mutate the pairs it receives": el fixture que usa tiene un orden
correcto que coincide con el orden en que están declaradas las parejas, así que
un `sort` en el lugar lo dejaría igual y el test pasaría lo mismo.
`computeStandings` hoy **no** muta nada —verificado, construye un array nuevo con
`map`—, o sea que es deuda de test, no un defecto.
*El arreglo es una línea:* usar el fixture de head-to-head de ese mismo archivo,
donde el orden correcto pone `b1` antes que `a1`, invertido respecto del
declarado.

**Cosméticos, del ledger:**

- `samePair` vive en `pairing.ts`, pero es una propiedad de `Pair`. Como
  `standings.ts` lo importa de ahí, arrastra `allMatchings` y `orderByPoints` sin
  necesitarlos. Moverlo a `types.ts` aplana el grafo
- `buildFixture` y `mastersFixture` comparten la palabra "fixture" y no comparten
  forma: uno devuelve rondas de índices, el otro una lista de parejas
- `standings.ts` descarta en silencio un partido cuyas parejas no están en la
  lista. El spec (§4.5) dice que una violación de invariante en `core/` debe
  fallar ruidosamente
- `pairing.ts` acota el *pool*, no los *presentes*: 14 presentes con defensores
  fijos dejan un pool de 12 y pasan. Falla después, con un mensaje sobre la lista
  de puntos en vez de sobre el tamaño de la fecha
- Faltan fixtures para dos de los cuatro repartos posibles de una fecha de 4
  parejas: `3-1-1-1` y `2-2-1-1`

**El harness de integración es deliberadamente disparejo.** Como el fixture deja
siempre a la pareja 0 de local y el local siempre gana, **la pareja 0 gana todos
los partidos de todas las fechas**. Está documentado en el propio archivo. No
invalida ninguna aserción, pero significa que las pruebas de temporada nunca
ejercitan una tabla que se mueve ni un campeón que rota. Un segundo harness con
otra regla determinista —por ejemplo, que gane la pareja peor rankeada en las
rondas impares— costaría unas quince líneas y ejercitaría la cadena de snapshots
bajo movimiento real. Es la mejor mejora de test disponible.

---

## Cómo se trabaja acá

Lo que funcionó en el plan 1 y conviene repetir:

**Los bloques de código del plan son código.** El plan 1 llevaba la
implementación completa de cada módulo, y los implementadores la transcribían.
Eso salió bien —cero deriva— pero significa que **un defecto en el plan se
propaga intacto a la rama**. Cuatro de los seis hallazgos importantes de la
revisión final venían del plan o del spec, no de nadie que implementara. Para los
planes 2 a 4: los bloques de código del plan merecen la misma revisión que las
implementaciones, *antes* de despacharlos.

**Pedir cuentas a mano, no confianza en los tests.** Los revisores rindieron
muchísimo más cuando se les pidió *calcular*: enumerar los ocho resultados
posibles del Masters, trazar la rotación del round robin para 4 parejas, computar
`floor((f-1)/k)` en los bordes. Un test y un código pueden estar equivocados de
acuerdo, y eso ninguna suite lo detecta.

**`jsdom` está para UN caso, y el resto sigue sin DOM.** `app/amigos/[playerId]/cargar.unit.test.ts`
es el único archivo del repo que corre en `jsdom`, con un pragma
`@vitest-environment` por archivo — `vitest.config.ts` no tiene override global
y no hay que ponerle uno. Entró en 2b porque el formulario del partido casual se
borraba entero en cada error de validación (React 19 llama
`HTMLFormElement.reset()` nativo cuando una action termina) y **medimos que no
había forma barata de pinearlo**: `value` y `defaultValue` serializan HTML
idéntico, así que `renderToStaticMarkup` no distingue un input controlado de uno
que no lo está.

La regla, entonces: **`jsdom` se usa sólo para un componente con estado que no se
puede invocar como función pura.** Todo lo demás —que es toda la UI de este
repo— se sigue testeando con `renderToStaticMarkup` y sin DOM, y por eso la suite
unitaria corre en cuatro segundos. Si te encontrás agregando el pragma a un
segundo archivo, pará y preguntate si el componente necesita estado de verdad.

**Tres lecciones sobre tests, que costaron rondas:**

- `toContain` responde *"¿está?"*, nunca *"¿dónde?"*. Cuando el contrato es el
  **orden**, hay que asertar posiciones
- Un `not.toContain` en verde no prueba nada si la frase que nombra no es una que
  el código pueda producir. Un cambio de string dejó un test pasando por vacuidad
- La prosa se despega del comportamiento sin que ningún test lo note. La página
  de reglas describía un desempate distinto al que el código hacía
