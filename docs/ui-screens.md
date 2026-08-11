# Estructura de la app — pantallas y navegación

**Fecha:** 10 de agosto de 2026
**Uso:** input para diseñar en Google Stitch, una pantalla por vez.
**Complementa:** `superpowers/specs/2026-08-09-padel-championship-design.md` (las reglas del
campeonato). Este documento define **la app**; aquel define **el juego**.

---

## Principios

**Contexto de uso.** Se usa parado en el club, de noche, con una mano, a veces con sol en
la pantalla. Mobile primero. Botones grandes. Mínimo scroll en la carga de resultados.
Modo claro y oscuro.

**Los botones son las cosas que importan.** La navegación del torneo son cuatro destinos,
no siete. Todo lo demás se llega desde donde tiene sentido: tocando un nombre, tocando un
chip, desde el header. Un ítem de menú se gana su lugar por uso, no por importancia.

**Una acción no merece una pantalla.** Marcar que no vas a la próxima fecha es un tap:
vive en la tabla, no en una ruta.

**Dos entradas, un destino.** Cuando algo se puede querer ver de dos maneras distintas
—por curiosidad y por una duda concreta— son dos accesos al mismo lugar, nunca dos
pantallas parecidas.

---

## Mapa de navegación

```
PÚBLICO (sin cuenta)
  Landing ──────────────► Registro ──┐
      │                              ├──► Mis torneos
      └──────────────────► Login ────┘

  Reglas del torneo    ← link para pegar en el grupo, sin login
  Unirse [token]       ← link de invitación, elegís tu nombre

APP
  Mis torneos ──► Crear torneo (wizard)
      │
      └──► TORNEO ─── nav de 4 ────────────────────
                 │
                 ├── Tabla        [ Orden de desempate ⇅ ]
                 ├── Fechas       ──► Fecha (detalle)
                 ├── Estadísticas ──► Perfil de jugador
                 └── Reglas       ──► ⚙ Ajustes (solo admin)
```

**Roles:** `público` (sin cuenta) · `jugador` (logueado) · `admin` (creó el torneo).

---

## Decisiones de estructura

Cinco cosas cambiaron respecto del spec del 9 de agosto. Quedan acá porque afectan el
modelo de datos, no sólo el diseño.

**0. La fecha ya no es siempre de 8.** El plantel puede llegar a 12, y cada fecha la juegan
los que confirman: 8, 10 o 12. Como sólo se puede jugar con número par, **si confirman impar
la app agrega un lugar de invitado** y el admin le pone nombre cuando lo consigue. Menos de 7
confirmados no hay fecha; más de 12 tampoco.

Los puntos son **una sola lista, tan larga como el plantel más grande**, y las fechas chicas
usan los primeros valores: con `[10, 7, 5, 3, 2, 1]`, una fecha de 4 parejas reparte
`10, 7, 5, 3`. Ganar la fecha son 10 puntos, jueguen 8 o 12.

**1. Multi-torneo.** El spec asumía una temporada por vez. Ahora un usuario puede estar en
varios torneos y crear los suyos. El modelo de identidad ya lo aguantaba: `TournamentEntry`
existe justamente para que una persona tenga una participación por torneo. Lo que cambia es
el permiso: **el que crea el torneo es su admin**. No hay un admin global de la app.

**2. Autenticación con cuenta propia.** El spec proponía sólo magic link. Ahora hay registro
y login con email y contraseña, más Google. El magic link se cae: si hay contraseña, el
magic link es un tercer camino a mantener sin nada que aporte.

**3. La entrada al torneo es por link, no por email.** El admin tipea los nombres del plantel
y comparte un link. El que entra elige el suyo de la lista. Nadie tiene que juntar 8 mails, y
el canal es el que el grupo ya usa. El riesgo de que alguien tome el asiento equivocado se
acepta y se arregla desde Ajustes, como ya decía el spec (6.2).

