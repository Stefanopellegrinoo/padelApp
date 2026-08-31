# Tipos de torneo — diseño

> **Estado, 31/08/2026:** de las seis piezas de este documento, **cuatro están
> implementadas y verificadas** en `feature/torneo-multi-disciplina`, sin
> publicar: **1** (equipos fijos, migración `0068`), **2.1** (torneo de una
> fecha, `wizard-state.ts` con `min: 1`), **2.2** (Masters/año condicionales) y
> **2.3** (reglas por disciplina — SDD `reglas-por-disciplina`, commits
> `8f1f04d`..`1bae705`). Quedan **2.4**, **2.5** y **2.6** — orden sugerido en
> la sección 6.
>
> Rama de trabajo: `feature/torneo-multi-disciplina` (tracker). `main` y
> producción siguen sin tocar — ver [`estado.md`](estado.md).

**De dónde salió:** Stefano levantó la app por primera vez el 24/08/2026 y trajo
cuatro observaciones. Este documento las cierra.

---

## 0 · El reencuadre

Stefano buscaba **una** dimensión que decidiera el tipo de torneo — la cantidad
de gente, el deporte, la duración — y ninguna funciona sola:

> *"depende la cantidad de gente la opción de tipo de torneo que le dé, pero eso
> no está del todo bien… el torneo puede durar un día, no entiendo bien cómo
> hacer."*

**No es una dimensión: son perillas independientes, y casi todas ya son
configurables.** Modelar "tipo de torneo" como un enum (`LIGA | COPA | EVENTO`)
daría tres nombres y cinco agujeros.

Lo que ya existe, medido contra el código:

| lo que se pidió | dónde está hoy |
|---|---|
| liga en grupos y después mata-mata | `GROUPS_KNOCKOUT`, con `knockoutPositions` exigiendo una FINAL |
| que sea sólo liga | `ROUND_ROBIN`, el default |
| campeón de cada fecha | `championRecord`, ya se ve en la lista de fechas |
| disciplina sin Masters | `has_masters = false`, checkbox en Ajustes |
| torneo de UNA fecha | el modelo ya lo acepta: `core/config.ts:227` valida `regularMatchdays >= 1` |
| historial que cruza torneos | ya es derivable: `players` es global y `entries` conecta con todas las temporadas |

**El modelo mental, en palabras de Stefano:** *"un torneo multidisciplina es un
torneo con dos o más deportes juntos, pero cada torneo es independiente."* El
torneo es un contenedor; cada disciplina adentro es un torneo independiente —
su config, sus fechas, su tabla, sus reglas. Comparten el plantel, el nombre y
el link de invitación.

Con eso, lo que falta se parte en dos: **una cosa que pide modelo nuevo
(equipos fijos)** y **cinco que son superficie**.

---

## 1 · Equipos fijos — el único modelo nuevo

### 1.1 La decisión de fondo

> *"Si es un torneo de equipos fijos, si uno del equipo de Juan no vino,
> problema de él, busca reemplazo, acá queda por fuera de la app. Porque el
> equipo de Juan y Pedro **es un equipo**, no es un torneo que cuenta
> individual."*

**El equipo es la unidad que compite.** De ahí salen tres consecuencias que
achican el diseño en vez de agrandarlo:

1. **No hay huérfanos ni reemplazos modelados.** Un equipo viene entero o no
   viene. Conseguir un reemplazo es un problema del grupo de WhatsApp, no de la
   app.
2. **Los dos miembros tienen siempre los mismos puntos.** No existe el caso que
   los separe.
3. **Por lo tanto no hace falta una tabla de equipos.** La tabla de personas
   *es* la tabla de equipos. La vista por equipo es tomar los puntos de
   cualquiera de los dos — **no** sumarlos: `core/awards.ts:70` le paga
   `points` completo a cada miembro, así que sumar contaría doble.

### 1.2 El modelo

