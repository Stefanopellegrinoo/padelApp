# Torneos con los deportes del registro: armar, configurar y entender las reglas

> Diseño acordado con el dueño en una sesión de brainstorming (2026-10-14),
> sección por sección. Mockups aprobados en `mockups/torneos-deportes-wizard.png`
> y `mockups/torneos-deportes-personalizar-reglas.png`. Base: rama
> `integracion/multi-disciplina-con-rapidos` @ `8e65bc6`.

## 1. Para qué

La app es para grupos de amigos. Un **torneo** es la liga del grupo: dura
semanas, tiene fechas, tabla e historial; se configura una vez. Un **torneo
rápido** es lo del día y muere ahí (no es parte de este trabajo).

El dueño quiere que crear y configurar un torneo sea **muy configurable y, a la
vez, muy fácil de entender**. La UI es lo más importante. Para lograr las dos
cosas, **cada deporte trae su ficha bien definida**: el torneo arranca
configurado solo, y el usuario cambia nada más lo que quiere.

### Criterios de éxito

- Crear un torneo de un deporte se resuelve con nombre, deporte, jugadores y
  "Crear", sin tocar ninguna perilla, y queda jugable con valores sensatos para
  ESE deporte (nadie arranca con 28 partidos en una fecha).
- Todo lo que hoy se puede configurar se sigue pudiendo configurar.
- El reglamento que ve el grupo dice lo mismo en el wizard, en "Personalizar
  reglas" y en la página Reglas, con las palabras del deporte.
- Ningún torneo existente cambia de comportamiento.

### Lo que motivó el trabajo (auditoría con capturas)

