# Campeonato de padel — Diseño del MVP

**Fecha:** 9 de agosto de 2026
**Estado:** propuesta para revisión
**Stack:** Next.js + Supabase, deploy en Vercel

---

## 1. Qué es

Una app para correr un campeonato **individual** de padel entre un grupo fijo de amigos, aunque los partidos se jueguen en parejas.

Cada jugador acumula sus propios puntos a lo largo del año, como un ranking ATP. Las parejas se rearman en cada fecha buscando equilibrio, con una excepción: **la pareja que gana una fecha se mantiene junta en la siguiente**.

### Alcance del MVP

**Entra:**

- Torneos con un plantel de hasta 12 jugadores. Cada fecha la juegan los que confirman, entre 8 y 12
- Un usuario puede participar en varios torneos y crear los suyos; el que crea un torneo es su admin
- Fechas con armado automático de parejas, fixture y carga de resultados
- Ranking de temporada y tabla de cada fecha
- Cuentas de usuario y reclamo de perfil
- Registro de ausencias y jugadores invitados
- Página de reglas con los parámetros configurables y texto libre del admin
- Masters de fin de año

**No entra, a propósito:**

- Otros deportes. Esto es un formato específico de padel hecho bien, no un motor genérico de torneos.
- Fechas de menos de 8 o más de 12. Con 7 parejas son 21 partidos, que no entran en una tarde ni con 3 canchas.
- Scoring en vivo. Los resultados se cargan al final del día.
- Reserva de canchas, pagos, chat, notificaciones push.

> **Sobre la extensibilidad:** el algoritmo de armado y el formato del partido ya están aislados detrás de una configuración. El día que exista un segundo deporte se escribe una estrategia nueva al lado, sin tocar el resto. Construir hoy el motor multideporte sería pagar por adelantado una flexibilidad que todavía no tiene usuarios.

---

## 2. Reglas del campeonato

### 2.1 La temporada

- **10 fechas** de temporada regular (configurable).
- Para cada jugador cuentan sus **8 mejores resultados** (configurable). Así se puede faltar una o dos veces sin quedar afuera de la pelea.
- El año cierra con un **Masters** entre los 4 mejores del ranking.
- Antes de la primera fecha el grupo consensúa un **ranking de nivel inicial**, del mejor al peor. Es la semilla del criterio de desempate.

### 2.1.1 El criterio de desempate: la cadena de snapshots

Cuando dos jugadores tienen los mismos puntos hay que poder decidir cuál va primero, porque de ese orden salen las parejas. El criterio es un **snapshot**: una lista ordenada del 1 al 8, que se refresca cada cierta cantidad de fechas.

```
Snapshot 0  =  ranking de nivel inicial consensuado por el grupo
Snapshot 1  =  tabla al cierre de la fecha k,   desempatada con el snapshot 0
Snapshot 2  =  tabla al cierre de la fecha 2k,  desempatada con el snapshot 1
```

Con `tiebreakSnapshotEvery = 3`:

| Fechas | Criterio de desempate |
|---|---|
| 1 a 3 | Ranking de nivel inicial |
| 4 a 6 | La tabla al cierre de la fecha 3 |
| 7 a 9 | La tabla al cierre de la fecha 6 |
| 10 | La tabla al cierre de la fecha 9 |

**Un snapshot no guarda puntos: guarda posiciones.** Es una permutación del plantel, y en una permutación no puede haber dos en el mismo lugar. Por eso **siempre corta** y no hace falta ningún criterio adicional debajo.

Esto importa porque el caso más frecuente de empate es estructural: una pareja que gana varias fechas seguidas nunca se separa y por lo tanto nunca deja de sumar idéntico. En el snapshot igual uno quedó antes que el otro, porque el snapshot anterior ya los tenía en ese orden, y así hacia atrás hasta el ranking inicial. La cadena está bien fundada y siempre termina.

Los snapshots no se guardan en ninguna tabla: se recalculan desde `awards` y el ranking inicial. Son deterministas, así que reabrir una fecha vieja reproduce exactamente el mismo orden.

El intervalo lo elige el admin al crear la temporada, cuando ya sabe cuántas fechas va a tener.

### 2.2 La fecha

