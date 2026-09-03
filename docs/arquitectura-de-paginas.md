# Arquitectura de páginas — diseño

**Escrito el 02/09/2026**, contra `feature/torneo-multi-disciplina` en `8f96d93`
más la rebanada sin commitear de `0075`. Todas las referencias `archivo:línea`
fueron abiertas y verificadas contra ese árbol.

Este documento no es un plan: es la forma que tienen que tener las páginas y por
qué. Los planes salen de acá.

---

## 0 · El reencuadre

El principio ya estaba escrito, en palabras del dueño del producto, y vive en
[`tipos-de-torneo.md:43-47`](tipos-de-torneo.md):

> *"un torneo multidisciplina es un torneo con dos o más deportes juntos, pero
> cada torneo es independiente."* El torneo es un contenedor; cada disciplina
> adentro es un torneo independiente — su config, sus fechas, su tabla, sus
> reglas. Comparten el plantel, el nombre y el link de invitación.

**La base de datos ya lo implementa.** Cada fila de `disciplines` tiene su
`config`, su `has_masters`, su `rules_text`, su `formato_default`. El desacuerdo
no está en el modelo: está en las pantallas.

Esto arrancó por una queja concreta sobre el wizard —*"cuando creo el torneo
tengo que configurar cada disciplina, no después"*— pero el wizard resultó ser
una instancia de un patrón más grande, no la causa.

---

## 1 · La regla

**Si la disciplina es un torneo independiente, la disciplina va en la URL de
todo lo que pertenezca a ese torneo independiente.**

Lo que queda afuera de esa regla es exactamente lo que el principio nombra como
compartido: el nombre, el plantel y el link de invitación.

Una pantalla que muestra datos de una disciplina sin decir cuál en la URL ni en
el encabezado está mintiendo por omisión, y hoy hay dos.

---

## 2 · Lo medido — dónde la app desobedece hoy

### 2.1 Dos pantallas son la disciplina `[0]` disfrazadas de torneo

`app/torneo/[id]/stats/page.tsx:212-222` pide `entriesOf(supabase, seasonId)`,
`closedHistoryAll(supabase, seasonId)` y `awardsOf(supabase, seasonId)` **sin
disciplina**, y saca la config de `defaultDisciplineId`. Un grep de
`DISCIPLINE_LABELS` sobre ese archivo **no devuelve nada**: la pantalla nunca
nombra la disciplina cuyos números muestra. El encabezado dice "Estadísticas".

`app/torneo/[id]/jugador/[entryId]/page.tsx` hace lo mismo: identidad desde el
plantel de la temporada, estadísticas sin disciplina, y `config` de
`primaryDiscipline(header)`.

Con pádel y FIFA en el mismo torneo, las dos muestran pádel y ninguna lo dice.

### 2.2 `defaultDisciplineId` es "la primera", y decide en catorce lugares

`db/season.ts:57-64` la define como `.order('position')` más
`.order('created_at')` y `.limit(1)`. No es una
preferencia del usuario ni una elección informada: es el orden de inserción.
Catorce consumidores dependen de ella, entre ellos las dos pantallas de §2.1, el
orden del plantel de la temporada (`db/read.ts`, `seasonSeedOrder`), el conteo
de fechas del modal de borrar y la fila "Próxima fecha" de Mis torneos.

### 2.3 La navegación pierde la disciplina en silencio

`app/torneo/[id]/nav.tsx:58` arma el destino de "Fechas" como
`${base}/${currentDisciplineSlug ?? defaultDisciplineSlug}/fechas`, y
`currentDisciplineSlug` sale de la URL actual — es `null` en Stats, Reglas y
Ajustes.

Consecuencia concreta: estás en `/torneo/{id}/fifa/fechas/3`, tocás **Stats** y
ves pádel; desde ahí tocás **Fechas** y caés en las fechas de **pádel**.
Entraste por FIFA y saliste por pádel sin un solo cartel.

### 2.4 Crear es a nivel torneo, todo lo demás es a nivel disciplina

