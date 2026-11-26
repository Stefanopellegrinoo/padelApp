# Brief ronda 4 · que parezca una app real

Spec: `odd/tasks/rediseno-app.md` (S2-S7 y el Log). Contenido de las pantallas: el mismo de `design/brief-direcciones.md` (sección "Las tres pantallas"), con la corrección "Faltan 4 partidos".

Feedback del usuario sobre la ronda 3 (Superficie, Marcador, Álbum): "no me gusta el diseño todavia, usa las skills mejorala". Cuando se le preguntó qué le molesta: "muy hecho por ia".

## Diagnóstico: por qué la ronda 3 sigue pareciendo hecha por IA

1. **Narra en vez de mostrar.** Hay oraciones explicativas por todos lados:
   - "Confirmaron 10 de 12. Las parejas no se sortearon todavía."
   - "8 jugadores en 4 parejas. Cada pareja juega con todas, a un set a 6 games."
   - "Cargando. Elegí abajo los games de Juampi y Gonza."
   - "Con ese toque se guarda el resultado."
   - "Pádel. Tabla después de la fecha 7 de 12."

   Las apps reales muestran datos y estados, no los cuentan.
2. **Es una página web, no una app.** Arranca con un saludo ("Hola, Martín") y sigue con secciones apiladas con títulos ("Lo próximo", "Tus torneos", "Con tus amigos", "Armar algo nuevo"). Ese es el dashboard típico que genera una IA. Faltan los elementos de una app: barra de estado, barra de navegación, barra inferior fija y hojas que suben desde abajo.
3. **No hay íconos ni avatares.** Sin íconos, sin fotos y sin elementos del sistema, se lee como un documento o un wireframe.
4. **Ritmo parejo.** Todo con el mismo margen, la misma separación y el mismo peso. Las filas de la tabla miden 64-90 px, cuando en una app real de resultados miden unos 44 px.
5. **El concepto se dibuja literal.** La cancha dibujada como un recuadro y las figuritas son ideas ilustradas, no producto. Una app real expresa su identidad con detalles, no con metáforas gigantes.
6. **Datos demasiado prolijos y textos de presentación.**

## El objetivo

Que alguien que vea la captura crea que es una app que ya está en el App Store, hecha por un equipo chico pero bueno. El nivel de terminación de referencia es Apple Sports, Apple Fitness, Playtomic o Strava. Se toma su nivel de detalle, no su diseño.

## Reglas

1. **Elementos de una app iOS, dibujados con CSS/SVG:**
   - Barra de estado arriba (9:41, señal, wifi, batería) e indicador de inicio abajo.
   - Barra de navegación con título grande alineado a la izquierda y acciones con ícono a la derecha.
   - Barra de pestañas fija adentro del torneo, con íconos.
   - La carga de resultados es una hoja que sube desde abajo (con su agarre arriba), sobre la pantalla de la fecha atenuada.
2. **Cero oraciones narrativas.** Cada dato va como dato:
   - "10/12" con un ícono, en vez de "Confirmaron 10 de 12".
   - "Sorteo pendiente" como estado.
   - El formato ("Todos contra todos, 1 set a 6") en una sola línea gris.

   Como máximo una línea de ayuda por pantalla, y solo si sin ella no se entiende.
3. **Encabezados de sección como en iOS:** cortos, en gris, en minúscula salvo la inicial, y como máximo dos o tres por pantalla. Nada de saludo.
4. **Íconos:** un solo set, coherente, de trazo 1.75-2 con puntas redondas. Se pueden copiar a mano trazos de Lucide (licencia ISC), como ya hace la app en `app/torneo/[id]/nav.tsx`.
5. **Avatares:** círculos con iniciales y un tinte determinístico por persona, como los contactos de iOS. Sin cuadrados y sin figuritas.
6. **Densidad de app:**
   - Filas de tabla de 44 px.
   - Texto de lectura de 15-17 px.
   - Números con cifras tabulares.
   - Que la Tabla entera de 12 entre casi completa en una pantalla de 844 px.
7. **Identidad con detalles:** cada deporte tiene un color, pádel en azul y FIFA en verde, que tiñe el ícono del deporte, el puesto propio y el acento adentro de ese torneo. Ese es el único gesto de marca.
8. **Tipografía:**
   - Una sola familia incrustada.
   - Elegí entre Onest, Hanken Grotesk o Instrument Sans (están en `/tmp/gdesign/node_modules`), mirando cómo rinde a 13-17 px en la captura.
   - Nada de Inter, ni de Barlow Condensed para títulos.
9. **Datos con textura real:**
   - Apodos como en un grupo real ("Juampi", "Rama", "Pato").
   - Un 7-6 en algún resultado.
   - Un jugador que avisó que no va.
   - Algo sin cargar.

   Sin inventar funciones que la app no tiene.
10. **Estados de interacción visibles:**
    - En la hoja de carga, la pareja ganadora ya está marcada y los games del perdedor están por elegirse.
    - "Cerrar la fecha" aparece deshabilitado con su motivo en la misma línea.
11. **Las mismas reglas de la ronda 3:**
    - Archivos autocontenidos, sin URLs, contraste AA, objetivos de toque de 44 px como mínimo y `:focus-visible`.
    - Sin MAYÚSCULAS decorativas, sin "·" para encadenar metadatos y sin "→".
12. **Proceso:**
    - Leé y seguí `/home/stefano/.claude/plugins/cache/claude-plugins-official/frontend-design/1.1.1/skills/frontend-design/SKILL.md`.
    - Sacá capturas con `PLAYWRIGHT_BROWSERS_PATH=/tmp/gdesign/browsers node /tmp/gdesign/shot.mjs <archivo> <png> 390 844`.
    - Hacé al menos tres pasadas de autocrítica. En cada una, preguntate qué delataría a una IA en esa captura y sacalo.
