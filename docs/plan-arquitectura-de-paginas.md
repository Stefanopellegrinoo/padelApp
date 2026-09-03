# Plan — arquitectura de páginas

Ejecuta [`arquitectura-de-paginas.md`](arquitectura-de-paginas.md), aprobado el
02/09/2026. Ese documento manda: si algo de acá lo contradice, gana el diseño.

**Base:** `feature/torneo-multi-disciplina` en `8f96d93` más la Task 0, que ya
está hecha y sin commitear.

**Cómo se ejecuta:** un agente fresco por tarea, review a ciegas entre cada una,
rondas de fix al mismo agente que implementó. Los gates los corre el orquestador
—typecheck, unit, build, y `db:reset` seguido de `test:db`, en ese orden— antes
de decir que algo está listo. Nadie más toca la base: la suite comparte una sola
y aísla por temporada, no por proceso (`vitest.db.config.ts`).

**Sin migraciones de datos.** El modelo ya es por disciplina; esto mueve
pantallas. La única migración del plan es la `0075` de la Task 0, que es un
grant.

---

## Task 0 — la capa de datos acepta config por disciplina · [hecha, sin commitear]

`createSeason` y `addDiscipline` toman `hasMasters` y `formatoDefault` opcionales
por spec, cayendo al comportamiento de hoy cuando no llegan. Migración `0075`:
`grant insert (formato_default) on public.disciplines`.

Verificado: el grant es load-bearing —comentarlo pone en rojo el test del INSERT
con `42501` y deja los otros 10 del archivo en verde— y el argumento de que el
grant es aditivo se sostiene contra `0015:52`, `0020:43-45` y `0040:73`.

Ningún caller de UI manda todavía los campos nuevos. Eso es la Task 5.

---

## Task 1 — Stats pasa a ser por disciplina

**Por qué:** §2.1 del diseño. `app/torneo/[id]/stats/page.tsx:212-222` lee
`entriesOf`/`closedHistoryAll`/`awardsOf` **sin disciplina** y saca la config de
`defaultDisciplineId`, y la pantalla no nombra en ningún lado de qué disciplina
son los números.

**Qué hace:** la pantalla se muda a `/torneo/{id}/{disc}/stats`, resolviendo la
disciplina por slug como ya hacen `[disciplina]/page.tsx` y
`[disciplina]/fechas/page.tsx` — `resolveDisciplineBySlug` + `notFound()`. Las
tres lecturas pasan a recibir la disciplina resuelta.

**Compatibilidad:** `/torneo/{id}/stats` queda como redirect a la disciplina
`[0]`, copiando la forma de `app/torneo/[id]/fechas/page.tsx:29-35`, que ya
resolvió este mismo problema para las fechas.

**Qué NO hace:** no cambia qué estadísticas se muestran ni cómo se calculan.

---

## Task 2 — el perfil del jugador pasa a ser por disciplina

**Por qué:** §2.1, y es la decisión que tomó el dueño: el perfil es por
disciplina.

**Qué hace:** `/torneo/{id}/jugador/{entryId}` se muda a
`/torneo/{id}/{disc}/jugador/{entryId}`. Misma resolución por slug. El `config`
deja de salir de `primaryDiscipline(header)` y sale de la disciplina de la URL,
y `header.regularMatchdays` —que hoy es el de la primaria (`db/read.ts:312`)—
deja de usarse acá.

**El texto que hoy miente:** con un jugador que no es miembro de la disciplina
`[0]`, la pantalla dice "Todavía no jugó esta disciplina" sin decir cuál. Con la
disciplina en la URL, ese texto por fin puede nombrarla.

**Compatibilidad:** redirect desde la URL vieja a la disciplina `[0]`.

**Qué NO hace:** no toca de dónde sale la identidad del jugador — el plantel es
del contenedor y sigue siéndolo.

---

## Task 3 — el nav se scopea a la disciplina

**Por qué:** §2.3 y §4. Depende de que existan las rutas de las Tasks 1 y 2.

**Qué hace:** Tabla, Fechas y Stats llevan `{disc}` en el destino. Reglas apunta
al contenedor, por §3.1 del diseño — es la única pantalla pública del torneo
(`middleware.ts:80`) y es el link que se comparte.

**Lo que se arregla de yapa:** hoy `nav.tsx:42` manda "Tabla" a la raíz, que con
una sola disciplina redirige — o sea que todo torneo real paga un redirect en
cada toque de la pestaña más tocada de la app, según el comentario del propio
`nav.tsx`. Con la disciplina en la URL, el nav apunta directo.

