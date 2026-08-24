# Handoff: Padel Liga — app de campeonato para grupos

> **HISTÓRICO — el handoff de diseño original.** Describe la app de pádel, un
> deporte por torneo, que es lo que está ONLINE hoy. `torneo-multi-disciplina`
> (en la rama, sin publicar) le agrega varias disciplinas por torneo, lados de
> a uno y grupos + llave. Ver [`../estado.md`](../estado.md).

## Overview

App móvil para grupos que juegan un campeonato de pádel a lo largo del año (12 fechas + Masters). El plantel es de 8 a 12 jugadores; cada fecha la juegan los que confirman, y la app arma las parejas, registra los resultados y mantiene la tabla general.

El problema que resuelve: hoy esto se lleva en una planilla y un grupo de WhatsApp. La app reemplaza eso con una tabla que se actualiza sola, parejas generadas por regla (no por discusión) y carga de resultados en dos toques.

13 pantallas, todas en un solo prototipo navegable.

> ## Nota: Los prototipos muestran el caso de 8 — la app soporta 8, 10 y 12
>
> Los archivos `.dc.html` de este bundle se generaron sobre una versión anterior
> del formato, donde el plantel era **fijo en 8** y el invitado **reemplazaba** a
> un ausente. Las dos cosas cambiaron. Este README ya está corregido; los
> prototipos HTML **no** — leelos como "así se ve una fecha de 8", que es el caso
> más común, no como el límite del formato.
>
> **Lo que cambió, en dos líneas:**
>
> 1. **El plantel es de 8 a 12** y el tamaño de la fecha sale de quiénes confirman:
>    4, 5 o 6 parejas. Toda lista que el prototipo dibuja con 8 filas (o 4) es de
>    largo variable.
> 2. **El invitado es un lugar extra, no un reemplazo.** Si confirman impar, la app
>    agrega un asiento de invitado para poder armar parejas. El ausente
>    simplemente no juega esa fecha.
>
> **Impacto visual real:** casi ninguno. Colores, tipografía, espaciado, radios,
> componentes y comportamiento valen tal cual — una lista de 8 filas y una de 12
> se ven igual. Sólo **dos** pantallas necesitan un layout distinto, y están
> marcadas abajo con : el **paso 4 del wizard** (6 valores de puntos no entran
> en 4 columnas) y la **Fecha en juego** (15 partidos no entran en el layout de 6).

## About the Design Files

Los archivos de este bundle son **referencias de diseño hechas en HTML** — prototipos que muestran el aspecto y el comportamiento buscados, no código de producción para copiar.

La tarea es **recrear estos diseños en el entorno del codebase destino** (React Native, Swift, Flutter, React web, lo que corresponda) usando sus patrones y librerías establecidas. Si todavía no hay codebase, elegir el framework más apropiado — dado que es una app móvil de uso frecuente y offline-tolerante, React Native o Swift/Kotlin nativo son los candidatos naturales — e implementar ahí.

El prototipo es un Design Component: template HTML + una clase de lógica JS. No hay stylesheet: todos los estilos son inline. Los valores de color se resuelven vía CSS custom properties definidas en `<helmet>` (light) y sobreescritas por un objeto JS (dark). Ver "Design Tokens".

**Andamiaje de revisión — no es parte de la app.** Arriba del teléfono hay filas de chips (Light/Dark, Mis torneos/Vacío/Landing/Registro/Unirse/Ajustes, Jugador/Admin, Fecha draft/open/closed). Existen sólo para navegar el prototipo y mostrar estados que en la app real dependen del rol del usuario y del backend. **No implementar.**

## Fidelity

**Alta fidelidad.** Colores, tipografía, espaciado, radios y comportamiento de interacción son finales. Recrear la UI fielmente usando las librerías del codebase.

Dos salvedades:
- Los **campos de texto no son inputs reales** en el prototipo. Se simulan con `<span>` que al tocarse rellenan un valor válido, para poder mostrar los estados de error sin teclado. En la implementación son inputs normales con validación en vivo.
- Los **datos son fijos** (nombres, puntajes, resultados). Vienen del backend.

## Screens / Views

Orden de implementación sugerido: Tabla → Fecha → Fechas son las tres que definen el vocabulario visual; el resto reutiliza esos patrones.

Marco común de todas las pantallas internas:
- Status bar simulada (no implementar; la da el SO).
- **Header**: kicker en mayúsculas 10.5px/800/letter-spacing .14em color `muted`, sobre título 26px/800/letter-spacing -.03em. A la derecha, botón circular 36px (⚙ en Tabla si sos admin) o pill "← Volver" (36px alto, padding 0 14px, fondo `chip`).
- **Contenido**: scroll vertical, padding lateral 20px, padding inferior 24px.
- **Bottom nav**: 4 ítems (Tabla, Fechas, Stats, Reglas), borde superior 1px `line`, padding 12px 22px 24px. Cada ítem: cuadrado/círculo de 19px con borde 2px currentColor (relleno sólido si está activo) + label 9.5px/800. Activo usa `accent-link`, inactivo `muted`.
- Landing, Registro/Login y Unirse van **sin header y sin nav**, a pantalla completa.

---

### 1. Landing

**Purpose**: primera pantalla para quien no tiene cuenta.

**Layout**: columna, padding 0 24px 26px, sin header ni nav. Logo arriba (cuadrado 26px radio 7px en `accent` + wordmark 14.5px/800). Bloque central centrado verticalmente (`flex:1`, `justify-content:center`), CTAs abajo.