La juegan **los que confirman**, entre 8 y 12. Se arman parejas con todos y juegan todos contra todos. Con 8 jugadores queda el caso base:

```
Ronda 1:   P1 vs P2   |   P3 vs P4
Ronda 2:   P1 vs P3   |   P2 vs P4
Ronda 3:   P1 vs P4   |   P2 vs P3
```

Los tres tamaños posibles:

| Jugadores | Parejas | Partidos | Rondas | Canchas | Cada uno juega |
|---|---|---|---|---|---|
| 8 | 4 | 6 | 3 | 2 | 3 partidos |
| 10 | 5 | 10 | 5 | 2 | 4 partidos, descansa 1 ronda |
| 12 | 6 | 15 | 5 | 3 | 5 partidos |

El fixture es un round robin generado con el algoritmo del círculo. Con un número **par** de parejas nadie descansa; con 5 parejas —número impar— hay una pareja libre en cada ronda y no hay forma de evitarlo, es aritmética.

**Sólo se juega con un número par de jugadores.** Si confirman impar, la app agrega un lugar de invitado (ver 2.6).

Cada partido es un **set corto a 4 games** con tie-break. El formato es configurable por temporada (`setsToWin`, `gamesPerSet`).

### 2.3 Tabla de la fecha

Las parejas se ordenan por:

1. Partidos ganados
2. Diferencia de games
3. Resultado entre las parejas empatadas
4. La pareja cuyo mejor jugador esté más arriba en el snapshot vigente

> Cuando `setsToWin > 1` se inserta **diferencia de sets** entre los pasos 1 y 2. Con un solo set ese criterio es idéntico al paso 1, así que no se aplica.

El paso 4 casi nunca se usa, pero tiene que existir: en un triple empate `2-2-2` el resultado entre las parejas es circular y no resuelve, y sin un corte final quedan tres parejas peleando por el primer puesto.

**El desempate no es un caso raro.** Con 4 parejas y 6 partidos, exactamente la mitad de las fechas terminan con empate en el primer puesto (las distribuciones posibles son `3-2-1-0`, `3-1-1-1`, `2-2-2-0` y `2-2-1-1`). Con más parejas hay más partidos y el empate se vuelve menos frecuente, pero nunca desaparece. El criterio de diferencia de games decide el campeón muy seguido, y por eso hay que cargar el resultado completo de cada partido y no sólo quién ganó.

### 2.4 Puntos

Cada jugador recibe los puntos de la posición final de **su pareja**. Los dos integrantes suman exactamente lo mismo.

Como la fecha puede tener 4, 5 o 6 parejas, los puntos son **una sola lista, tan larga como el plantel más grande. Las fechas chicas usan los primeros valores.**

```
config:  [10, 7, 5, 3, 2, 1]

fecha de 4 parejas  →  10, 7, 5, 3
fecha de 5 parejas  →  10, 7, 5, 3, 2
fecha de 6 parejas  →  10, 7, 5, 3, 2, 1
```

Ganar la fecha son 10 puntos, jueguen 8 o 12. Nadie resta puntos y nadie suma 0 por presentarse: si faltar diera lo mismo que ir y salir último, convendría faltar.

> **Imperfección aceptada.** Salir 3º entre 6 parejas paga lo mismo que salir 3º entre 4, aunque en el primer caso superaste a más gente. Se evaluó normalizar los puntos por cantidad de parejas —el 1º siempre 100, el último siempre 10, el medio proporcional— y se descartó por complejidad: obliga a explicar una fórmula en la página de reglas para corregir una injusticia chica. Si con el tiempo el grupo siente que las fechas grandes valen poco, la alternativa está acá.

La pareja campeona **no recibe bonus por defender el título**. La racha de defensas se guarda como estadística, no como puntos, para que nadie se escape.

### 2.5 Armado de parejas

Todo el armado se reduce a una sola regla:

> **Ninguna pareja se repite dos fechas seguidas. Única excepción: la pareja campeona, que repite una vez.**

La pareja que gana una fecha se mantiene junta en la siguiente y se retira del armado general. A la fecha siguiente ya agotó su repetición y vuelve a caer bajo la regla general, gane o pierda. Así toda pareja campeona juega exactamente **2 fechas juntas** y después se separa por una.