**Y lo que deja de poder pasar:** el `?? defaultDisciplineSlug` de `nav.tsx:58`
se queda sin casos donde disparar, porque ninguna pestaña scopeada deja la URL
sin disciplina. Entrar por FIFA y salir por pádel deja de ser posible.

**Cuidado:** `NON_DISCIPLINE_SEGMENTS` (`nav.tsx:19`) y el `isActive` de Tabla
(`:46-51`) están escritos contra la forma vieja de las URLs. Hay que releerlos
enteros, no parchearlos.

---

## Task 4 — Ajustes se parte en contenedor y disciplina

**Por qué:** §2.5. Hoy `app/torneo/[id]/ajustes/page.tsx` mezcla las dos alturas
en un scroll, con un ancla `#formato` que siempre cae en la primera disciplina y
un aviso de plantel calculado sólo sobre `[0]`.

**Qué hace:**

- `/torneo/{id}/ajustes` queda con lo del contenedor: nombre, plantel, link de
  invitación, borrar, y la lista de disciplinas con link a los ajustes de cada
  una.
- `/torneo/{id}/{disc}/ajustes` nace con lo de la disciplina: config, Masters,
  formato por defecto, reglas.

**El caso de una disciplina manda (§5 del diseño):** con una sola, el usuario
tiene que seguir viendo **un** Ajustes, no dos. La partición sólo aparece con 2+.

**Qué NO hace:** no agrega "quién juega esta disciplina" — eso es §2.6 y queda
para después, porque es superficie nueva y no una mudanza.

---

## Task 5 — el wizard configura cada disciplina

**Por qué:** §2.4, y es la queja original. Es la última porque es la más grande y
porque las Tasks 1-4 establecen la forma que ésta tiene que seguir.

**Qué hace:** el paso "Formato" deja de ser uno y pasa a ser uno **por
disciplina elegida**. La Task 0 ya dejó a `createSeason` listo para recibirlas
distintas.

**Lo medido, para no re-derivarlo:** `buildDisciplines`
(`wizard-state.ts:149-156`) mapea cada disciplina por `disciplineProfile(kind,
config)` con el mismo objeto `config`, y `disciplineProfile`
(`core/config.ts:132-143`) sólo varía `matchFormat.openScore` y `allowsDraw`. El
aplanado está entero acá; la base nunca lo tuvo.

**Cuidado con el caso simple:** con una sola disciplina el paso tiene que verse
exactamente como hoy. Nadie debería enterarse de que ahora es "por disciplina"
hasta que marque la segunda.

**Qué NO hace:** no agrega al wizard `weight`, `fixed_teams` ni la membresía por
disciplina.

---

## Lo que este plan deja afuera, a propósito

- **El desempate de la tabla global** — §2.4 de
  [`tipos-de-torneo.md`](tipos-de-torneo.md), primera mitad. Sigue abierto y
  necesita una decisión de producto sobre qué regla desempata.
- **`fixed_teams`, `weight` y `discipline_teams`** — tres cosas construidas sin
  puerta. `fixed_teams` es §1 de ese spec, con todo el lado de lectura cableado
  en `generatePairs`. Merecen su propia tanda.
- **La membresía por disciplina** (§2.6 del diseño). Superficie nueva.
- **`/amigos`** — entra por el menú de la cuenta, no tiene vuelta atrás y no
  linkea a ningún torneo. Es otro documento.
- **El vocabulario.** Seis cosas se llaman "formato", `kind` son cinco enums
  distintos, "fecha" es una jornada y también una fecha del calendario. No se
  toca en este plan, pero cualquier pantalla nueva que nombremos acá arrastra el
  problema.

---

## Orden y por qué

1. **Task 1** (Stats) y **Task 2** (perfil) — mudanzas parejas, la 2 copia la
   forma de la 1.
2. **Task 3** (nav) — necesita que las rutas de 1 y 2 existan.
3. **Task 4** (Ajustes) — independiente de las anteriores, pero se hace después
   para no tener dos cambios grandes de navegación en vuelo a la vez.
4. **Task 5** (wizard) — última, la más grande, y la que cierra la queja que
   originó todo.

Las Tasks 1 y 2 dejan la app navegable en cada paso. Ninguna necesita a la
siguiente para no romper nada.