**Components**:
- Titular: 40px / line-height 1.02 / weight 800 / letter-spacing -.035em, `text-wrap: pretty`. Copy: "El campeonato del grupo, sin planillas."
- Bajada: 15.5px/500/line-height 1.5, color `muted`. Copy: "Parejas nuevas cada fecha y una tabla que se actualiza sola. Vos cargás quién ganó, la app hace el resto."
- 3 bullets: check en círculo 22px fondo `ok-bg` color `up` (11px/800) + texto 14px/600/line-height 1.45, gap 11px.
  1. "Las parejas se arman solas cruzando la tabla, sin discusiones."
  2. "Cargás el resultado en dos toques, sin teclado."
  3. "Cada uno ve su posición, su racha y con quién le va mejor."
- CTA primario "Crear mi torneo": full width, padding 16px, radio 12px, fondo `accent`, texto `accent-text` 15px/800 → va a Registro.
- CTA secundario "Ya tengo cuenta": mismo tamaño, borde 1.5px `line`, sin fondo → va a Login.
- Nota al pie 12.5px/550 color `muted`, centrada: "¿Te pasaron un link de invitación? Abrilo y elegí tu nombre."

---

### 2. Registro / 3. Login

**Purpose**: crear cuenta o entrar. Son la misma pantalla con distinto set de campos.

**Layout**: columna, padding 16px 24px 26px. Fila superior: "← Volver" a la izquierda, link de intercambio a la derecha (12.5px/750 color `accent-link`, dice "Iniciar sesión" en Registro y "Crear cuenta" en Login). Bloque central centrado. CTA abajo.

**Components**:
- Título 30px/800/letter-spacing -.03em: "Creá tu cuenta" / "Entrá a tu cuenta".
- Bajada 14px/550 color `muted`:
  - Registro: "Sólo para poder volver a entrar desde otro teléfono. Nada más."
  - Login: "Con el mail que usaste cuando entraste al torneo."
- Campos (Registro: Tu nombre, Mail, Contraseña · Login: Mail, Contraseña):
  - Label 11.5px/800 color `muted`.
  - Input: padding 15px, radio 12px, borde 1.5px `line` (→ `live` si hay error), fondo `surface`, texto 15.5px/700 (`muted` y weight 500 si está vacío mostrando placeholder).
  - Campo contraseña: enmascarado con •, con link "Ver"/"Ocultar" a la derecha (11.5px/800 color `muted`).
  - Error debajo: 12px/700 color `live`.
- Login tiene "Olvidé mi contraseña" (12.5px/750, `accent-link`) alineado a la izquierda.
- CTA "Crear cuenta"/"Entrar": full width, padding 16px, radio 12px. Deshabilitado (fondo `chip`, texto `muted`) mientras haya error.
- Registro cierra con legal 11.5px/550 centrado: "Al crear la cuenta aceptás los términos y la política de privacidad."

**Validación**:
- Mail: regex `/^[^@\s]+@[^@\s]+\.[^@\s]+$/`. Error: "Escribí un mail válido, con @ y dominio."
- Contraseña (sólo en Registro): mínimo 6 caracteres. Error: "Mínimo 6 caracteres."
- El submit deshabilitado no navega. Registro exitoso → Mis torneos (estado vacío).

> El prototipo arranca con mail y contraseña inválidos a propósito, para exhibir los errores.

---

### 4. Unirse (por link de invitación)

**Purpose**: alguien abre el link que le pasaron y reclama su asiento en el torneo.

**Layout**: sin header ni nav. Padding 16px 24px 26px, gap 20px. CTA anclado abajo (`margin-top:auto`).

**Components**:
- Kicker "Te invitaron a" + nombre del torneo 32px/800/letter-spacing -.03em + meta 14px/550 `muted`: "{n} jugadores · 12 fechas · organiza Marce" (n = tamaño del plantel, 8 a 12).
- Label "¿Cuál sos vos?" 11.5px/800 `muted`.
- Lista de asientos, uno por integrante del plantel (8 a 12). Cada uno: avatar 30px circular con iniciales (11px/800), nombre 15px/650, tag a la derecha 11.5px/800.
  - **Libre**: borde `line`, fondo `surface`, tocable.
  - **Tomado**: opacity .45, tag "Ya entró", no tocable.
  - **Elegido**: borde 1.5px `accent`, fondo `ok-bg`, avatar en `accent`, nombre weight 800, tag "Sos vos" en color `up`.
- CTA: "Elegí tu nombre" deshabilitado (fondo `chip`) → al elegir pasa a "Entrar como {nombre}" en `accent`.
- Nota al pie 12px/550 `muted`: "Si tu nombre no está o ya lo tomó otro, avisale a Marce."

---

### 5. Mis torneos

**Purpose**: elegir en qué torneo entrar; crear uno nuevo.

**Layout**: sin bottom nav (es un nivel por encima del torneo). Header: kicker con el nombre del usuario, título "Mis torneos".

**Components (con torneos)**:
- Tarjeta de torneo: padding 16px, radio 16px, borde 1px `line`, fondo `surface`.
  - Nombre 18px/800/letter-spacing -.02em + chip de estado (10.5px/800, padding 6px 10px, radio 99px, fondo `ok-bg`, color `up`).
  - Fila inferior en dos columnas separadas por un divisor vertical de 1px × 26px: "Mi posición" (2°) y "Próxima fecha" (jue 27 ago). Labels 9.5px/800/uppercase/letter-spacing .13em `muted`, valores 15px/800.