```
1. Presentes de la fecha (los que confirmaron, más el invitado si el número dio impar)

2. Defensores = ganadores de la fecha anterior, si
     ├── asisten los dos, Y
     └── no estuvieron juntos también en la fecha anterior a esa
   Si se cumple, quedan FIJOS como pareja. Si no, no hay defensores
   esa fecha y todas las parejas salen del armado general.

3. pool = presentes − defensores

4. Ordenar el pool por la tabla de puntos
     desempate: snapshot vigente (ver 2.1.1)

5. Enumerar TODOS los emparejamientos posibles del pool

6. Tachar las parejas que ya jugaron juntas la fecha anterior

7. Quedarse con el más equilibrado de los que sobreviven
     desbalance = Σ |suma_posiciones(pareja) − (n+1)|
```

No hace falta una regla aparte de "separación obligatoria del que pierde el título": el paso 6 ya la cubre. Quien fue pareja la fecha pasada no puede repetir, haya salido campeón o último.

**Por qué se enumera todo en vez de usar una heurística:** la cantidad de emparejamientos posibles es `(n-1)!!`, y para estos tamaños es diminuta. Con un pool de 6 son 15, con 8 son 105, con 10 son 945 y con 12 —el máximo posible, sin defensores— son 10.395. La fuerza bruta da el óptimo garantizado en milisegundos y en unas 20 líneas. No hace falta greedy, backtracking ni solver.

**Siempre existe una salida.** Con un pool de 6, las parejas de la fecha anterior tachan 7 de los 15 armados y quedan 8 legales. En el peor caso posible, un pool de 4, quedan 2. La restricción de no repetir nunca puede dejar al sistema sin opciones.

**Si la tabla queda igual que la fecha anterior** no pasa nada especial: el armado ideal queda tachado por repetido y el sistema toma el siguiente más equilibrado. Es el mismo código.

### 2.6 Asistencia e invitados

La asistencia se coordina con anticipación. Antes de armar las parejas, el admin marca **quiénes del plantel van a ir**. De ahí sale el tamaño de la fecha.

**Si el número da impar, la app agrega un lugar de invitado**, porque no se puede jugar sin un número par. Confirman 9 → la app suma 1 → la fecha es de 10. El admin le pone nombre cuando lo consigue.

- El invitado **no suma puntos**: no está en el campeonato.
- El compañero del invitado **suma normalmente**: jugó y se lo ganó.
- El invitado entra **último** en el orden que arma las parejas, así le toca con el primero de la tabla. Es el que nadie sabe cómo juega, y el fondo es la posición más neutra. El admin lo puede mover si conoce al tipo.
- **La fecha no se abre con el invitado sin nombre.** Se pueden generar las parejas, pero para pasar a `OPEN` tiene que estar identificado: si no, nadie sabe quién es el que falta.

**Límites.** Menos de 7 confirmados no hay fecha: con 6 jugadores son 3 parejas y una descansa en cada una de las 3 rondas. Más de 12 tampoco, por lo dicho en el alcance.

Si uno de los campeones defensores no va, **la pareja pierde el título** y se rearma todo desde cero. No se puede reemplazar a uno y mantener al otro como campeón.

> El ausente simplemente no juega esa fecha y no suma. Como para cada jugador cuentan sus mejores N resultados (2.1), faltar una o dos veces no lo deja afuera de la pelea.

### 2.7 Masters

Los 4 mejores del ranking anual juegan una jornada final con compañeros rotativos:

```
Partido 1:   1º + 4º   vs   2º + 3º
Partido 2:   1º + 3º   vs   2º + 4º
Partido 3:   1º + 2º   vs   3º + 4º
```

Cada uno juega una vez con cada uno. Los resultados se cuentan de forma individual y definen al campeón del año. Esto resuelve el problema de que los dos integrantes de una pareja que gana mucho terminen empatados: el Masters los separa.

**El desempate del Masters:** el formato sólo admite dos desenlaces. O alguien gana los 3 partidos y es campeón limpio, o **tres jugadores empatan en 2 y uno queda en 0**. No existe `3-2-1-0` ni `2-2-1-1`, verificado sobre los 8 resultados posibles. Y el triple empate ocurre la mitad de las veces.

El head-to-head no sirve para cortarlo, porque en el Masters todos jugaron con todos y contra todos.