El paso "Formato" del wizard recibe **un** `SeasonConfig`
(`app/torneos/nuevo/wizard.tsx`) y `buildDisciplines`
(`app/torneos/nuevo/wizard-state.ts:149-156`) lo pone en todas las disciplinas
elegidas. `disciplineProfile` (`core/config.ts:132-143`) sólo varía dos cosas
según el deporte: `matchFormat.openScore` y `allowsDraw`. Los puntos, las fechas
del año, cuántas cuentan y el refresco del desempate son el mismo objeto.

Después, Ajustes ofrece Formato, Formato de las fechas y Reglas **por
disciplina**. **El mismo campo vive en dos alturas según cuándo lo tocás.**

### 2.5 Ajustes es un scroll para dos entidades

`app/torneo/[id]/ajustes/page.tsx` mezcla lo del contenedor —nombre, plantel,
link, borrar— con N paneles apilados por disciplina, un ancla `#formato` que
siempre cae en la primera, y un aviso de plantel calculado sólo sobre `[0]`. El
dolor crece linealmente con la cantidad de disciplinas.

### 2.6 La membresía por disciplina no tiene superficie

`discipline_entries` se llena al crear —todos los asientos en todas las
disciplinas— y en "+ Agregar disciplina" con un subconjunto. **Después no hay
ninguna pantalla para agregar o sacar a alguien de una disciplina.** `entriesOf`
descarta a los no-miembros en silencio.

---

## 3 · El mapa de rutas

| hoy | propuesto | por qué |
|---|---|---|
| `/torneo/{id}` — tabla global, o redirect con una sola disciplina | **el contenedor**: nombre, lista de disciplinas, y la tabla global sólo si hay 2+ | es lo compartido |
| `/torneo/{id}/{disc}` — tabla | igual | ya obedece |
| `/torneo/{id}/{disc}/fechas` | igual | ya obedece |
| `/torneo/{id}/{disc}/fechas/{n}` | igual | ya obedece |
| `/torneo/{id}/stats` → disciplina `[0]` | `/torneo/{id}/{disc}/stats` | §2.1 |
| `/torneo/{id}/jugador/{entryId}` → disciplina `[0]` | `/torneo/{id}/{disc}/jugador/{entryId}` | §2.1, decisión del dueño: el perfil es por disciplina |
| `/torneo/{id}/ajustes` — todo junto | **contenedor**: nombre, plantel, link, borrar, lista de disciplinas | §2.5 |
| — | `/torneo/{id}/{disc}/ajustes`: config, Masters, formato por defecto, reglas, quién juega | §2.5, §2.6 |
| `/torneo/{id}/reglas` — pública, un bloque por disciplina | **igual** | ver §4 |
| `/torneo/{id}/fechas` — redirect a `[0]` | igual | ya obedece, es compatibilidad |

### 3.1 Reglas se queda en el contenedor, y no es una excepción arbitraria

`middleware.ts:80` es `path.startsWith('/torneo/') && !path.endsWith('/reglas')`:
**Reglas es la única pantalla del torneo que se ve sin cuenta.** Es el link que
se le manda al grupo. Ese artefacto es "las reglas de nuestro torneo", con un
bloque por disciplina — que es exactamente lo que ya hace.

Moverla a `/{disc}/reglas` seguiría siendo pública (el chequeo es por sufijo),
pero partiría en N links lo que se comparte como uno.

### 3.2 Qué vive dónde

| contenedor (`seasons`) | disciplina (`disciplines`) |
|---|---|
| nombre | `config`: puntos, fechas del año, cuántas cuentan, refresco del desempate, sets/games |
| plantel (los asientos) | `has_masters` |
| link de invitación | `formato_default` |
| la lista de disciplinas | `rules_text` |
| la tabla global (sólo con 2+) | `pair_size`, `allows_draw` (se fijan al crear) |
| borrar el torneo | quién del plantel juega esta disciplina |

---

## 4 · La navegación

Las pestañas pasan a estar **scopeadas a la disciplina actual**: Tabla, Fechas y
Stats llevan `{disc}` en el destino. Reglas apunta al contenedor, por §3.1.