- CTA "Crear torneo" full width en `accent`.
- Separador "Terminados" (label 9.5px/800/uppercase + línea 1px que ocupa el resto).
- Torneos terminados: fila compacta con opacity .6, nombre 15px/750, detalle 12px/600 `muted`, posición final a la derecha.

**Estado vacío**:
- Título 22px/800: "Todavía no estás en ningún torneo".
- Cuerpo 14px/550 `muted`: "Creá el tuyo y compartí el link con el grupo. Si alguien ya te pasó un link de invitación, abrilo y elegí tu nombre de la lista."
- Único CTA: "Crear torneo".

---

### 6. Crear torneo (wizard de 5 pasos)

**Purpose**: el organizador configura el campeonato.

**Layout**: sin bottom nav. Header: kicker "Paso N de 5", título del paso ("Nombre", "El plantel", "Orden inicial", "Formato", "Listo"). "← Volver" retrocede un paso, y desde el paso 1 sale a Mis torneos.

**Componentes comunes**:
- Barra de progreso: 5 segmentos `flex:1`, alto 4px, radio 99px. Completados en `accent`, pendientes en `line`.
- Texto de ayuda por paso: 13.5px/550 `muted`.
- Pie: CTA "Continuar" full width (en el paso 5, "Ir al torneo"). El paso 4 suma un botón secundario "Usar los defaults" a la izquierda, con borde 1.5px `line`.

**Paso 1 — Nombre**: un campo, borde 1.5px `accent` (activo), texto 17px/750. Ayuda: "Como lo llaman en el grupo. Se puede cambiar después."

**Paso 2 — El plantel**: lista de campos numerados, **de 8 a 12**. Arranca con 8 campos. Vacíos → borde `accent`, texto placeholder `muted` weight 500.

- Debajo del último campo, un botón "+ Agregar jugador" (borde 1.5px `line`, padding 13px, radio 12px, texto 14px/750 `muted`), que desaparece al llegar a 12. Cada campo agregado tiene una ✕ de 28px a la derecha para sacarlo, deshabilitada mientras haya 8.
- Contador a la derecha del label: "{n} jugadores" 11.5px/800 `muted`.
- **Avisos** en `live-bg` / `live`, con Continuar deshabilitado:
  - Con menos de 8 nombres cargados: "Falta 1 nombre. El plantel arranca en 8."
  - Con el plantel en número impar: "Son 9. El plantel tiene que ser par para poder armar parejas." *(la app agrega un invitado cuando una **fecha** da impar, pero el plantel se carga par)*
- Ayuda: "Tipeá los nombres del grupo, de 8 a 12. Después compartís un link y cada uno elige el suyo. No hace falta que vayan todos a todas las fechas."

**Paso 3 — Orden inicial**: lista reordenable. Cada fila: handle ⠿, número, nombre 15px/700, y dos botones cuadrados de 34px (↑ ↓) con fondo `chip` radio 9px. En producción usar drag & drop nativo, manteniendo las flechas como alternativa accesible. Ayuda: "Ordenalos del mejor al peor. Es el criterio que corta los empates hasta que haya fechas jugadas, y de ahí salen las primeras parejas."

**Paso 4 — Formato**  *(el bloque de puntos cambia de layout respecto del prototipo)*:

- **Puntos por posición** — el prototipo los dibuja como **4 columnas**, y eso no escala: un plantel de 12 necesita **6 valores**, y seis columnas en 342px útiles dan 57px cada una, sin lugar para el valor más los dos botones.
  **Pasan a filas**, que es el patrón que este mismo paso ya usa más abajo: una fila por posición, `1°` a la izquierda (13px/800 `muted`, ancho fijo 28px), valor 20px/800 al centro, − / + de 34px a la derecha. Alto de fila 56px, separadas por 1px `line`. Funciona igual con 4 filas que con 6, y ya no hay que reflowear nada.
  La cantidad de filas **sale del paso 2**: `plantel / 2`. Defaults 10 · 7 · 5 · 3 · 2 · 1, recortados a las primeras N.
  Ayuda encima del bloque: "Son los puntos de cada posición de la fecha. Si una fecha la juegan menos parejas, se usan los primeros de la lista — ganar siempre suma {puntos[0]}."
- 5 filas con stepper (− valor +, botones 34px): Sets por partido (1, rango 1–3), Games por set (4, rango 3–9), Fechas del año (12, rango 4–24), Cuentan las mejores (9, rango 1–24), Refresco del orden (3, rango 1–6). Cada una con hint de una línea explicando la consecuencia.
- **Validaciones**: los puntos deben ser estrictamente decrecientes y > 0 → "Los puntos tienen que ir de mayor a menor y ninguno puede quedar en cero."; "cuentan las mejores" no puede superar "fechas del año" → "No pueden contar más fechas de las que se juegan." Los campos en falta toman borde `live` y Continuar se deshabilita.
- "Usar los defaults" salta al paso 5 restaurando los puntos por defecto del tamaño de plantel elegido y 1/4/12/9/3.
- Ayuda: "Todos tienen un valor que ya funciona. Si no te importa, seguí de largo."

**Paso 5 — Listo**:
- Tarjeta en `accent`: label "Link de invitación", URL 13.5px/700 con `word-break: break-all`, botón "Copiar link" (fondo `accent-text`, texto `accent`) que pasa a "Copiado ✓", y nota "Pegalo en el grupo. Cada uno elige su nombre de la lista al entrar."
- Tabla resumen (Nombre, Jugadores, Formato, Puntos, Fechas, Desempate) en filas separadas por 1px `line`: clave 13px/600 `muted` a la izquierda, valor 13.5px/750 a la derecha.