> **Regla de corte: en caso de empate, gana el que llegó mejor posicionado en el ranking anual.** Así la temporada regular vale algo concreto — llegar primero no regala el título, pero define cualquier empate a favor.

El mismo criterio aplica para clasificar: si dos empatan por el 4º lugar, entra el que esté mejor en el snapshot vigente.

### 2.8 La página de reglas

Todos los jugadores tienen acceso a una página con las reglas del campeonato. Está partida en dos bloques según quién es la fuente de verdad.

**Bloque generado por la app.** La app narra el formato leyendo la configuración: los puntos por posición, el formato del partido, cuántas fechas y cuántas cuentan, cómo se arman las parejas, la regla del campeón defensor, los desempates y el Masters.

**Bloque escrito por el admin.** Texto libre en markdown para todo lo que la app no puede saber: horarios, qué club, quién lleva las pelotas, cómo se avisa una ausencia, la joda interna.

> **Por qué se separan:** si el admin escribiera a mano *"el campeón suma 10 puntos"* y después cambiara la config a 12, el texto quedaría mintiendo. Una página de reglas que no coincide con lo que hace la app es peor que no tener página. Todo lo que la app puede derivar de la config, lo deriva.

La página es accesible con el link de la temporada, sin necesidad de tener cuenta, para poder pegarla en el grupo.

### 2.9 Qué se puede configurar

| Parámetro | Configurable | Restricción |
|---|---|---|
| `squadSize` | Sí | Par, entre 8 y 12 |
| `points` | Sí | Exactamente `squadSize / 2` valores, descendentes, todos mayores que 0 |
| `matchFormat` | Sí | `setsToWin` ≥ 1, `gamesPerSet` ≥ 1 |
| `regularMatchdays` | Sí | ≥ 1 |
| `countBestOf` | Sí | ≤ `regularMatchdays` |
| `tiebreakSnapshotEvery` | Sí | ≥ 1 |
| `minPlayersPerMatchday` | **No** | Fijo en 8 |
| `maxPlayersPerMatchday` | **No** | Fijo en 12 |
| `mastersSize` | **No** | Fijo en 4 |

Los tres últimos no son configuración, son **el formato**. Debajo de 8 la fecha queda coja —3 parejas y una descansando cada ronda—, arriba de 12 no entra en una tarde, y los 3 partidos rotativos del Masters existen porque son exactamente 4 jugadores. Exponerlos como perilla sería ofrecer una opción que rompe la app.

`squadSize` es el tamaño del **plantel**, no el de la fecha. El de la fecha lo define quién confirma. Lo único que hace `squadSize` es determinar cuántos valores de `points` hay que cargar: un plantel de 12 puede llegar a tener 6 parejas y necesita 6 valores.

La restricción de que todos los puntos sean mayores que 0 no es arbitraria: si terminar último diera 0, sería lo mismo que faltar, y convendría no presentarse.

**Cambios con la temporada empezada.** Se permiten. Antes de guardar, la app muestra qué afecta el cambio, y la página de reglas indica la fecha de la última actualización.

Las fechas ya cerradas **no se alteran nunca**: sus puntos quedaron congelados en `awards` y sus parejas en `pairs`. Cambiar la tabla de puntos en la fecha 5 no reescribe las cuatro anteriores. El efecto secundario es que la tabla puede terminar mezclando dos escalas, y es aceptable: es el precio de poder ajustar sobre la marcha.

---

## 3. Modelo de datos

### 3.1 La decisión que sostiene todo

**Los partidos referencian el asiento (`entries`), nunca al jugador (`players`).**

Un `entry` es el lugar de alguien en la temporada. Existe desde que el admin tipea el nombre, mucho antes de que esa persona tenga cuenta. Cuando reclama su perfil, lo único que cambia es `entries.player_id`.

```
Antes:   entry(temporada A, "Juan") → player #1 sin cuenta
         entry(temporada B, "Juan") → player #2 sin cuenta

Juan se registra → user #7 → player #9

Después: ambos entries → player #9
         los players #1 y #2 quedan huérfanos y se borran
```

Los partidos, las parejas, los resultados y las tablas **no se tocan**: siguen apuntando a un asiento que no se movió. Si los partidos guardaran `player_id`, reclamar un perfil obligaría a reescribir la historia entera del campeonato.