| pieza | qué es |
|---|---|
| `disciplines.fixed_teams boolean not null default false` | la perilla, al lado de `pair_size` / `allows_draw` / `has_masters`. Sólo tiene sentido con `pair_size = 2` |
| `discipline_teams(id, discipline_id, entry_a, entry_b, season_id)` | `pair_locks` pero **por disciplina** en vez de por fecha. Mismos `unique` a cada lado (nadie en dos equipos), mismas FK compuestas contra `(entries.id, season_id)`. **Sin columna de nombre** — decisión explícita: *"por ahora Pedro y Juan"* |
| inyección en `pairingContextFor` (`db/matchday.ts:197`) | los equipos presentes entran como `fixedPairs` **sin pasar por `pair_locks`** |
| presentismo por equipo | una sola marca escribe las **dos** filas de `attendances`. Un equipo a medias es estado inválido que rechaza el borde |
| la regla de defensores se apaga con `fixed_teams` | ver 1.4 — si no, crashea |

### 1.3 Por qué inyectar en vez de escribir `pair_locks`

`pair_locks` tiene dos guardas que existen **para el formato rotativo** y que un
equipo fijo violaría por definición:

- `assertLocksAndGuests` (`db/validate.ts:205`) exige que **toda pareja trabada
  incluya a un invitado**. El motivo escrito en `0001_schema.sql:122` es que dos
  del plantel trabados a mano saltearían la regla de no repetir — *que es
  exactamente la regla que equipos fijos apaga a propósito*.
- `promote_guest` **borra locks** en ocho migraciones distintas (`0014`, `0023`,
  `0025`, `0031`, `0032`, `0033`, `0048`, `0062`).

Si los equipos nunca son filas de `pair_locks`, **no hay que tocar ninguna de
las dos cosas**. Ésa es toda la ventaja, y es grande.

### 1.4 Lo medido — el motor ya banca equipos fijos, con un choque

**Ya funciona, cero código en `core/`:**

`core/matchings.ts:22` → `if (pool.length === 0) return [[]]`, con test explícito
en `core/matchings.test.ts:6`. Si se traban *todas* las parejas, `resolveSettled`
se las lleva, el pool queda vacío, `allMatchings([])` devuelve un armado vacío
**legal**, y `buildPairs` retorna `settled` tal cual. La regla de no repetir
tampoco molesta: filtra el sorteo, y las parejas fijas nunca entran al sorteo.

**El choque, y es un crash real:**

`resolveSettled` (`core/pairing.ts:206`) toma **primero** la pareja defensora y
**después** las fijas. Con equipos fijos son las mismas dos entries, así que
`take` tira `"ya está en la pareja defensora"` — **la fecha siguiente a cualquier
campeonato revienta.**

Con `fixed_teams` la regla de defensores es redundante (el equipo sigue junto
igual, sin necesitar una regla que lo permita), así que se apaga. Esto necesita
un test que lo fije: *fecha con campeón previo + equipos fijos → arma sin
error*.

### 1.5 Dos cosas que salen gratis

- **Los invitados siguen andando sin cambios.** Un invitado en una disciplina de
  equipos fijos es un **equipo visitante entero**, que es literalmente para lo
  que se escribió `pair_locks` (*"el equipo invitado que vino a jugar junto"*,
  `0001_schema.sql:117`).
- **La paridad deja de ser un problema.** Con equipos, el plantel presente es
  siempre par, así que `assertMatchdaySize` no puede fallar.

### 1.6 Lo que NO cambia

`awards`, `standings`, `computeGlobalRanking` y la tabla de la disciplina quedan
**intactos**. Ése es el punto de todo el diseño.

---

## 2 · Las cinco de superficie

Ninguna pide modelo nuevo salvo donde se aclara.

### 2.1 El torneo de un día está prohibido por un stepper

`app/torneos/nuevo/wizard-state.ts:49` tiene `min: 4` en `regularMatchdays`. El
modelo ya acepta 1 (`core/config.ts:227`). **Es el único obstáculo real para un
torneo de una fecha.** Bajar el mínimo a 1.