---

### 7. Tabla (home del torneo)

**Purpose**: pantalla principal. Dónde estoy parado y qué viene.

**Layout**: header (kicker "Fecha 6 de 12 · en curso", título del torneo, ⚙ si sos admin) + contenido con gap 12px + nav.

**Components**:

1. **Tarjeta de próxima fecha** — padding 16px, radio 16px, fondo `accent`, texto `accent-text`.
   - Kicker "Próxima fecha" (opacity .75) + "Fecha 7 · jue 27 ago" 21px/800.
   - Chip de hora a la derecha: fondo `accent-text`, texto `accent`, radio 99px.
   - Estado *voy*: bloque "Estás anotado" (fondo `rgba(255,255,255,.16)`) + botón "No voy" con borde `rgba(255,255,255,.4)`.
   - Estado *no voy*: bloque explicativo "Avisaste que no vas. Te reemplaza **Pablo (invitado)**." + botón "Sí voy" en `accent-text`. **La acción es reversible.**

2. **Tarjeta de campeones defensores** — radio 16px, fondo `surface`, borde 1px `line`. Kicker + nombres 15px/800 + detalle 12px/550 `muted` ("Ganaron la fecha 6 · les queda 1 defensa") + chip "Repiten" (`ok-bg`/`up`).

3. **Encabezado "Tabla general"** (15px/800) con botón "Orden de desempate ⇅" a la derecha: padding 8px 12px, radio 99px, borde 1px `line`, fondo `surface`, 11.5px/800 `muted`.

4. **Filas de jugador** (una por integrante del plantel, 8 a 12) — padding 12px, radio 12px, tocables → Perfil.
   - Posición 14px/800 `muted` (ancho fijo 16px).
   - Avatar circular 30px con iniciales; el 1° usa fondo `accent` / texto `accent-text`, el resto `chip`/`muted`.
   - Nombre 15px/700. Si está empatado en puntos con un vecino, lleva un chip **ⓘ** al lado (10px/800, borde 1px `line`) que abre el sheet de desempate.
   - Movimiento (ancho 28px, alineado a la derecha): "▲2" en `up`, "▼1" en `down`, "—" en `muted`.
   - Puntos 17px/800 (ancho 34px, derecha).
   - La fila del 1° lleva fondo `chip`.
   - **Corte de clasificación** después del 4°: línea de 1px con la etiqueta "Clasifican al Masters" (9.5px/800/uppercase `muted`) entre dos segmentos de línea.

5. **Bottom sheet "Orden de desempate"** — abre desde el botón o desde cualquier ⓘ.
   - Overlay `scrim`, hoja con radio 22px arriba, handle de 38×4px centrado.
   - Kicker "Orden de desempate" + título "Quién va antes" 20px/800.
   - Si se abrió desde un ⓘ: bloque de respuesta en `ok-bg` con la frase derivada de los dos jugadores empatados — "{A} va antes que {B}. Están 47 a 47 y corta el orden del cierre de la fecha 3." A y B se calculan buscando el otro jugador con los mismos puntos y ordenándolos por la lista de desempate; los dos quedan resaltados en la grilla.
   - Grilla de 2 columnas con el plantel entero en orden de desempate (4 a 6 filas según el tamaño).
   - Explicación 12.5px/550 `muted`: "Es la tabla al cierre de la fecha 3. Se actualiza cada 3 fechas: el próximo refresco es al cerrar la fecha 9. Corta los empates de puntos y de ahí salen las parejas de cada fecha."
   - Botón "Entendido" (fondo `chip`).

---

### 8. Fechas

**Purpose**: calendario del año.

**Components**:
- Si sos admin: CTA "Abrir fecha 7" arriba de todo, fondo `accent`.
- Tarjeta por fecha: padding 14px, radio 14px, borde 1px `line`, fondo `surface`.
  - Fila superior: "Fecha 6 · jue 13 ago" (10.5px/800/uppercase `muted`) + tag ("Jugada" / "Por jugarse", 10.5px/800, radio 99px; el tag de jugada lleva fondo `chip`).
  - Jugadas: campeón 15px/800 + detalle 11.5px/700 `muted` ("3–0 · +9 games").
  - Por jugarse: `opacity: .62`, sin cuerpo.
- Bloque Masters al final: padding 20px 18px, radio 18px, **borde 1.5px dashed `line`**, fondo `surface`. Kicker "Cierre del año", título "Masters" 24px/800, cuerpo "Se juega con los 4 primeros de la tabla al terminar las 12 fechas. Faltan 6.", chip "Bloqueado" (`chip`/`muted`).

---

### 9. Fecha — tres estados

**Purpose**: el corazón operativo. Armar la fecha, cargarla y cerrarla.

Header: kicker según estado ("Armando · sólo vos la ves" / "En juego · jueves 27 ago" / "Cerrada · jueves 13 ago"), título "Fecha 7"/"Fecha 6", "← Volver" a Fechas.

#### 9a. Draft (sólo admin)

- **Panel de conteo** — arriba de todo, y es el protagonista de la pantalla: es lo que el admin mira mientras tilda. Padding 16px, radio 16px, fondo `surface`, borde 1px `line`. Actualiza en vivo con cada toque.
  - Número grande centrado 32px/800: "{n} confirmados".
  - Debajo, 12.5px/600 `muted`, la consecuencia en una línea: "La fecha es de {n} · {n/2} parejas".
  - Si el número dio **impar**, la línea pasa a `warn-bg` con texto 12.5px/700: "Son impares. Se suma 1 invitado y la fecha queda de {n+1}."