**El contenedor es el selector de disciplina.** No hace falta un control nuevo:
`/torneo/{id}` ya lista las disciplinas con un link a cada una. Cambiar de
disciplina es volver al contenedor y entrar a la otra — dos toques para una
acción rara, y cero UI nueva.

Esto además arregla §2.3 por consecuencia: si Stats vive bajo `{disc}`, la URL
nunca se queda sin disciplina, y el `?? defaultDisciplineSlug` de `nav.tsx:58`
deja de tener casos donde disparar.

---

## 5 · El caso de una sola disciplina manda

**El 100% de los torneos que existen hoy tienen una sola disciplina**, en
producción y en la rama. Cualquier diseño que le cobre un peaje al caso simple
para servir al multi-disciplina está mal.

La regla: **con una sola disciplina, el contenedor no se ve.** Ya es así para la
tabla —`/torneo/{id}` redirige a la única disciplina— y tiene que seguir siendo
así para Ajustes: con una disciplina, "Ajustes" es un solo lugar, no dos.

La deuda ya anotada de ese redirect entra acá: `nav.tsx` manda "Tabla" a la raíz,
así que hoy todo torneo real paga un redirect en cada toque de la pestaña más
tocada de la app. Con la disciplina en la URL de todas las pestañas, el nav puede
apuntar directo y el peaje desaparece.

---

## 6 · La creación

Con la regla de §1, el wizard deja de ser un caso especial: crear es **armar el
contenedor y después configurar cada disciplina**, que es la misma forma que
tiene el resto de la app.

Lo que ya está hecho para esto: `createSeason` y `addDiscipline` aceptan
`hasMasters` y `formatoDefault` opcionales por disciplina, y la migración `0075`
suma el `grant insert (formato_default)` que eso necesita. `config` **siempre**
fue por disciplina en la base — el aplanado vive entero en el wizard.

Lo que falta es la pantalla: el paso "Formato" tiene que ser uno **por
disciplina elegida**, no uno compartido.

---

## 7 · Lo que este diseño NO hace

- **No toca el modelo.** Ni una migración de datos: la base ya es por disciplina.
- **No resuelve el desempate de la tabla global** (§2.4 de
  [`tipos-de-torneo.md`](tipos-de-torneo.md), primera mitad). Sigue abierto.
- **No le da superficie a `fixed_teams`, `weight` ni `discipline_teams`.** Son
  tres cosas construidas sin puerta, y merecen su propia tanda. `fixed_teams` en
  particular es §1 de ese spec, con todo el lado de lectura cableado en
  `generatePairs`.
- **No mueve `/amigos`.** Entra por el menú de la cuenta, no tiene vuelta atrás y
  no linkea a ningún torneo. Es un problema real y es otro documento.
- **No reordena disciplinas.** `disciplines.position` no tiene UI, y cambiarla
  reescribiría los slugs de las URLs (`core/discipline-slug.ts`).

---

## 8 · Riesgos

| riesgo | dónde | mitigación |
|---|---|---|
| **Links viejos rotos** | `/torneo/{id}/stats` y `/torneo/{id}/jugador/{e}` dejan de existir | redirect a la disciplina `[0]`, igual que ya hace `/torneo/{id}/fechas` (`app/torneo/[id]/fechas/page.tsx:33-35`). Es el mismo patrón, ya probado |
| **Ajustes partido en dos duele con una sola disciplina** | §5 | con una disciplina, un solo Ajustes. La partición sólo aparece con 2+ |
| **El nav queda con tres pestañas por disciplina y una del contenedor** | §4 | es asimétrico a propósito y §3.1 dice por qué. Si molesta, la alternativa es un bloque de reglas por disciplina bajo `{disc}` más un índice público en el contenedor — más caro |
| **`defaultDisciplineId` no desaparece** | §2.2 | queda para los redirects de compatibilidad y para Mis torneos, que es legítimamente del contenedor. Lo que se va es su uso como fuente de contenido sin decirlo |

---

**Fuentes:** el principio y el modelo, [`tipos-de-torneo.md:43-47`](tipos-de-torneo.md);
el relevamiento de rutas, navegación, colisiones de vocabulario y estado de los
docs, hecho el 02/09/2026 contra `8f96d93`.