El mismo mecanismo resuelve a los invitados sin código extra: el invitado **es un asiento más**, marcado como `GUEST` y atado a una fecha. Las parejas y los partidos lo referencian igual que a cualquier otro, y lo único que lo distingue es que al calcular `awards` se lo saltea, porque no está en el campeonato.

### 3.2 Tablas

```sql
players
  id, display_name, user_id → auth.users (nullable), created_at

seasons
  id, name, status (SETUP | ACTIVE | FINISHED), config jsonb, created_by
  rules_text (markdown escrito por el admin), rules_updated_at

entries                                    -- el asiento en la temporada
  id, season_id, player_id (nullable), display_name
  kind (SQUAD | GUEST)
  seed_position    -- sólo SQUAD: su lugar en el orden inicial
  matchday_id      -- sólo GUEST: de qué fecha es este invitado
  unique (season_id, seed_position) where kind = 'SQUAD'

matchdays
  id, season_id, number, status (DRAFT | OPEN | CLOSED), played_on, closed_at
  unique (season_id, number)

attendances
  id, matchday_id, entry_id, status (PLAYING | ABSENT)
  unique (matchday_id, entry_id)
  -- sólo para entries SQUAD. El invitado no necesita fila:
  -- su propia existencia como entry GUEST de esa fecha ya lo dice

pairs
  id, matchday_id, entry_a, entry_b

matches
  id, matchday_id, round, pair_a, pair_b

match_sets
  id, match_id, set_number, games_a, games_b

awards                                     -- congelado al cerrar la fecha
  id, matchday_id, entry_id, position, points
```

### 3.3 Qué se deriva y qué se congela

**Se deriva siempre, nunca se guarda:**

- La tabla de cada fecha, a partir de `match_sets`
- El ranking de temporada, a partir de `awards`
- Quién es la pareja campeona defensora: es el ganador de la fecha anterior, si los dos asisten. Por eso `pairs` no guarda ningún flag de "defensores": sería estado duplicado que se puede desincronizar.

**Se congela al cerrar la fecha:** `awards`. Es la única desnormalización del diseño y tiene una razón concreta: si el año que viene cambian la tabla de puntos, el histórico no debe cambiar retroactivamente.

### 3.4 Configuración de la temporada

```json
{
  "squadSize": 12,
  "matchFormat": { "setsToWin": 1, "gamesPerSet": 4, "tieBreak": true },
  "points": [10, 7, 5, 3, 2, 1],
  "regularMatchdays": 10,
  "countBestOf": 8,
  "tiebreakSnapshotEvery": 3
}
```

Se valida con un esquema en el borde, tanto al crear la temporada como al editarla. Las restricciones están en 2.9.

`mastersSize` y los límites de 8 a 12 **no aparecen en este JSON**: viven en el código como constantes del formato. No hay nada que configurar ahí, y un campo que sólo admite un valor legal es una trampa — alguien lo edita, la validación lo deja pasar porque nadie lo mira, y la app sigue jugando con el número de siempre mientras la config dice otra cosa.

> Una versión anterior de este documento listaba `mastersSize` dentro del JSON dos líneas antes de decir que no era configurable. Esa contradicción se propagó al plan y de ahí al tipo `SeasonConfig`, y la encontró la revisión final de `core/`. Queda anotado porque el error no estuvo en implementarlo mal: estuvo acá.

---

## 4. Arquitectura

### 4.1 Capas

```
core/            funciones puras, sin base de datos ni framework
  pairing        armado de parejas
  standings      tabla de la fecha
  ranking        ranking de temporada y mejores N de M
  snapshots      cadena de criterios de desempate
  masters        clasificación y desempate del Masters
  rules          validación de la config y narración del formato

app/             Next.js App Router — pantallas y route handlers
db/              acceso a Supabase, una función por operación
```

Todo el corazón del campeonato vive en `core/` como funciones puras: reciben datos, devuelven datos. Sin dependencias, sin efectos, y por lo tanto testeables sin levantar nada.

### 4.2 Autenticación

Supabase Auth con email y contraseña, más Google. No hay magic link: teniendo contraseña sería un tercer camino a mantener sin nada que aporte.

**Flujo de reclamo:**