- **Paso 1 · Quién viene** — encabezado con línea y el contador a la derecha.
  - Una fila por integrante del plantel, con **toggle binario** (no ciclo de tres): viene ⇄ no viene.
    - *Viene*: tag "Viene" (`ok-bg`/`up`), borde `line`, fondo `surface`.
    - *No viene*: `opacity: .5`, tag "No viene" (`chip`/`muted`), sin borde de alerta — **faltar es normal y no bloquea nada**, porque para cada jugador cuentan sus mejores N fechas.
  - Fila: avatar 30px + nombre 14.5px/700 + tag. Los que se marcaron ausentes desde la Tabla vienen ya en "no viene", con sub 11.5px/600 `muted`: "Avisó que no va".

- **Paso 2 · El invitado** — *aparece sólo si el conteo dio impar.* Tarjeta con borde 1.5px dashed `line`, fondo `surface`.
  - Kicker "Falta uno para armar parejas" + campo de texto para el nombre (padding 15px, radio 12px, borde 1.5px `accent` mientras esté vacío).
  - Nota 11.5px/600 `muted`: "No suma puntos para el campeonato, pero su compañero sí."
  - Handle ⠿ + flechas ↑↓ para moverlo en el orden: **entra último por defecto**, así le toca con el primero de la tabla. Hint: "Va último porque nadie sabe cómo juega. Movelo si lo conocés."

- **Bloqueos** (patrón único: fondo `chip`, texto `muted`, sin navegación):
  - **Menos de 7 confirmados** → bloque en `live-bg`: "Con {n} no alcanza para armar una fecha. Hacen falta 8." y "Generar parejas" deshabilitado.
  - **Más de 12** → bloque en `live-bg`: "Son {n} y entran hasta 12. Con más, la fecha no termina nunca."
  - **Invitado sin nombre** → se pueden generar las parejas, pero "Confirmar fecha" queda deshabilitado: "Ponele nombre al invitado antes de confirmar."

- **Paso 3 · Parejas** (tras generar): 4, 5 o 6 filas numeradas con los nombres 14.5px/750. La pareja defensora lleva borde `up` y chip "Defensora" (`ok-bg`/`up`). El invitado lleva chip "Invitado" (`chip`/`muted`) al lado de su nombre.
  - Nota: "Los defensores quedan fijos. El resto se arma cruzando la tabla: 1° con último, 2° con anteúltimo, y así."
  - Pie: "Regenerar" (borde 1.5px `line`) + "Confirmar fecha" (`accent`, flex 1).

#### 9b. Open (en juego)  *(el layout de partidos cambia respecto del prototipo)*

**Por qué cambia.** El prototipo dibuja 3 rondas × 2 partidos = 6, y entran de una. Pero el fixture depende de cuántas parejas haya:

| Parejas | Partidos | Rondas | Por ronda | ¿Descansa alguna? |
|---|---|---|---|---|
| 4 | 6 | 3 | 2 | no |
| 5 | 10 | 5 | 2 | **sí, una por ronda** |
| 6 | 15 | 5 | 3 | no |

Quince partidos en una sola lista rompen el "mínimo scroll" que pide esta pantalla, que se usa parado en el club con una mano.

**Rondas como acordeón.** Cada ronda es una sección con encabezado propio (10.5px/800/uppercase `muted` "Ronda 2 de 5" + a la derecha el conteo "2/3 cargados"). La ronda con partidos sin cargar está **abierta**; las completas se **colapsan** a una fila resumen tocable que muestra los resultados en chico. Así lo que estás cargando queda siempre arriba, sin buscar.
Con 4 parejas quedan 3 rondas y todas entran abiertas — el acordeón no molesta en el caso chico.

- Chips de las parejas arriba (radio 99px, 11.5px/750; la defensora en `ok-bg`/`up`, el resto en `chip`). Con 6 parejas envuelven a dos líneas, con `gap: 6px`.
- **Pareja libre**: en una ronda de 5 parejas, la que no juega aparece al pie de la ronda como fila de 11.5px/700 `muted` con fondo `chip`: "Descansa esta ronda: {pareja}". **Tiene que estar** — sin eso, una ronda con una pareja menos parece un bug del fixture.
- Cada partido: padding 13px, radio 14px, borde 1px `line`, fondo `surface`.
  - Dos filas pareja/score. Nombre 14.5px (weight 800 si ganó, 650 si no; el perdedor va en `muted`). Score en caja de 32px mínimo, radio 8px, fondo `chip`, 16px/800. Sin resultado: "–".
  - **Carga en dos toques** (sólo admin): botón "Cargar resultado" → pregunta "¿Quién ganó?" (dos botones con los nombres de las parejas) → "Games del perdedor" (0 / 1 / 2 / 3). El ganador siempre queda en 4 (= games por set configurados). **Sin teclado numérico en ningún momento.**
- **Tabla de la fecha**: cabecera en `chip` (Pareja / PG / Dif / Pts, 9.5px/800/uppercase) y una fila por pareja (4, 5 o 6), separadas por 1px `line`. Con la fecha abierta, Pts muestra "—".
  - Nota: "Se actualiza a medida que se cargan los resultados. Los puntos se reparten al cerrar la fecha."
