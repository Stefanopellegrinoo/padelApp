# Brief de dirección de arte · ronda 3

Rediseño de la app. Spec: `odd/tasks/rediseno-app.md` (S2-S7 y el Log). Este brief manda sobre las rondas 1 y 2.

## Qué pasó hasta acá

- Estructura de la pantalla de entrada: elegida la **B** (`design/inicio/02-inicio-dos-partes.html`).
- Estilo, ronda 1 (`design/estilo/01-03`): "ningun diseño me gusto, el mas cerca es mas tirando el 1, peo tampoco mme mato, los otros 2 horribles".
- Estilo, ronda 2 (`design/estilo/04-06`): "ninguno, podes usar todas las skills de diseño que tnees para hacerlo lo mejor posoble, como un equipo porfesional de diseño, y que no parezca ia".
- Lo único que le acercó algo fue el 1: fondo claro, limpio, deportivo. Los que odió eran las dos estéticas más típicas de IA: negro con verde ácido, y crema con colores pastel.

## Por qué parecían IA (no repetir)

- Etiquetas en MAYÚSCULAS con tracking arriba de cada bloque.
- Metadatos pegados con punto medio: "Pádel · Fecha 7 de 12 · 20:30".
- El combo número gigante + etiqueta chiquita + fondo de color o degradé ("3° de 12").
- Todo cortado en tarjetas iguales, mismo radio en todo, misma sombra gris suave.
- Flechas "→" pegadas a botones y links.
- Copys de relleno ("Esto es lo que pasa en tu grupo").
- Tipografía por defecto: las rondas anteriores se vieron con la fuente genérica del sistema porque Archivo no está instalada. Ahora la tipografía se elige y se incrusta.
- Ninguna idea visual salía del mundo del producto: eran plantillas pintadas.

## El mundo del producto

Un grupo de amigos de 8 a 12 que juega todos los martes a la noche en un complejo de pádel, y algunos los viernes al FIFA. Antes había una planilla de Google y discusiones en el grupo de WhatsApp. Lo que importa:

- **La noche en el club:** canchas de césped sintético (azul o verde), líneas blancas, paredes de vidrio, luces LED, la pelota amarilla, el turno de las 20:30. El organizador arma la fecha parado, con una mano, con gente esperando.
- **La tabla:** quién va primero, quién entra al Masters (los 4 primeros), cuántas fechas jugó cada uno.
- **La cargada:** el historial con cada amigo ("le gané 7 de 12 a Nico"), quién la tiene de hijo a quién.

Objetivo de la app en palabras del dueño: "que con tus amigos puedas armar torneos fácilmente y que puedas tener un historial de todos los que jugaron."

## Tres direcciones, tres puntos de partida distintos

Cada dirección sale de una parte distinta del mundo: **el lugar**, **el resultado**, **la gente**. Las tres son claras (el usuario rechazó lo oscuro) y gastan la audacia en un solo elemento.

### 1 · Superficie (el lugar) → `design/dir-superficie/`

- **Idea:** la app toma los materiales de donde se juega. El color de la superficie de juego aparece solo donde hay juego (el próximo partido, el partido en curso). Lo administrativo es papel blanco.
- **Lo memorable:** la cancha vista desde arriba. Sus líneas blancas tienen función: dividen las dos parejas de un partido, y en la tabla la línea marca el corte del Masters.
- **Color:** pádel = césped azul, FIFA = verde de cancha de fútbol. Así cada deporte se reconoce al toque, lo que resuelve que la tabla de FIFA no decía FIFA. Fuera del juego: blanco, tinta oscura y un gris para lo secundario. El amarillo pelota solo como punto chico que marca "vos".
- **Tipografía:** Barlow, una grotesca de cartelería vial, como la señalética de un complejo deportivo. Barlow Condensed para cifras grandes.

### 2 · Marcador (el resultado) → `design/dir-marcador/`

- **Idea:** el lenguaje de los marcadores de estadio y los zócalos de TV: códigos de tres letras por jugador (NIC, LUC, MAR), dígitos en celdas fijas, una franja por pareja.
- **Lo memorable:** cada partido se lee como un marcador ("scorebug"): las dos parejas una arriba de la otra, con sus games en celdas. Aplica a la carga de resultados, al historial con un amigo y al resumen de la fecha.
- **Color:** fondo gris muy claro y frío (nunca crema), celdas de marcador oscuras con dígitos blancos, un solo acento rojo de marcador LED para "en juego" y "vos". Los colores de las parejas, si se usan, salen de un set chico y fijo.
- **Tipografía:** Barlow Condensed en itálica para cifras y nombres de los gráficos, y Barlow para el texto corrido. Los códigos de tres letras van en mayúsculas porque es su forma real, no como etiquetas decorativas.

### 3 · Álbum (la gente) → `design/dir-album/`

- **Idea:** los amigos son la colección. Cada jugador es una figurita del álbum del Mundial: borde blanco troquelado, marco de color, iniciales grandes y un número (su puesto).
- **Lo memorable:** las figuritas de las personas. Todo lo demás es tranquilo y blanco.
- **Color:** celeste (álbum, Argentina) para los marcos, dorado solo para el primero de la tabla, tinta oscura y blanco.
- **Tipografía:** elegir entre Bricolage Grotesque, Familjen Grotesk, Schibsted Grotesk o Hanken Grotesk, y justificar la elección. Que se lea redonda y amistosa sin ser infantil.
- **Riesgo:** que quede infantil. Contención: solo las personas son figuritas.

## Las tres pantallas, iguales en las tres direcciones

Ancho 390 px (iPhone), alto natural. Copy en castellano rioplatense, con voseo, frases cortas y sin relleno. El contenido es fijo; la forma de mostrarlo la decide cada dirección.