1. El admin comparte el link de la temporada en el grupo
2. Quien entra se registra y ve la lista de asientos sin dueño
3. Elige el suyo, o crea uno nuevo si no está
4. Si más adelante lo agregan a otra temporada, como ya está logueado el asiento se vincula solo

Se asume confianza dentro del grupo: no hay validación de que quien elige "Juan" sea Juan. Si alguien se equivoca, el admin lo desvincula desde la pantalla de participantes.

### 4.3 Estados de la fecha

```
DRAFT   → el admin marca quién viene y genera las parejas
OPEN    → parejas y fixture confirmados, se juega en el club
CLOSED  → todos los resultados cargados, awards congelados, tabla actualizada
```

La carga es en batch al final del día: una pantalla, entre 6 y 15 resultados según el tamaño de la fecha, un botón. Nada de edición concurrente ni sincronización en tiempo real.

Reabrir una fecha cerrada borra sus `awards` y recalcula. Sólo el admin, y sólo si es la última fecha cerrada — de lo contrario habría que rearmar todas las parejas posteriores, que se generaron a partir de esa tabla.

### 4.4 Pantallas

La estructura de la app —las 13 pantallas, la navegación, los estados de cada una y las decisiones de diseño— vive en **`docs/ui-screens.md`**. Es la fuente de verdad de la app; este documento lo es del juego.

Lo esencial: la navegación del torneo son cuatro destinos (Tabla, Fechas, Estadísticas, Reglas) y el admin **no tiene sección propia** — sus acciones están embebidas en las pantallas donde ocurren.

Se usa parado en el club, con una mano, con sol en la pantalla. Mobile primero, botones grandes, mínimo scroll en la carga de resultados.

### 4.5 Manejo de errores

- **Una fecha no se abre incompleta:** para pasar de `DRAFT` a `OPEN`, el número de jugadores tiene que ser par y estar entre 8 y 12, y el invitado —si lo hay— tiene que tener nombre. Con 7 confirmados y el invitado todavía sin nombre se pueden generar las parejas, pero no abrir la fecha: nadie sabría quién es el que falta.
- **Menos de 7 confirmados no hay fecha.** El sistema lo dice y no deja avanzar, en vez de armar 3 parejas cojas.
- **Validación en el borde:** los resultados se validan contra `matchFormat` antes de guardar. Un `5-2` en un set a 4 se rechaza con el motivo, no se guarda "por las dudas". La config se valida con el mismo criterio contra las restricciones de 2.9.
- **El texto de reglas se sanitiza al renderizar.** Es markdown que escribe una persona y que leen todas las demás, así que pasa por un sanitizador que descarta HTML crudo y scripts. Que el admin sea de confianza no cambia la regla: el contenido generado por usuarios nunca se inyecta sin limpiar.
- **Cerrar una fecha es atómico:** o se guardan todos los resultados y los awards, o no se guarda nada. Una transacción.
- **El armado nunca falla:** está demostrado que siempre existe al menos un emparejamiento legal. Si aun así el resultado viniera vacío, es un bug y debe fallar ruidosamente, no devolver parejas al azar.
- **Errores en pantalla:** dicen qué pasó y cómo arreglarlo. Los detalles técnicos van al log del servidor.

---

## 5. Testing

El núcleo son funciones puras, así que la mayor parte de la cobertura sale de tests unitarios sin base de datos.

**Tamaño de la fecha**

- Confirman 8, 10 o 12 → la fecha se arma con ese número, sin invitado
- Confirman 9 o 11 → se agrega un lugar de invitado y queda par
- Confirman 7 → se agrega el invitado y quedan 8, el mínimo
- Confirman 6 o menos → no hay fecha, y el error dice cuántos faltan
- Confirman 13 o más → se rechaza, es más de lo que entra en una tarde
- El invitado sin nombre permite generar parejas pero **no** abrir la fecha

**Armado de parejas**

- Los campeones vienen los dos → quedan juntos y fuera del pool
- Falta uno de los campeones → se disuelven y entran los dos al pool
- Los campeones ya repitieron una vez → esa fecha no hay defensores y se arman todas las parejas del cero
- Una pareja campeona juega exactamente 2 fechas junta, gane o pierda la segunda
- El armado ideal repite una pareja → elige el segundo más equilibrado
- La tabla quedó igual que la fecha anterior → no repite parejas
- Con cualquier pool par siempre devuelve un armado legal, para 8, 10 y 12
- El invitado entra último en el orden salvo que el admin lo mueva
- Mismo input, mismo output: determinismo