- CTA de cierre (sólo admin): "Cerrar fecha · faltan N partidos" deshabilitado (fondo `chip`) mientras falten resultados; al completarse pasa a "Cerrar fecha" en `accent`.

#### 9c. Closed (cerrada)

- Mismos partidos, todos con resultado y sin botones de carga.
- Tabla final con los puntos reales de la config —tomando los primeros N valores según cuántas parejas jugaron— y nota explicando el desempate concreto: "Nico & Gastón quedaron 2° por diferencia de games: empataron en partidos ganados con Juanma & Seba."
- Si jugó un invitado, su fila lleva el chip "Invitado" y **0 puntos**, con aclaración 11.5px/600 `muted`: "El invitado no suma para el campeonato; su compañero sí."
- Admin ve "Reabrir fecha" (borde 1.5px `line`, texto `muted`).

---

### 10. Estadísticas

**Purpose**: contexto del año, para el torneo y para uno mismo.

**Components**:
- Tabs pill "Del torneo" / "Mías" (padding 9px 15px, radio 99px; activo `accent`/`accent-text`, inactivo `chip`/`muted`). Cambian tarjetas, barras y el título del ranking.
- Grilla 2×2 de tarjetas: padding 14px, radio 14px, borde 1px `line`, fondo `surface`. Label 9.5px/800/uppercase `muted`, valor 22px/800, sub 11.5px/600 `muted`.
  - Del torneo: Partidos jugados 36 · Games totales 241 · Fecha más pareja (Fecha 5) · Racha más larga (Marce · 7).
  - Mías: Partidos 18 · Efectividad 61% · Games a favor +14 · Mejor fecha (Fecha 4).
- Ranking de barras: por fila, nombre 13.5px/700 + valor 12.5px/800 `muted`, y barra de 7px radio 99px sobre pista `chip`. El primero en `accent`, el resto en `muted`.
- Duplas: filas con pareja 14px/700, "jugaron N fechas" 11.5px/600 `muted`, y chip de efectividad a la derecha (`ok-bg`/`up` si ≥ 50%, `chip`/`muted` si no).

---

### 11. Perfil de jugador

**Purpose**: se llega tocando una fila de la Tabla.

**Components**:
- Cabecera: avatar 52px en `accent` + nombre 19px/800 + meta 12.5px/600 `muted` ("2° de {plantel} · 47 puntos · 6 fechas jugadas"). Contenedor con fondo `surface`, borde 1px `line`, radio 16px.
- 3 tarjetas en grilla: Efectividad 61% · Fechas ganadas 1 · Dif. games +14. Label 9.5px/800/uppercase, valor 20px/800.
- **Racha**: 6 columnas iguales. Cada una, bloque de 38px alto radio 9px con la posición de esa fecha (13px/800) + label "F1…F6" debajo (9.5px/700 `muted`). Podio (1° o 2°) en `accent`/`accent-text`; el resto en `chip`/`muted`.
- **Con quién le va mejor**: filas con avatar 28px + nombre 14px/700 + récord 12.5px/800 a la derecha (`up` si es positivo, `muted` si no).

---

### 12. Reglas

**Purpose**: consultar cómo funciona este torneo.

**Components**:
- Intro 13.5px/550 `muted`: "Las reglas de este torneo, como quedaron cuando Marce lo creó."
- Acordeón de 6 ítems. Cada fila: título 14.5px/750 + **valor actual visible siempre** en 12.5px/700 color `accent-link`, con +/− a la derecha (13px/800 `muted`). Al abrir, cuerpo 13px/550 `muted` con padding 0 15px 15px.
  1. Formato de partido — "1 set a 4 games"
  2. Cómo se arman las parejas — "Cruzando el orden de desempate"
  3. Puntos por posición — "10 · 7 · 5 · 3 · 2 · 1" (tantos como parejas puede haber; las fechas más chicas usan los primeros)
  4. Orden de desempate — "Se refresca cada 3 fechas"
  5. Fechas que cuentan — "Las mejores 9 de 12"
  6. Masters — "Los 4 primeros"
- Admin: botón "Editar reglas" (borde 1.5px `line`) → Ajustes.

---

### 13. Ajustes

**Purpose**: configuración del torneo, notificaciones, apariencia y cuenta.

**Layout**: secciones con label 10.5px/800/uppercase `muted` y una lista agrupada (borde 1px `line`, radio 14px, fondo `surface`, filas separadas por 1px `line`).

**Components**:
- **Torneo**: Nombre · Plantel ({n} ›, permite agregar y sacar gente entre 8 y 12; si cambia el tamaño, avisa que hay que revisar los puntos) · Formato (1 set a 4 ›) · Link de invitación (Copiar ›). Cada fila con label 14px/700 + hint 11.5px/600 `muted` y valor 13px/750 `muted` a la derecha. Nota al pie: "Cambiar el formato con fechas ya jugadas no recalcula la tabla vieja."
- **Notificaciones**: 3 toggles (Aviso de próxima fecha · Resultados cargados · Cambios en la tabla), cada uno con hint. Switch 46×27px, radio 99px, knob 21px; encendido = pista `accent` + knob `accent-text` + knob a la derecha; apagado = pista `chip` + knob `muted`.
- **Apariencia**: 3 botones iguales (Claro / Oscuro / Automático), padding 13px, radio 12px. Seleccionado con fondo `accent` y borde `accent`; los demás con borde 1.5px `line`.
- **Cuenta**: Mail (valor a la derecha) · Cambiar contraseña (›) · Cerrar sesión (14px/750 color `live`) → vuelve a Landing. Debajo, "Salir del torneo" como link 12.5px/700 `muted`.