### 2.2 La prosa habla del año y del Masters aunque estén apagados — [Implementado]

`core/narrate.ts:73` cerraba con *"El año cierra con un Masters entre los N
mejores"* y `:107` dibujaba una sección **"El Masters"** entera — las dos
**incondicionales**, aunque `has_masters = false`. En un torneo de un día, las
dos frases eran falsas.

**Hecho** (`d77b535`, SDD `reglas-por-disciplina`): las dos quedaron
condicionadas a `has_masters`, y la palabra "año" se fue gratis con ellas — las
dos apariciones vivían adentro de la prosa del Masters, no en una frase
aparte.

### 2.3 Las reglas describen sólo la primera disciplina — [Implementado]

**Hecho en `feature/torneo-multi-disciplina`** (SDD `reglas-por-disciplina`,
commits `8f1f04d`..`1bae705`), sin publicar. `disciplines.rules_text` existe
desde la migración `0069`, `narrateRules` corre una vez por disciplina con su
propio `config` y su propio `shape`, y `app/torneo/[id]/reglas/rules-body.tsx`
dibuja un bloque por disciplina.

`seasons.rules_text` (`0001_schema.sql:17`) era **uno solo para todo el torneo**,
y `app/torneo/[id]/reglas/page.tsx:108` pasaba
`config={primaryDiscipline(header).config}`. Con pádel + FIFA juntos, la prosa
generada le mentía a la segunda.

**La tabla de abajo, tal como quedó escrita al diseñar esto, estaba
INCOMPLETA: tenía cuatro mentiras y en realidad había seis, más una séptima
que se encontró y se dejó adentro a propósito.** Las dos que faltaban no las
vio este documento — las encontró recién `sdd-design`, leyendo el código antes
de escribir. Quedan agregadas acá con la columna de dónde salieron, para que
la próxima persona que escriba un documento de diseño sepa que "leer el
código" no es opcional aunque el defecto parezca obvio:

| sección | decía | con FIFA de a uno | dónde se encontró |
|---|---|---|---|
| La fecha | *"entre 8 y 12"* (`narrate.ts:78`, `MIN_PLAYERS`/`MAX_PLAYERS` hardcodeados) | ignoraba `config.maxMatches` | acá (25/08) |
| La fecha | *"se arman parejas"* | falso | acá (25/08) |
| La fecha | *"si da impar se suma un invitado"* | falso | acá (25/08) |
| Los puntos | *"los dos integrantes de una pareja"* | falso | acá (25/08) |
| **Cómo se arman las parejas** (la sección entera) | ordena la tabla, arma primero-con-último, prohíbe repetir pareja | **falso de punta a punta**: con `pair_size=1` no hay pareja que armar — `core/pairing.ts:135-147` lo dice en su propio comentario ("no defenders, no fixed pairs, no no-repeat rule") | recién en `sdd-design` (30/08), no acá |
| La fecha → el formato | *"Puede terminar empatado."* (`describeFormat`, incondicional) | falso cuando `disciplines.allows_draw = false` (el default de hoy) | recién en `sdd-design` (30/08) — "la cuarta mentira" |

**Una séptima se encontró y se dejó deliberadamente sin tocar:** "El Masters"
afirma *"compañeros rotativos: cada uno juega una vez con cada uno"* sin mirar
`pair_size`, pero esa combinación (`has_masters=true` con `pair_size=1`) es
**inalcanzable en producción** — `0053_disciplines_has_masters_needs_pair.sql`
la prohíbe con un `check`, y los dos escritores de disciplinas la respetan al
crear. Corregir `narrateRules` para un caso que la base ya hace imposible es
defender contra una entrada que nunca llega; queda anotado, no corregido.