**4. El admin no tiene una sección propia.** Las acciones de admin viven embebidas en las
pantallas donde pasan: abrir la fecha está en Fechas, cargar resultados está en la Fecha.
Sólo lo que no tiene dónde colgarse —participantes, config, texto de reglas— se junta en
una pantalla de Ajustes. Una sección "Administrar" paralela obligaría a dibujar dos veces
las mismas pantallas y a que el admin aprenda una segunda navegación para llegar a lo que
ya está mirando.

---

# Las pantallas

## 1. Landing

**Rol:** público. Es lo primero que ve alguien que llega sin cuenta.

**En pantalla:**
- Qué es: un campeonato de padel entre amigos que se lleva solo
- Cómo funciona, en tres golpes: *se juega una fecha → la app arma las parejas y calcula la
  tabla → al final del año, el Masters*. Con una muestra real de la tabla, no un ícono
- CTA principal: crear cuenta. Secundario: entrar

**Estados:** visitante · ya logueado (se lo manda directo a Mis torneos).

---

## 2. Registro

**Rol:** público.

**En pantalla:** nombre, email, contraseña. Botón de Google arriba, separador, y el
formulario abajo. Link a Login.

**Estados:** vacío · enviando · email ya registrado · contraseña que no cumple el mínimo ·
error de Google.

---

## 3. Login

**Rol:** público.

**En pantalla:** email y contraseña, botón de Google, link a "olvidé mi contraseña" y a
Registro.

**Estados:** vacío · enviando · credenciales incorrectas · error de Google.

> Los errores de credenciales no dicen si el mail existe o si falló la contraseña. Un
> mensaje distinto para cada caso le confirma a cualquiera qué mails están registrados.

---

## 4. Unirse `[token]`

**Rol:** el que entra por el link de invitación. Si no tiene cuenta, primero registro y
vuelve acá.

**En pantalla:**
- Nombre del torneo y quién lo creó
- **Los lugares sin dueño**: los nombres del plantel que tipeó el admin y todavía nadie
  reclamó, como lista seleccionable
- Nota al pie: "Si tu nombre no está o ya lo tomó otro, avisale al organizador."
- Confirmar

**Estados:** hay asientos libres · todos reclamados (la pantalla muestra la nota al pie y no
ofrece ninguna acción) · el usuario ya tiene asiento en este torneo (se lo manda al torneo) ·
token inválido o vencido.

No hay botón para crear un asiento nuevo: eso cambiaría `squadSize`, y `points` tiene que
tener exactamente `squadSize / 2` valores (spec 2.9) — un jugador entrando por un link
dejaría la configuración inválida sin enterarse. Agregar gente es del admin, desde Ajustes.

---

## 5. Mis torneos

**Rol:** jugador. Es la pantalla de entrada a la app. Deliberadamente básica.

**En pantalla:**
- Lista de torneos donde participo. Cada uno: nombre, estado (en curso / terminado), mi
  posición actual, y cuándo es la próxima fecha
- Botón **crear torneo**

**Estados:** sin torneos (vacío, con el botón de crear como protagonista y una línea
explicando que también se puede entrar por un link) · con torneos · con torneos terminados
(se muestran abajo, apagados).

---

## 6. Crear torneo

**Rol:** admin. Se usa una vez por temporada.

**Wizard, un paso por pantalla:**

1. **Nombre** del torneo
2. **El plantel** — tipear los nombres. De 8 a 12, y tiene que ser par. El contador se ve
   siempre; la app avisa si falta uno para cerrar el número
3. **Orden inicial** — arrastrarlos del mejor al peor. Una línea explicando para qué sirve:
   es el criterio que corta los empates hasta que haya fechas jugadas
4. **Formato** — puntos por posición (tantos valores como parejas puede llegar a haber: 4
   si el plantel es de 8, 6 si es de 12), sets y games por partido, cuántas fechas tiene el
   año, cuántas cuentan para cada jugador, cada cuántas fechas se refresca el orden de
   desempate. Todos con un valor por defecto que ya funciona
5. **Listo** — resumen y el **link para compartir**, con botón de copiar