---

## Interactions & Behavior

**Navegación**
- Bottom nav → Tabla / Fechas / Stats / Reglas. Estando en Fecha, la pestaña activa es Fechas.
- Fila de la Tabla → Perfil. "← Volver" desde Perfil vuelve a Tabla; desde Fecha vuelve a Fechas; desde Ajustes vuelve a Reglas; desde Crear torneo retrocede un paso.
- Landing → Registro / Login. Registro OK → Mis torneos (vacío). Unirse OK → Tabla. Wizard paso 5 → Tabla. Cerrar sesión → Landing.

**Toques que cambian estado**
- Tabla: "No voy" / "Sí voy" (reversible, muestra el reemplazo). ⓘ y "Orden de desempate ⇅" abren el sheet; overlay y "Entendido" lo cierran.
- Fecha draft: la fila de asistencia alterna viene ⇄ no viene. El panel de conteo se recalcula en vivo, y el bloque del invitado aparece o desaparece según el número quede impar o par. Cualquier cambio invalida las parejas generadas (`generated:false`).
- Fecha open: carga en dos pasos (ganador → games del perdedor).
- Crear torneo: ↑↓ reordenan, ± editan puntos y configuración, "Copiar link" pasa a "Copiado ✓".
- Ajustes: toggles y selector de tema aplican en vivo.

**Estados deshabilitados** (patrón único: fondo `chip`, texto `muted`, sin navegación)
- Wizard paso 2 con menos de 8 nombres o con el plantel en número impar; paso 4 con puntos o conteo inválidos.
- "Generar parejas" con menos de 7 confirmados o con más de 12.
- "Confirmar fecha" con el invitado sin nombre.
- "Cerrar fecha" con partidos sin cargar (el label dice cuántos faltan).
- "Entrar como…" sin nombre elegido.
- Submit de Registro/Login con errores.

**Errores** — siempre en línea, junto al campo: fondo `live-bg`, texto `live`, y el campo culpable con borde `live`. Nunca alerts ni toasts.

**Animaciones** — el prototipo no las define. Sugerido en implementación: sheet con slide-up 220ms ease-out + fade del overlay; acordeón con height 180ms; toggles 150ms; transiciones de pantalla, las nativas de la plataforma.

**Responsive** — diseñado a 390×844 (iPhone 14/15). Todo es columna simple con padding lateral 20–24px, así que escala a anchos mayores sin cambios estructurales. Los targets táctiles no bajan de 44px (steppers 34px van dentro de filas de 56px+).

## State Management

Estado del prototipo (el que representa datos reales va marcado; el resto es andamiaje):

| Variable | Tipo | Rol |
|---|---|---|
| `screen` | string | Pantalla activa — reemplazar por el router |
| `theme` | 'light' \| 'dark' | **Real**, persistir |
| `admin` | boolean | **Real** — viene del rol del usuario en el torneo |
| `fechaState` | 'draft'\|'open'\|'closed' | **Real** — del backend |
| `going` | boolean | **Real** — asistencia del usuario a la próxima fecha |
| `seats` | `[{name, going}]` | **Real** — asistencias de la fecha en draft (binario, no tri-estado) |
| `guest` | `{name, orderIndex}` \| null | **Real** — el asiento extra, presente sólo cuando el conteo da impar |
| `generated` | boolean | **Real** — si ya se generaron las parejas |
| `scores` | `{matchId: [a, b]}` | **Real** — resultados cargados |
| `loading` | `{id, winner}` \| null | UI transitoria de la carga en dos pasos |
| `sheet` | string \| '__all__' \| null | Sheet de desempate: nombre del jugador o vista general |
| `order` | string[] | **Real** — orden inicial de desempate (wizard) |
| `points` | number[] | **Real** — puntos por posición, `plantel / 2` valores |
| `cfg` | `{sets, games, fechas, cuentan, refresco}` | **Real** — formato del torneo |
| `notif` | `{fecha, resultado, tabla}` | **Real**, persistir |
| `step`, `p8`, `copied`, `joinPick`, `statTab`, `ruleOpen`, `auth`, `empty` | varios | UI local de cada pantalla |

**Datos que necesita el backend**: torneo (nombre, config, jugadores, orden de desempate y su fecha de refresco), fechas (estado, asistencias, parejas, partidos con resultado), tabla general derivada (puntos, movimiento vs. fecha anterior, descarte de las peores N), y stats derivadas.

**Reglas de negocio a implementar del lado del servidor**
1. **Tamaño de la fecha**: sale de quiénes confirman, entre 8 y 12. Si el número da impar se agrega un asiento de invitado. Menos de 7 confirmados, no hay fecha.
2. **Generación de parejas**: la pareja campeona defensora se mantiene —una sola vez, después se separa gane o pierda—; el resto se cruza por la tabla de puntos, 1° con último. Ninguna pareja repite respecto de la fecha anterior. El invitado entra último en el orden.
3. **Puntos**: se asignan al cerrar la fecha según la tabla de esa noche; los dos de la pareja reciben lo mismo. Una fecha con menos parejas usa los primeros valores de la lista, así ganar siempre paga igual. **El invitado no recibe puntos; su compañero sí.**
4. **Tabla general**: suma de las mejores N fechas (default 9 de 12).
5. **Empates**: se cortan por el orden de desempate vigente, que se recalcula cada N fechas (default 3).
6. **Tabla de la fecha**: partidos ganados, luego diferencia de games, luego el partido entre las empatadas — **y ese paso sólo aplica si son exactamente dos**: con tres empatadas el resultado entre ellas es circular y no resuelve, así que corta el orden de desempate.
7. **Clasificación al Masters**: los 4 primeros al terminar las fechas.