**Arreglo, tal como se hizo:** `rules_text` se mudó de `seasons` a
`disciplines` (migración `0069`, con backfill — producción tenía el reglamento
de PnP-1000 escrito y no se perdió), y `narrateRules` corre una vez por
disciplina con su propio `config` y su propio `shape`
(`hasMasters`/`pairSize`/`allowsDraw`, que viven en `disciplines`, no en
`config`). Las vistas `0007_write_screens.sql:128` y
`0022_discipline_public_rules.sql:23` **no se movieron**: siguen sirviendo
`seasons.rules_text` sin cambiar una letra, y `updateDisciplineRules`
(`db/discipline.ts`) las mantiene al día con un dual-write hacia la disciplina
por defecto de cada temporada.

Stefano sobre este punto: *"esto es importante hacerlo bien, con cabeza porque
si no nada tiene sentido."*

### 2.4 Con una sola disciplina hay dos tablas iguales, y ordenadas distinto

Con una disciplina de peso 1, la tabla global da **los mismos puntos** que la de
la disciplina. Pero `core/global-ranking.ts:64` ordena con
`orderByPoints(order, points, [])` — **snapshot vacío** —, o sea que desempata
por orden de llegada de las filas, mientras la tabla de la disciplina usa el
criterio real. **Mismos puntos, distinto orden en los empates.**

Van los dos arreglos, y son independientes:

1. Darle un desempate real a la global. Está mal con una disciplina **y** con
   cinco.
2. Con una sola disciplina, mostrar **una** tabla.

### 2.5 Formato por default en la disciplina

Hoy el formato se elige **por fecha**: `matchdays.formato jsonb not null default
'{"kind":"ROUND_ROBIN"}'` (`0040_matchday_format.sql:45`), y `disciplines` no
tiene uno propio. Para FIFA —donde, en palabras de Stefano, *"siempre cerrás con
campeón"*— hay que elegir "grupos + llave" todas las veces.

**Arreglo:** un formato por default en `disciplines`, del que cada fecha nueva
hereda. La fecha lo sigue pudiendo pisar.

### 2.6 (bonus) La pantalla de historial del grupo

Consulta nueva sobre `players` / `entries`, **modelo intacto**: qué jugaron, con
quién, cuántas veces. Es lo que Stefano nombró como el objetivo de la app:

> *"que con tus amigos puedas armar torneos fácilmente y que puedas tener un
> historial de todos los que jugaron."*

Se puede hacer aparte, y no bloquea nada de lo de arriba.

---

## 3 · Decisiones tomadas que este spec fija

### 3.1 El nivel permanente es memoria, no competencia

Stefano nombró un conflicto: si un torneo de un día tiene campeón, **¿cuántos
puntos suma?** Cualquier número infla el sábado o lo vuelve irrelevante.

**Resolución:** cada torneo tiene su tabla y su campeón, **autocontenido**. El
grupo tiene un **historial** —qué jugaron, con quién, cuántas veces— **sin
puntos**. Nadie decide cuánto vale un campeón de un día porque ahí no se
compite.

### 3.2 La tabla global suma disciplinas, no torneos

Confirmado explícitamente: la global suma **las disciplinas de un torneo**,
ponderadas por `weight`. No suma torneos entre sí.

### 3.3 Los pisos y techos de jugadores no se tocan acá

`MIN_PLAYERS = 8` es una regla de 2v2 e inconsistente consigo misma (prohíbe 6,
donde descansa uno, pero permite 10, donde también descansa uno). `MAX_PLAYERS =
12` ya no protege nada desde que ese trabajo pasó a `config.maxMatches` el
24/08, y encima está **duplicado dentro de `promote_guest`** (`if v_squad + 1 >
12`) con tripwire en `core/constants.test.ts`, así que sacarlo pide migración.

**Queda fuera de este spec, deliberadamente.** Stefano lo frenó para pensarlo
junto con los tipos de torneo, y la respuesta que salió es que los tipos de
torneo **no** dependen de esos números. Merece su propio cambio.