**Estados / errores:** validación por paso (el plantel tiene que ser par y estar entre 8 y
12; los puntos tienen que ser tantos como parejas máximo, descendentes y todos mayores que
0; "cuentan las mejores" no puede superar el total de fechas). El paso 4 puede saltearse
entero con los valores por defecto.

> La cantidad de valores de puntos **depende del paso 2**. Si el plantel es de 12 hay que
> cargar 6, porque una fecha puede llegar a tener 6 parejas. La pantalla los muestra ya
> pre-cargados con el default y explica en una línea que las fechas más chicas usan los
> primeros.

---

## 7. Tabla — home del torneo

**Rol:** jugador. Es la pantalla que más se abre de toda la app.

**En pantalla, en este orden:**

1. **Próxima fecha** — número, día, y mi asistencia con un control para marcar **"no voy"**
   y deshacerlo. Si ya me marqué ausente, dice si consiguieron reemplazo
2. **Campeones defensores** — los dos nombres de la pareja que ganó la última fecha,
   destacados, y si repiten o si ya agotaron su repetición
3. **La tabla** — el plantel con posición, puntos y el movimiento respecto de la fecha
   anterior. El corte del top 4 marcado (los que hoy clasifican al Masters). Tocar una fila
   lleva al perfil

**Elementos fijos del header:**
- Botón **`Orden de desempate ⇅`** — siempre visible, sin scroll. Abre el sheet (ver abajo)
- **⚙** — sólo si soy admin. Lleva a Ajustes

**El chip `ⓘ`** aparece sólo en las filas empatadas en puntos. Abre el mismo sheet, pero
apuntando a ese empate concreto.

**Estados:** torneo recién creado (sin fechas jugadas: tabla en 0, sin defensores, y el
protagonista pasa a ser "abrir la primera fecha") · en curso · terminado (con el campeón del
año arriba de todo).

---

## 7b. Sheet — Orden de desempate

No es una pantalla: es un panel que sube desde abajo. Se abre desde el botón fijo o desde
un chip `ⓘ`.

**En pantalla:**
- **Si entró por un chip**, arriba de todo la respuesta a la pregunta que traía:
  *"Marce va antes que Nico. Están 47 a 47 y corta el orden del cierre de la fecha 3."*
- **El orden completo del plantel**, en dos columnas, sin puntos — son posiciones, no
  puntaje. Si entró por un chip, los dos jugadores en cuestión resaltados
- De cuándo es ese orden y **cuándo se actualiza**
- Una línea de qué hace: corta los empates y de ahí salen las parejas de cada fecha

**Estados:** entrada por botón (sin resaltado) · entrada por chip (con la explicación
arriba) · todavía es el orden inicial, no hay fechas suficientes.

> **Por qué no es una página.** El orden es una foto vieja de la tabla —con refresco cada 3
> fechas, en la fecha 5 es la tabla al cierre de la 3— y está congelado entre refresco y
> refresco. Como página propia serían dos listas con los mismos nombres en órdenes distintos
> compitiendo por ser "la de verdad". Como sheet, es la letra chica que hace que la tabla
> se entienda.

---

## 8. Fechas

**Rol:** jugador. Lista de todas las fechas del torneo.

**En pantalla:** una fila por fecha, con el número, el día y:
- **Jugada** → los dos campeones de esa fecha, con foto de la tabla resumida
- **En curso** → las parejas del día
- **Por jugarse** → sólo el número y la fecha, apagada

Abajo de todo, **el Masters**, visualmente separado y más grande. No tiene nav propia: es
una pantalla que existe una vez al año.

**Acción de admin embebida:** botón **"Abrir fecha N"** arriba, sólo si soy admin y no hay
ninguna fecha abierta.

**Estados:** ninguna fecha jugada · mezcla · temporada regular completa (el Masters se
activa) · todo terminado.

---

## 9. Fecha `[n]` — detalle

**Rol:** jugador para leer, admin para operar. **Es la misma pantalla para los dos.**