## Design Tokens

**Light**
| Token | Hex |
|---|---|
| `--bg` | `#FFFFFF` |
| `--surface` | `#F4F6F3` |
| `--chip` | `#EAEFEA` |
| `--line` | `#E4E9E5` |
| `--text` | `#10231A` |
| `--muted` | `#6B7A72` |
| `--accent` | `#0E5C3F` |
| `--accent-text` | `#FFFFFF` |
| `--accent-link` | `#0E5C3F` |
| `--live` (alerta/error) | `#D1462F` |
| `--live-bg` | `#FBEAE6` |
| `--up` (positivo) | `#2F8A5B` |
| `--ok-bg` | `#E6F2EA` |
| `--down` (negativo) | `#C0553A` |
| `--warn-bg` | `#F8ECE4` |
| `--scrim` | `rgba(10,25,18,.45)` |

**Dark**
| Token | Hex |
|---|---|
| `--bg` | `#0D1512` |
| `--surface` | `#16201C` |
| `--chip` | `#1B2823` |
| `--line` | `#21302A` |
| `--text` | `#EAF2EE` |
| `--muted` | `#8EA298` |
| `--accent` | `#0F6B48` |
| `--accent-text` | `#DBF5E8` |
| `--accent-link` | `#34C08A` |
| `--live` | `#FF8368` |
| `--live-bg` | `#2A1A15` |
| `--up` | `#34C08A` |
| `--ok-bg` | `#12291F` |
| `--down` | `#FF9A6B` |
| `--warn-bg` | `#2A2016` |
| `--scrim` | `rgba(0,0,0,.6)` |

En dark el acento cambia de rol: `--accent` se usa como fondo de bloque y `--accent-link` (verde claro) para texto e íconos activos, que sobre fondo oscuro necesitan más luminosidad. No usar `--accent` como color de texto en dark.

**Tipografía** — Archivo (Google Fonts), pesos 400–800. Una sola familia para todo.

| Rol | Tamaño / peso / tracking |
|---|---|
| Display (landing) | 40 / 800 / −.035em / lh 1.02 |
| Título de pantalla | 26 / 800 / −.03em |
| Título grande (unirse, wizard) | 30–32 / 800 / −.03em |
| Título de tarjeta | 18–21 / 800 / −.02em |
| Métrica | 20–22 / 800 / −.02em |
| Puntos en tabla | 17 / 800 |
| Score | 16 / 800 |
| Sección | 15 / 800 / −.02em |
| Nombre de jugador | 14.5–15 / 650–700 |
| Cuerpo | 13–14 / 550 / lh 1.5 |
| Meta / hint | 11.5–12.5 / 600 |
| Kicker / label | 10.5 / 800 / uppercase / +.14em |
| Micro-label | 9.5 / 800 / uppercase / +.13em |

**Espaciado** — escala de 4. Padding lateral de pantalla 20 (24 en las de entrada). Gap entre bloques 12–16. Padding interno de tarjeta 13–16. Gap dentro de fila 8–12.

**Radios** — 16 tarjeta · 14 lista/tarjeta chica · 12 botón y campo · 9–10 botón chico · 8 caja de score · 99 chip, pill y avatar · 22 arriba del bottom sheet · 44 el marco del teléfono (sólo prototipo).

**Bordes y elevación** — 1px `line` estándar; 1.5px para campos, botones de contorno y estados seleccionados; 1.5px dashed para el bloque Masters. **Sin sombras en la UI** (la única del prototipo es la del marco del teléfono).

**Iconografía** — el prototipo usa formas geométricas como placeholder en el nav y glifos de texto (⚙ ⇅ ⓘ ⠿ ▲ ▼ ✓ ›). Reemplazar por un set de íconos real (Lucide, SF Symbols o el del codebase), manteniendo 18–19px en el nav.

## Assets

Ninguno. Sin imágenes, logos ni ilustraciones — el logo de la landing es un cuadrado de color a modo de placeholder. La única dependencia externa es la fuente **Archivo** desde Google Fonts.

Si el proyecto va a tener marca propia, hacen falta: logo/wordmark, ícono de app y opcionalmente fotos de perfil (hoy resueltas con iniciales sobre círculo de color).

## Files

- `Padel App.dc.html` — el prototipo completo, 13 pantallas navegables con toda la lógica de interacción. **Es la referencia principal.**
- `Padel Sistema.dc.html` — el sistema de diseño: paletas light/dark con hex, escala tipográfica, radios y espaciado.
- `PadelKit.dc.html` — componentes sueltos (botones, chips de estado, fila de jugador, tarjeta de resultado, campos) renderizados en ambos temas. Lo importa `Padel Sistema`.
- `PadelScreen.dc.html` — versión temprana de la Tabla, parametrizada por color. Se usó para comparar direcciones visuales; útil como referencia de tematizado, no es pantalla de producto.
- `Padel Direcciones.dc.html` — las tres direcciones visuales exploradas antes de elegir. Contexto histórico.
- `support.js` — runtime de los archivos `.dc.html`. Necesario para abrirlos en el navegador; no es parte del producto.

Para ver el prototipo: abrir `Padel App.dc.html` en un navegador. Los chips grises de arriba permiten recorrer todas las pantallas y estados.