**Corrección, encontrada implementando §2.3 (costó una ronda del spec SDD):**
"queda fuera" se puede leer, a primera vista, como que la fila 1 de la tabla de
§2.3 —la frase *"entre 8 y 12"*— también quedaba afuera. No es así. Lo que este
párrafo saca de alcance son los VALORES de `MIN_PLAYERS`/`MAX_PLAYERS` (8 y 12)
y su borrado, que sí piden migración y siguen postergados. La PROSA de "La
fecha" que los cita sin mirar la disciplina (`narrate.ts:78`) es exactamente el
defecto que §2.3 vino a arreglar, y ya se arregló: el tope real por fecha que
esa prosa dice ahora es `maxMatchesOf(config, sideSize)`
(`core/constants.ts:55-59`), no `MAX_PLAYERS`. `MIN_PLAYERS`/`MAX_PLAYERS`
mismos siguen sin tocarse, y `squadSize` en `validateConfig` sigue gateado por
ellos exactamente igual que antes.

---

## 4 · Lo que este spec NO hace

- No crea un enum `tipo_de_torneo`. Ver sección 0.
- No crea una entidad "equipo" con identidad ni nombre. Ver 1.1.
- No crea una tabla de posiciones por equipo. Ver 1.1.
- No modela reemplazos, suplentes ni asistencia parcial de un equipo. Ver 1.1.
- No toca `MIN_PLAYERS` / `MAX_PLAYERS`. Ver 3.3.
- No abre `disciplines.kind` más allá de `PADEL` / `FIFA`.

---

## 5 · Riesgos

| riesgo | dónde | mitigación |
|---|---|---|
| **Crash en la fecha post-campeonato** | `core/pairing.ts:206` | test RED antes del arreglo: campeón previo + `fixed_teams` → arma sin error |
| **Pérdida del reglamento de producción** | migración de `rules_text` a `disciplines` | backfill explícito + verificación contra la fila real de PnP-1000 antes del contract |
| **Equipo a medias en el sorteo** | presentismo | guarda en el borde: con `fixed_teams`, si un miembro está PLAYING el otro también. Falla fuerte, no en silencio |
| Un equipo con alguien que no juega esa disciplina | `discipline_teams` | FK compuesta contra `discipline_entries`, igual que `attendances` |
| **Ventana de despliegue al ensanchar `season_public_formats`** | migración `0069`, `drop function` + recreate | **No se materializó.** La función no tiene consumidor en producción porque toda la cadena `0015+` sigue sin publicar (producción corre `main`, migraciones `0001`-`0014`). Por eso §2.3 se adelantó en el orden y se hizo ahora: tocarla es gratis mientras nadie la lee; después de publicar, el mismo `drop function` costaría la ventana de despliegue real |

---

## 6 · Orden sugerido

1. [Hecho] **2.1** (`min: 1`) — `a1f956b`.
2. [Hecho] **1** (equipos fijos) — `535b8a8`, migración `0068`.
3. [Hecho] **2.2** (la prosa condicional) — `d77b535`.
4. [Hecho] **2.3** (`rules_text` a `disciplines`) — SDD `reglas-por-disciplina`,
   `8f1f04d`..`1bae705`. Se adelantó respecto de este orden —iba último, por
   ser la única pieza con migración de datos de producción— porque
   `season_public_formats` (`0038`) todavía no tenía consumidor en producción;
   ver la fila de "ventana de despliegue" en la sección 5, que por eso no se
   materializó.

Queda por hacer, en el orden que sigue teniendo sentido:

5. **2.4** (desempate global + tabla única).
6. **2.5** (formato por default en la disciplina).
7. **2.6** (historial del grupo) — independiente, cuando se quiera.

---

**Fuentes:** brainstorming en engram `sdd/tipos-de-torneo/brainstorming` (#4108)
y `sdd/tipos-de-torneo/equipos-fijos` (#4112). Todas las referencias
`archivo:línea` de este documento fueron verificadas contra el árbol del
2026-08-25, salvo las de §2.2 y §2.3 —reverificadas contra `1bae705` al
archivar el SDD `reglas-por-disciplina` el 31/08— y las de §1/§2.1, ya
implementadas antes de esa fecha (`535b8a8`, `a1f956b`).