### Pantalla 1 · Inicio (estructura B)

- **Usuario:** Martín (MP).
- **Próximo:** Los Pibes del Martes, pádel, fecha 8, martes 18/11 a las 20:30 en Club Ciudad. Confirmaron 10 de 12 y todavía no se sortearon las parejas. Martín va 3° de 12.
- **Tus torneos:**
  - Los Pibes del Martes, pádel: fecha 7 de 12, Martín 3° de 12.
  - FIFA de los Viernes, FIFA: fecha 4 de 8, Martín 1° de 6.
- **Con tus amigos:**
  - Nico Arias: le ganaste 6-4 6-3 en pádel hace 2 días. Historial 7 a 5.
  - Facu Gómez: perdiste 1-3 al FIFA el viernes. Historial 4 a 6.
  - Juampi Ledesma: le ganaste 6-2 7-5 hace una semana. Historial 3 a 1.
- **Acciones:**
  - Cargar un partido con un amigo.
  - Crear torneo.
  - Torneo rápido ("una tarde, sin tabla ni fechas").

### Pantalla 2 · Tabla de Los Pibes del Martes (pádel, después de la fecha 7 de 12)

| Pos | Jugador | Pts | Fechas jugadas | Cambio |
| --- | --- | --- | --- | --- |
| 1 | Nico Arias | 58 | 7 | = |
| 2 | Lucas Ferro | 54 | 7 | sube 1 |
| 3 | Martín (vos) | 51 | 6 | baja 1 |
| 4 | Juampi Ledesma | 47 | 7 | sube 2 |
| 5 | Tomi Herrera | 44 | 6 | = |
| 6 | Gonza Paz | 40 | 7 | baja 2 |
| 7 | Facu Gómez | 38 | 5 | sube 1 |
| 8 | Seba Ruiz | 35 | 6 | baja 1 |
| 9 | Pato Vidal | 31 | 6 | = |
| 10 | Mati Rossi | 27 | 5 | sube 1 |
| 11 | Fede Quiroga | 22 | 4 | baja 1 |
| 12 | Rama Sosa | 18 | 4 | = |

- Los 4 primeros van al Masters. Se descartan las 2 peores fechas de cada uno.
- Navegación del torneo, abajo: Tabla (activa), Fechas, Stats, Reglas. Para volver: "Inicio".

### Pantalla 3 · La fecha en el club (fecha 8, en juego)

- **Formato:** 8 jugadores en 4 parejas. Cada pareja juega con todas, a un set a 6 games.
- **Parejas:** Martín y Tomi · Nico y Lucas · Juampi y Gonza · Facu y Seba.
- **Ronda 1, terminada:**
  - Martín/Tomi 6-4 Nico/Lucas.
  - Juampi/Gonza 3-6 Facu/Seba.
- **Ronda 2, en juego:**
  - Martín/Tomi vs Juampi/Gonza. Se está cargando: ya se tocó que ganaron Martín/Tomi y falta elegir los games del perdedor (0 a 5). La carga es de dos toques y sin teclado.
  - Nico/Lucas vs Facu/Seba: sin cargar.
- **Ronda 3:** pendiente.
- **Abajo:** "Cerrar la fecha", deshabilitado hasta cargar todos los partidos, con el motivo visible ("Faltan 3 partidos").
- Es la pantalla que más se usa de pie y con una mano: los objetivos de toque grandes y lo que se toca va en la mitad de abajo.

## Reglas para los diseñadores

1. Leé primero la skill `/home/stefano/.claude/plugins/cache/claude-plugins-official/frontend-design/1.1.1/skills/frontend-design/SKILL.md` y seguila: plan de tokens, revisión del plan contra los defaults de IA, construcción, capturas y autocrítica.
2. Cada pantalla es un archivo HTML autocontenido: CSS y SVG inline, sin URLs externas, sin imágenes remotas.
3. Las fuentes van incrustadas en base64 con `node /tmp/gdesign/font.mjs <paquete> <familia> <pesos> [italic]`, que imprime las reglas `@font-face`.
   - Paquetes disponibles en `/tmp/gdesign/node_modules`: `@fontsource/barlow`, `@fontsource/barlow-condensed`, `@fontsource-variable/archivo`, `@fontsource/bricolage-grotesque`, `@fontsource-variable/familjen-grotesk`, `@fontsource/schibsted-grotesk`, `@fontsource-variable/hanken-grotesk`, `@fontsource/instrument-sans`, `@fontsource-variable/onest`, `@fontsource/big-shoulders-display`.
   - Son fuentes libres de Google Fonts, así que la app real las puede cargar con `next/font`.
   - Incrustá solo los pesos que uses.
4. Mirá lo que hacés con `PLAYWRIGHT_BROWSERS_PATH=/tmp/gdesign/browsers node /tmp/gdesign/shot.mjs <archivo.html> <salida.png> 390`.
   - Guardá las capturas en `/tmp/gdesign/shots/<dirección>-<pantalla>-v<N>.png`.
   - Hacé al menos dos pasadas de autocrítica sobre la captura antes de entregar.
   - Para cada pasada, "sacate un accesorio".
5. Accesibilidad:
   - Contraste AA en todo texto.
   - Objetivos de toque de al menos 44 px.
   - `:focus-visible` visible.
   - Sin animación, o con `prefers-reduced-motion` respetado.
6. Sin emojis, sin flechas en botones, sin etiquetas en mayúsculas decorativas y sin metadatos con punto medio.
7. No toques el estilo actual ni `design/system.md`: esta ronda propone un sistema nuevo a propósito.