**En pantalla:**
- Encabezado: número, día, estado
- **Las parejas** (4, 5 o 6 según cuántos vinieron), con la defensora marcada y el invitado
  señalado como tal
- **Fixture**: las rondas con sus partidos y el resultado de cada uno cuando existe. Con 5
  parejas, en cada ronda hay una libre y hay que mostrarlo — si no, parece un error
- **Tabla de la fecha**: las parejas ordenadas, con partidos ganados, diferencia de games
  y los puntos que se llevó cada jugador. El invitado aparece en su pareja pero sin puntos
- Si la tabla se definió por desempate, decirlo y con qué criterio

**Tres estados, y hay que dibujar los tres:**

### `DRAFT` — la fecha se está armando
Sólo la ve el admin. Es un flujo de tres pasos:

**1. Quién viene** — el plantel entero como lista de tildes: *viene* / *no viene*. Los que se
marcaron ausentes desde la Tabla vienen pre-tildados. Arriba, un contador vivo que es el
protagonista de la pantalla:

```
┌────────────────────────────────┐
│         9 confirmados          │
│   son impar → +1 invitado      │
│      la fecha es de 10         │
│         5 parejas              │
└────────────────────────────────┘
```

**2. El invitado**, si el número dio impar. Aparece como una fila más, con su campo de
nombre y una nota de que no suma puntos. Por defecto va **último** en el orden; se puede
arrastrar.

**3. Generar parejas** — botón grande. Muestra las parejas resultantes, cuál es la defensora,
y una línea de por qué salieron así. Se puede regenerar.

**4. Confirmar** → pasa a `OPEN`.

**Bloqueos:**
- **Menos de 7 confirmados** → no hay fecha. Dice cuántos faltan
- **Más de 12** → no entra en una tarde. Dice cuántos sobran
- **Invitado sin nombre** → se pueden generar las parejas, pero no confirmar. Si no, nadie
  sabe quién es el que falta

**Avisos:** los defensores repiten y quedan fijos · falta uno de los defensores, la pareja
pierde el título y se rearma todo · los defensores ya jugaron sus 2 fechas juntos, esta
fecha no hay defensores.

### `OPEN` — se está jugando
Es lo que se mira en el club. Parejas y fixture confirmados, resultados vacíos.

**Si soy admin**, cada partido es cargable en el mismo lugar donde se lee. Con set a 4 games
sólo hay 4 resultados posibles: **la carga es de dos taps, sin teclado**. La tabla se va
actualizando en vivo a medida que se cargan.

Botón **cerrar la fecha**, deshabilitado mientras falten partidos, diciendo cuántos faltan.

> **Ojo con el tamaño.** Una fecha de 4 parejas son 6 partidos y entran sin scroll. Una de 6
> parejas son **15**, y ahí el "mínimo scroll" se rompe. La pantalla tiene que agrupar por
> ronda y colapsar las rondas ya completas, para que lo que estás cargando esté siempre
> arriba.

### `CLOSED` — terminada
Todo cargado, tabla y puntos definitivos. Si soy admin y es la última fecha cerrada, aparece
**reabrir**, con confirmación explícita y el aviso de que se recalculan los puntos.

**Errores:** resultado inválido para el formato (un `5-2` en un set a 4) se rechaza con el
motivo, no se guarda "por las dudas".

---

## 10. Estadísticas

**Rol:** jugador. Es la única pantalla que no sale del spec: se arma de cero.

**En pantalla, como bloques:**
- **% de partidos ganados** — el plantel, en barras. Es otra historia que la tabla: se puede
  tener buen porcentaje y pocos puntos si te tocaron malas parejas. Y es la métrica que
  compara mejor entre fechas de distinto tamaño, donde no todos jugaron la misma cantidad
- **Mejor dupla del torneo** — la pareja con mejor récord, con su marca
- **Con quién te va bien** — mis compañeros ordenados por resultado. Personal, no global
- **Rachas de títulos** — quién defendió más fechas seguidas
- **Presentismo** — fechas jugadas y ausencias, por jugador