Recorrida real del flujo en base local (`ux/torneos-multideporte-audit`, #5072):
el paso "Formato" del wizard tiene ~20 controles en 3,5 pantallas con dos
deportes; jerga ("Lados", "Masters", "Refresco del orden", "Orden propio",
"Equipos fijos"); preguntas distintas según se elija uno o dos deportes; FIFA
arranca con todos contra todos (28 partidos con 8 jugadores); textos que asumen
pádel ("parejas" en individual, "la mejor dupla", "games" en goles); la tabla
de FIFA individual muestra "CLASIFICAN AL MASTERS" aunque no juegue Masters.

## 2. Alcance

**Entra:**
1. La ficha de cada deporte en `core/sports.ts` (§3).
2. Deportes de **1 o 2 por lado** en torneos: **Pádel, Ping pong, FIFA**.
3. Wizard de creación nuevo, 4 pasos (§4).
4. "Personalizar reglas": una hoja por deporte, compartida por wizard y Ajustes (§5).
5. Página Reglas generada desde la configuración, con las palabras del deporte (§6).
6. En cada fecha: "Automático" y formato de partido propio de esa fecha (§7).
7. Tabla por pareja en parejas fijas, bug del Masters, unidades y palabras desde la ficha (§8).
8. Base de datos: `disciplines.kind` sin lista, formato de partido por fecha, `AUTO` (§9).

**No entra (decidido):**
- Navegación dentro del torneo (inicio con "padel ›", tabla de FIFA sin decir
  "FIFA", íconos de la barra, volver en Stats/Reglas). Va en un diseño aparte.
- Deportes de equipo (fútbol, básquet) en torneos: necesitan lados de más de 2.
- Tenis (regla del 7-6) y vóley (set decisivo a 15).
- Torneo rápido sobre el registro.
- El "puente" rápido → fecha de torneo (sólo se mencionó para entender).

## 3. La ficha de cada deporte

Es **sólo datos** en `core/sports.ts` (el registro que ya existe). Ninguna
pantalla pregunta "¿es pádel?": le pregunta a la ficha. Sumar un deporte de 1 o
2 por lado de una familia existente es agregar su ficha.

La ficha de hoy (`label`, `unit`, `family`, `allowsDraw`, `tournaments`,
`format` + rangos para `sets`, `teams` para `goals`) suma, para torneos:

| campo | qué es | Pádel | Ping pong | FIFA |
|---|---|---|---|---|
| `modalities` | modalidades que ofrece, en orden; la primera es la marcada | rotan, fijas | individual, fijas, rotan | individual, fijas, rotan |
| formato de partido | default + qué se toca y en qué rango (ya existe para `sets`) | 1 set a 4, tie-break; sets 1–3, games 3–9 | 2 sets a 11, gana por 2; sets 1–4, puntos fijo 11 (como en amigos) | marcador abierto |
| `pointsBySides` | curva de puntos por posición según cuántos lados juegan | 10·6·3·1 (4 lados) | la curva individual que hoy usa FIFA | igual que hoy |
| `season` | fechas, cuentan las mejores, desempate cada N | 10 · 8 · 3 | 10 · 8 · 3 | 10 · 8 · 3 |
| `masters` | Masters por defecto; **nunca** en individual | sí | no | no |
| `fechaFormat` | formato de fecha por defecto | Automático | Automático | Automático |
| `firstFecha` | primera fecha por modalidad | rotan: por nivel; fijas: sorteo | individual/fijas: sorteo; rotan: por nivel | ídem ping pong |
| `words` | cómo se llama un lado y sus frases | "pareja", "la mejor pareja" | "jugador", "el mejor jugador" | "jugador" |
| `tournaments` | se puede elegir al crear un torneo | sí | **sí (nuevo)** | sí |

`unit` (ya existe) da "games" / "puntos" / "goles" a toda la copy.
Fútbol y básquet siguen con `tournaments: false`.

Los valores de Pádel y FIFA son **los que la app usa hoy** (curvas, fechas,
cuentan, desempate, Masters): la ficha los nombra, no los cambia.

## 4. Crear un torneo (wizard de 4 pasos)

Ver `mockups/torneos-deportes-wizard.png`.

1. **Nuevo torneo:** nombre + deportes como chips grandes (estilo `/rapido`),
   sacados de la ficha (`tournaments: true`). Se puede elegir más de uno.
2. **Jugadores:** el plantel, como hoy.
3. **Cómo se juega:** una tarjeta por deporte con:
   - **Modalidad**, UNA elección de hasta 3 botones: *Individual / Parejas
     fijas / Parejas que rotan* (sólo las de `modalities`). Reemplaza "Lados" y
     el checkbox "Equipos fijos". Escribe `pair_size` y `fixed_teams`.
   - **Primera fecha:** *Por nivel* (ordenás vos) / *Al azar* (sorteo) /
     *Igual que <otro deporte>* (sólo con 2+ deportes). Default según §3.
   - La ficha en una línea ("1 set a 4 games · 10 fechas · cuentan las 8
     mejores · Masters al final") y **"Personalizar reglas ›"** (§5).
   - Cambiar de modalidad reaplica lo de la ficha que depende de ella
     (Masters, curva de puntos, primera fecha).

   Subpasos que aparecen **sólo si hacen falta**:
   - **Ordená por nivel** (si algún deporte va por nivel): arrastrar; salida
     "Mejor que lo sortee la app".
   - **Armá las parejas** (si algún deporte va con parejas fijas): usa las
     parejas fijas por disciplina que ya existen; botón "Sortear parejas".
4. **Listo, así se juega:** el reglamento en criollo de cada deporte (la misma
   función que §6) + "Crear torneo" + link de invitación.

**Por dentro:**
- Al elegir un deporte, el wizard **copia su ficha** a la configuración de ese
  deporte en el torneo (§9, enfoque A). Desde ahí, el torneo tiene sus reglas.
- **Primera fecha "Al azar":** el servidor sortea y guarda el resultado **como
  orden**. El motor no cambia: el orden siempre existe y sigue sirviendo para
  armar la fecha 1 (1° con último), desempatar y sembrar grupos.
- **"Igual que <deporte>":** copia ese orden.
- Con parejas fijas, el orden es **de parejas**.
- La creación sigue siendo de una vez (todo o nada), como hoy.
- Se van del wizard: "Lados", el checkbox "orden propio" y el paso de formato
  de ~20 controles.

## 5. "Personalizar reglas" (wizard y Ajustes)

Ver `mockups/torneos-deportes-personalizar-reglas.png`.

Una hoja por deporte, **el mismo componente** al crear y en Ajustes. Viene
llena con la configuración actual (al crear, la ficha). Tres bloques:

- **El partido:** sets para ganar, games/puntos por set. Lo que la ficha fija
  (11 en ping pong) se muestra sin tocar. Goles: no hay perillas de partido.
- **La fecha:** cómo se arma (*Automático* / *Todos contra todos* / *Grupos +
  llave*) y puntos por posición.
- **La temporada:** fechas, cuentan las mejores, Masters (no aparece en
  individual), **Desempate** (antes "Refresco del orden": "Si empatan en
  puntos, gana el que iba mejor hace N fechas").

Cada número lleva una línea con su consecuencia ("Las 2 peores se descartan:
podés faltar 2 veces"). Abajo, un resumen vivo en criollo (§6). "Volver a las
reglas de <deporte>" reemplaza todo por la ficha.

**En Ajustes** (torneo ya creado):
- Se puede cambiar exactamente lo que hoy se puede (`config`, `has_masters`,
  `formato_default`, `rules_text`).
- La modalidad aparece arriba como texto: "Parejas que rotan · se elige al
  crear el torneo" (`pair_size`/`fixed_teams` no se cambian, como hoy).
- Aviso junto a Guardar: **"Los cambios valen desde la próxima fecha. Las
  fechas ya jugadas quedan como se jugaron."**
- "Agregar un deporte" a un torneo en curso usa la misma tarjeta del paso 3.

## 6. Cómo se ven las reglas

**Una sola función** arma el reglamento en criollo desde la configuración de
cada deporte + las palabras de su ficha. La usan: paso 4 del wizard, resumen de
"Personalizar reglas" y página Reglas. Nunca dicen cosas distintas.

Página Reglas (sigue pública, por link, sin cuenta), un bloque por deporte:
> **Pádel** · Parejas que rotan. La primera fecha se armó por nivel; después,
> por la tabla. Partidos a 1 set de 4 games. Gana 10, segundo 6, tercero 3,
> cuarto 1. 10 fechas, cuentan las 8 mejores. Si empatan en puntos, gana el
> que iba mejor hace 3 fechas. Masters al final con los 4 mejores.

- Debajo de cada deporte, "Reglas de la casa": el texto libre que ya existe
  (`rules_text`).
- Línea fija: "Alguna fecha puede jugarse a otra cosa: se avisa en esa fecha."

## 7. La fecha

**Automático.** Nuevo valor de formato por defecto. Mientras la fecha está en
armado, se muestra "Automático → 2 grupos + llave (vienen 8)", calculado con
`suggestFormat(headcount, sideSize, maxMatches)` (`core/knockout.ts:421`), que
es lo que hoy la pantalla muestra como "Sugerido". Se puede elegir otro, como
hoy. Al confirmar el armado se guarda el formato **concreto**: una fecha nunca
sale de armado en `AUTO`.

**A cuánto se juega esta fecha (nuevo).**
- Cada fecha tiene un formato de partido **propio y opcional**; si no tiene,
  usa el del deporte en el torneo.
- **Una sola regla** "formato efectivo de esta fecha" la usan la carga de
  resultados (dos toques, completo/incompleto), la validación del servidor, la
  tabla y los textos. Nadie lee el formato del torneo directo para una fecha.
- Editable **sólo en armado (DRAFT)**, bloqueado en la base igual que el
  formato de la fecha (`0045`).
- En el armado: "Esta fecha se juega a: 1 set a 4 games · Cambiar" (mismos
  controles que el bloque "El partido"). En la fecha y su historial: "Fecha 3 ·
  a 6 games".
- Los puntos por posición no cambian por fecha (son de la temporada).
- Límite aceptado: con fechas a distinta cantidad de sets, el desempate por
  diferencia de sets mezcla fechas distintas. Se documenta (`ponytail:`).

## 8. Tabla, textos y palabras

- **Parejas fijas:** la tabla de ese deporte muestra **una fila por pareja**
  ("Fede & Martina · 34 pts"), con las parejas de `discipline_teams`. La tabla
  general del torneo sigue por persona (cada uno suma lo de su pareja).
- **Bug del Masters:** el corte "CLASIFICAN AL MASTERS"
  (`app/torneo/[id]/tabla-view.tsx:151`) sólo con `has_masters`.
- **Unidades y palabras desde la ficha**, no desde `openScore`:
  `core/narrate.ts` (`scoreUnit`, `scoreDiffLabel`, "N games"),
  `wizard-state.ts` (hints), `jugador/[entryId]/page.tsx` ("Dif. games"),
  armado ("parejas" / "+ Agregar 2 invitados" en individual), stats ("la mejor
  dupla" no aparece en individual ni en parejas fijas).

## 9. Base de datos y modelo

**Enfoque A (elegido):** la ficha sólo pone valores iniciales; el torneo guarda
su configuración completa en las mismas columnas que hoy. Cambiar una ficha
nunca cambia un torneo en curso. (Rechazado: guardar sólo lo que el usuario
cambió y leer el resto de la ficha en vivo — cambiaría reglas a mitad de
temporada.)

Migraciones nuevas (no se reescribe ninguna existente; una función por
migración, `db/migrations.unit.test.ts`):
1. `disciplines.kind`: se va el `check (kind in ('PADEL','FIFA'))` de `0015`
   y entra el mismo chequeo de forma de id que `0093`
   (`^[A-Z][A-Z_]{0,31}$`). Filas existentes lo cumplen.
2. `disciplines.formato_default` admite `{"kind":"AUTO"}` (además de los de
   hoy). `matchdays.formato` admite `AUTO` sólo mientras la fecha está en
   DRAFT; se resuelve al confirmar el armado.
3. `matchdays.match_format jsonb null` (sets para ganar, games/puntos por set)
   + trigger que lo hace inmutable fuera de DRAFT (mismo molde que `0045`).
   Validado al escribir contra los rangos de la ficha.

Código que asume `'PADEL' | 'FIFA'` pasa a aceptar cualquier deporte del
registro (`TournamentSport` deriva de `tournaments: true`), con respaldo seguro
para un id desconocido (como el historial de amigos): `db/read.ts`,
`db/discipline.ts`, `db/season.ts`, `core/discipline-slug.ts`,
`wizard.tsx` (`Record<…>` generados desde el registro), `ajustes/disciplinas.tsx`.

**URLs:** `/padel/` y `/fifa/` no cambian; ping pong es `/ping-pong/`. El
redirect 308 de `/fechas/{n}` sigue funcionando.

## 10. No romper nada

- Torneos existentes: su configuración guardada no se toca ni se recalcula.
- Tests de torneo y de `/rapido`: no se editan, salvo copy que cambia a
  propósito, listada tarea por tarea en el plan.
- `carga-state.ts` (dos toques, compartido con `/rapido`) no cambia de
  contrato; el formato efectivo de la fecha se le pasa como hoy se le pasa el
  del torneo.

## 11. Verificación

- Unit: ficha (invariantes por deporte), reglamento en criollo por deporte y
  modalidad, formato efectivo de una fecha, `AUTO` resuelto, primera fecha
  (sorteo guardado como orden).
- DB (clientes autenticados): `kind` nuevo aceptado/mal formado rechazado;
  `match_format` editable en DRAFT e inmutable después; resultado validado
  contra el formato de la fecha.
- Navegador (Playwright, base local, 390px, claro/oscuro): crear "Pádel +
  Ping pong" (rotan por nivel + individual al azar) y "FIFA individual";
  personalizar; armar y jugar una fecha de cada uno (una con formato propio);
  ver tabla (incluida una de parejas fijas) y Reglas. Capturas para el dueño.
- Revisión por tarea + revisión final de toda la rama.

## 12. Riesgos

1. **Desempate por sets con fechas a distinto formato** (§7): aceptado y
   documentado.
2. **`AUTO` que se escapa de DRAFT:** la base lo impide (check + trigger); test DB.
3. **Copy de torneo que cambia:** los tests que fijan textos ("games",
   "parejas") se actualizan a propósito y se listan; el resto no se toca.
4. **Ping pong en carga:** el desempate (12-10…) ya existe en amigos
   (`cargar-state.ts: deuceOptions`), no en `carga-state.ts`. Decidido: la
   carga de fecha suma los botones de ventaja ("12-10") para los deportes que
   se ganan por 2, reusando `deuceOptions`/`chooseDeuce`, sin cambiar el
   contrato de `carga-state.ts`.
5. **Sorteo como orden:** el orden sorteado se guarda; re-sortear después de
   crear no es parte del alcance.