**Fixture**

- 4 parejas → 6 partidos en 3 rondas de 2, nadie descansa
- 5 parejas → 10 partidos en 5 rondas de 2, una pareja libre por ronda
- 6 parejas → 15 partidos en 5 rondas de 3, nadie descansa
- Cada pareja juega exactamente una vez contra cada otra, en todos los tamaños

**Tabla de la fecha**

- Con 4 parejas, los cuatro repartos posibles: `3-2-1-0`, `3-1-1-1`, `2-2-2-0`, `2-2-1-1`
- Desempata por diferencia de games
- Con `setsToWin > 1` aparece el escalón de diferencia de sets
- Las parejas con invitado aparecen en la tabla pero el invitado no recibe award

**Ranking**

- Cuentan los 8 mejores de 10, descartando los peores
- Invitados y ausentes no suman
- Una fecha de 6 parejas usa los 6 valores de `points`; una de 4 usa los primeros 4
- El compañero de un invitado suma los puntos completos de su posición

**Cadena de snapshots**

- Las primeras `k` fechas usan el ranking de nivel inicial
- Cada `k` fechas el snapshot se refresca con la tabla de ese momento
- El snapshot siempre es un orden total: nunca devuelve dos jugadores en la misma posición
- Una pareja que gana todo queda empatada en puntos pero ordenada en el snapshot
- Recalcular una fecha vieja reproduce el mismo snapshot que tenía entonces

**Masters**

- Los 8 resultados posibles, verificando que sólo dan campeón limpio o triple empate
- El triple empate se corta por ranking anual

**Configuración y reglas**

- Rechaza `points` con una cantidad de valores distinta de `squadSize / 2`, con un 0, o no descendentes
- Rechaza `squadSize` impar, menor que 8 o mayor que 12
- Rechaza `countBestOf` mayor que `regularMatchdays`
- El texto de reglas se renderiza sin HTML crudo ni scripts
- La página de reglas refleja la config vigente, no una copia vieja

**Integración**

- Cambiar los puntos en la fecha 5 no altera los awards de las fechas 1 a 4
- Cerrar una fecha calcula awards y actualiza el ranking
- Reclamar un perfil no altera ningún resultado histórico
- Reabrir y volver a cerrar una fecha da exactamente lo mismo

---

## 6. Decisiones registradas

Dos decisiones se tomaron con una objeción técnica sobre la mesa. Quedan anotadas para saber de dónde viene el síntoma si aparece.

### 6.1 La tabla de puntos arma las parejas

**Decisión:** el orden que arma las parejas es la tabla del campeonato.

**Objeción planteada:** la tabla mide logro, no nivel. Los puntos de una fecha dependen sobre todo de con quién te tocó jugar. Si gana la pareja formada por el mejor y el peor del grupo, el peor queda segundo en la tabla sin haber cambiado su juego. Además, el armado 1º-con-último funciona como handicap: castiga al líder y premia al último, lo que comprime la tabla y dificulta que alguien se destaque en el año.

**Síntoma a vigilar:** si hacia la fecha 6 la tabla se aplasta y nadie se despega, el origen es este.

**Alternativa disponible:** separar un ranking de nivel, fijo y ajustable a mano, que arme las parejas, dejando la tabla de puntos sólo para el campeonato.

### 6.2 Reclamo de perfil sin validación

**Decisión:** cualquiera que entra por el link elige su asiento de la lista.

**Objeción planteada:** el link circula por WhatsApp y nada impide que alguien elija el asiento equivocado, por error o de vivo.

**Mitigación:** el admin puede desvincular desde la pantalla de participantes, que hace falta igual para editar nombres y dar de baja.

---

## 7. Qué sigue

Con este diseño aprobado, el próximo paso es el plan de implementación: orden de construcción, dependencias entre piezas y criterios de aceptación por tarea.

El orden natural arranca por `core/` — el armado de parejas y el cálculo de tablas son el riesgo real del proyecto y no dependen de nada. Con eso probado, el resto es pantallas y base de datos.