Tocar cualquier nombre lleva al perfil.

**Estados:** sin datos suficientes (menos de 2 fechas jugadas: se muestra qué va a aparecer
acá y cuándo) · con datos.

---

## 11. Reglas

**Rol:** público. Es la misma pantalla que se comparte por link sin login.

**En pantalla, dos bloques separados por quién es la fuente de verdad:**
- **Generado por la app** — narra el formato leyendo la config: puntos por posición, formato
  del partido, cuántas fechas y cuántas cuentan, cómo se arman las parejas, la regla del
  campeón defensor, los desempates y el Masters
- **Escrito por el admin** — texto libre: horarios, qué club, quién lleva las pelotas, cómo
  se avisa una ausencia, la joda interna

Sello de última actualización.

**Acción de admin embebida:** botón **Editar**, que lleva a Ajustes.

**Estados:** con texto del admin · sin texto del admin (sólo el bloque generado) · visto sin
login (sin nav de torneo, con un CTA discreto a la landing).

---

## 12. Perfil de jugador

**Rol:** jugador. No está en la nav: se llega tocando un nombre.

**En pantalla:**
- Nombre, posición actual y puntos
- **Fecha a fecha** — lo que sumó en cada una, marcando cuáles cuentan (las mejores N) y
  cuáles se descartan, y las ausencias
- **Sus números** — fechas ganadas, racha de defensas, partidos ganados y perdidos
- **Compañeros** — con quién jugó, cuántas veces y cómo le fue con cada uno

**Estados:** perfil reclamado · asiento sin dueño todavía · **el perfil propio** (igual, más
la opción de editar su nombre).

---

## 13. Ajustes del torneo

**Rol:** admin, y sólo el admin. Se entra por el ⚙ del header o por "Editar" en Reglas.

Es la única pantalla de administración pura: junta lo que no tiene dónde colgarse.

**En pantalla, como secciones:**
- **Invitación** — el link para compartir, con botón de copiar
- **Participantes** — el plantel con su nombre y quién lo reclamó (o "sin dueño"). Por
  asiento: editar el nombre, desvincular el reclamo. Se puede **agregar y sacar gente**
  (hasta 12), y si el plantel cambia de tamaño la app avisa que hay que revisar los puntos.
  Los invitados de fechas pasadas no aparecen acá: no son del plantel
- **Formato** — los mismos campos del paso 4 del wizard
- **Texto de reglas** — editor de markdown con vista previa

**Estados / errores:**
- Validación de la config, igual que en el wizard
- **Antes de guardar con el torneo empezado:** aviso de qué afecta el cambio y la aclaración
  de que **las fechas ya cerradas no se tocan** — sus puntos quedaron congelados

---

## Resumen

| # | Pantalla | Rol | Uso |
|---|---|---|---|
| 1 | Landing | público | una vez |
| 2 | Registro | público | una vez |
| 3 | Login | público | baja |
| 4 | Unirse `[token]` | público | una vez por torneo |
| 5 | Mis torneos | jugador | media |
| 6 | Crear torneo | admin | una vez por temporada |
| 7 | **Tabla** | jugador | **la más usada** |
| 7b | Sheet: orden de desempate | jugador | media |
| 8 | **Fechas** | jugador | alta |
| 9 | **Fecha `[n]`** | jugador + admin | **alta — 3 estados** |
| 10 | Estadísticas | jugador | media |
| 11 | Reglas | público | baja, pero es la cara pública |
| 12 | Perfil de jugador | jugador | media |
| 13 | Ajustes | admin | baja |

**Las tres que definen el diseño:** la Tabla (#7), la Fecha (#9) y Fechas (#8). Ahí está
todo el vocabulario visual —tablas, parejas, resultados, estados—. Si esas tres funcionan,
el resto es aplicar lo mismo.

**Por dónde empezar en Stitch:** la Tabla. Es la más usada, define la paleta y la tipografía,
y de ella sale el componente de fila de jugador que se repite en media app.
