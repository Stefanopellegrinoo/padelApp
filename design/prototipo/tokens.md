# Ronda 5: tokens del prototipo

Prototipo: `index.html`, un solo archivo con la fuente en base64, sin URLs y con JS sin librerías.
Estados por hash: `#inicio`, `#tabla`, `#fechas`, `#stats`, `#reglas`, `#fecha`, `#hoja` y `#amigo`.
Los `0N-*.html` son copias que arrancan en su estado, para la galería.

## Búsquedas de la skill (ui-ux-pro-max) y qué tomé

| Búsqueda | Resultado | Qué tomé |
| --- | --- | --- |
| `--design-system "sports club social app friends tournament padel league vibrant"` | Vibrant & Block-based, rosa #E11D48, Barlow Condensed + Barlow | El estilo de bloques. El rosa no: el brief pide azul cancha para pádel. Barlow tampoco, porque ya se usó en la ronda 3. |
| `--domain style "vibrant block-based bold color blocks"` | 1: Vibrant & Block-based. 2: Flat Design Mobile (Touch-First) | De la 2: cero sombras, jerarquía por bloques de color, `scale(.97)` al tocar, objetivos de 48 px y barra de pestañas plana. De la 1: tipografía de 32 px o más donde importa. No tomé los patrones animados de fondo: son decoración. |
| `--domain color "sports team league bold blue green"` | Sports Team/Club: rojo de equipo con dorado | La idea de un color de equipo más un acento de campeonato. Acá el equipo es el azul cancha y el acento es el amarillo pelota. |
| `--domain typography "sports athletic bold condensed energetic"` | Barlow Condensed, Russo One, Bebas Neue | Confirma que hace falta una condensada pesada para los números. Elegí Archivo con eje de ancho (ver abajo). |
| `--domain ux "bottom sheet modal touch target one hand"` | Objetivos de 44 px, 8 px entre objetivos | Botones de games de 60 px de alto con 8 px de separación, parejas de 64 px y "Cargar" en la mitad de abajo. |
| `--domain ux "animation reduced motion transition navigation back"` | reduced-motion, back predecible con `history.pushState`, 1 o 2 animaciones por vista | Atrás con el historial del navegador, deep links por hash y solo dos movimientos: el deslizamiento entre pantallas y la hoja. |
| `--domain google-fonts "grotesque display sans characterful bold variable"` | Display de fantasía (Expletus, Pixelify, Baloo) | Nada. Ninguna sirve para tablas. |
| `--domain ux "tabular numbers data table leaderboard"` | Tablas: scroll o tarjetas | Cifras tabulares (`tabular-nums`) y una tabla de 5 columnas que entra en 390 px sin scroll horizontal. |

## Color

| Token | Hex | Uso |
| --- | --- | --- |
| `--blue` | #1F45E0 | Pádel: bloques del encabezado y de la fecha, "Cargar", pestaña activa |
| `--blue-tint` | #E8EDFF | Bloque del torneo de pádel, partido sin cargar, estado presionado |
| `--green` | #0B7A3B | FIFA |
| `--green-tint` | #E3F5EA | Bloque del torneo de FIFA |
| `--ball` | #DFFF4F | Solo lo tuyo: tu fila, tu nombre, tu puesto y tus victorias |
| `--ink` | #0E1A4A | Texto y botón principal (azul marino, no un casi negro) |
| `--muted` | #4B5675 | Texto secundario |
| `--line` | #DCE1EE | Divisores |
| `--down` | #B42318 | "Baja" en la tabla, siempre con triángulo y número |

### Contraste medido (WCAG)

| Par | Ratio |
| --- | --- |
| blanco sobre azul #1F45E0 | 7.03 |
| azul sobre blanco | 7.03 |
| #C9D3FF (texto suave) sobre azul | 4.77 |
| amarillo #DFFF4F sobre azul | 6.21 |
| tinta #0E1A4A sobre amarillo | 14.66 |
| tinta sobre blanco | 16.60 |
| #4B5675 sobre blanco | 7.27 |
| #4B5675 sobre #E8EDFF | 6.23 |
| azul sobre #E8EDFF | 6.02 |
| blanco sobre verde #0B7A3B | 5.44 |
| verde sobre #E3F5EA | 4.80 |
| rojo #B42318 sobre blanco | 6.57 |
| deshabilitado #5A6480 sobre #EEF1F7 | 5.20 |

## Tipografía

**Archivo** variable, con ejes de peso y de ancho (62 a 125). Una sola familia:

- Números (puesto, puntos, marcador, games, "Fecha 8"): ancho 62 %, peso 850, `tabular-nums`. Se lee como un marcador o una camiseta.
- Títulos: ancho 75 %, peso 800.
- Texto: ancho 100 %, peso 420, 16 px.

Comparé cuatro opciones con el mismo contenido (captura en `/tmp/gdesign/shots/proto-tipo-comparacion.png`):

| Opción | Por qué no o por qué sí |
| --- | --- |
| Archivo con ancho variable | Elegida. Una sola familia que se vuelve marcador sin cambiar de voz. |
| Big Shoulders + Hanken | Demasiado parecida a Barlow Condensed (ronda 3). |
| Bricolage | Simpática pero blanda para una tabla. |
| Familjen | Linda en texto, sin peso de marcador. |

## Forma

- Radios por jerarquía:
  - Bloques grandes: 24 px.
  - Bloques chicos: 18 px.
  - Botones: 14 px.
  - Píldoras: completas.
- Sin sombras: la jerarquía la dan los bloques de color.
- Espaciado en múltiplos de 4. Márgenes laterales de 16 px.

## Movimiento

| Token | Valor | Dónde |
| --- | --- | --- |
| `--ease-drawer` | cubic-bezier(0.32,0.72,0,1) | Hoja que sube (280 ms) y deslizamiento entre pantallas (280 ms ida, 240 ms vuelta) |
| `--ease-out` | cubic-bezier(0.23,1,0.32,1) | Hoja que baja (200 ms, más rápida que la subida), toast y presión |
| `--t-press` | 140 ms | `:active` con `scale(.97)` en botones y bloques; las filas cambian de fondo |

Además:

- La entrada es desde `translateY(100%)` o `translateX(100%)`; nada sale de `scale(0)`.
- Solo `transform` y `opacity`, sin `transition: all`.
- La hoja se cierra arrastrando, por distancia (110 px) o por velocidad (0.11 px/ms), con fricción hacia arriba.
- Con `prefers-reduced-motion`:
  - Las pantallas y la hoja solo funden la opacidad.
  - No hay escala al tocar.
- El partido recién guardado destella en amarillo y se desvanece en 700 ms. Es un cambio de color, no movimiento.

## Qué delataba a una IA y cómo lo saqué

### Pasada 1 (v1)

- La etiqueta "En juego" en amarillo en la fecha. El amarillo significa "vos". La saqué: el estado ya está en "Ronda 2, En juego".
- Un divisor fino dentro del bloque de la próxima fecha, que era puro adorno. Lo saqué.
- Las tarjetas de torneo tenían el número a distinta altura según el largo del nombre. Ahora el nombre reserva dos líneas.
- "Con tabla y fechas" bajo "Crear torneo" era relleno inventado. Lo saqué.
- Al abrir la hoja se veía un anillo de foco negro sobre la pareja. Ahora el foco va al diálogo, sin anillo.
- Error: `#tabla` hacía saltar la pantalla al ancla `<ol id="tabla">`. Cambié los ids que chocaban con un estado.

### Pasada 2 (v2)

- Los cuatro recuadros de Inicio (dos torneos y dos acciones en grilla de 2x2) eran el kit de tarjetas de siempre. Crear torneo y Torneo rápido quedaron como botones de texto, sin caja.
- Stats abría con tres casilleros de "número grande y etiqueta chica", el tic más típico de un tablero generado. Los saqué: el gráfico y una frase alcanzan.
- "Jugada" se repetía seis veces en Fechas. Lo saqué; los puntos ya dicen que se jugó. "Por jugar" quedó una sola vez, como subtítulo.
- El avatar de Nico duplicaba su nombre y el divisor dentro del marcador era adorno. Saqué los dos.

### Pasada 3 (v3)

- En Inicio, Amigos quedaba bajo el pliegue: rompía "las dos partes a la vista" (S4). Achiqué el número de la fecha, pasé "Ver la fecha" a una píldora al lado de las confirmaciones y achiqué los números de los torneos. Ahora entran los torneos y el primer amigo.
- El signo ° a tamaño completo empujaba "de 12". Ahora va a media altura.
- Las barras del gráfico flotaban con mucho aire arriba. Las escalé a la altura del gráfico.
- "11 pts" se cortaba en dos líneas.

### Pasada 4 (v4 y final)

- El toast de "Guardado" tapaba "Faltan 3 partidos", justo lo que tenía que verse bajar. Ahora se ubica arriba de la barra de la pantalla activa.
- En Reglas había dos frases con reglas que inventé. Las cambié por hechos que salen del brief: "la línea azul marca el corte" y "cuentan tus mejores 10".

## Lo que es del prototipo y no de la app

- "Crear torneo", "Torneo rápido", "Cargar partido", el torneo de FIFA, Facu y Juampi muestran un aviso: no están en este prototipo.
- La fecha 8 aparece como "parejas sin sortear" en Inicio y "en juego" adentro. Son dos momentos del mismo martes.
- El historial con Nico (fechas, scores y la racha de 12) es inventado y coherente con el 7 a 5.

# Modo oscuro

Pedido del usuario: "y como se ve el modo oscuro".

**Cómo se elige:**
- Sigue al sistema (`prefers-color-scheme: dark`).
- Se fuerza con `?tema=oscuro` o `?tema=claro`. El hash ya se usa para la pantalla.
- Un script en el `<head>`, antes del CSS, aplica `data-tema` antes del primer pintado, así no hay parpadeo.
- Hay `color-scheme: light dark` y `<meta name="theme-color">` para cada esquema: #1F45E0 en claro, #0E1630 en oscuro. Si se fuerza el tema, el script fija ese color.
- Las copias 01 a 05 se fuerzan claras y las 06 a 09 oscuras, para que la galería no dependa del sistema de quien la mira. `index.html` sigue al sistema.

Es el mismo diseño con otros tokens, no un filtro invertido. Los componentes usan tokens semánticos y el oscuro solo cambia sus valores.

## Búsquedas de la skill para el oscuro

| Búsqueda | Resultado | Qué tomé y qué no |
| --- | --- | --- |
| `"dark mode sports app" --domain style` | 1: Dark Mode (OLED). 2: Modern Dark (Cinema Mobile). 3: Cyberpunk UI | De la 1: base azul medianoche en vez de negro, contraste de texto alto y foco visible. De la 2: "evitar #000000 puro" y capas de superficie. No tomé los acentos neón, los brillos, las manchas de luz animadas, el vidrio esmerilado ni nada de la 3. Es justo la estética de neón sobre negro que el usuario llamó "horribles" en la ronda 1. |
| `"dark mode contrast" --domain ux` | Texto con contraste de 4.5:1 como mínimo; nada de gris sobre gris | Cada par de texto medido abajo; el peor da 5.45. |
| Reglas de la skill `color-dark-mode` y `dark-mode-pairing` (Quick Reference, sección 6) | Variantes tonales desaturadas o más claras, no colores invertidos; claro y oscuro diseñados juntos | El azul y el verde de texto suben de tono (#8DA4FF y #6CD49A). El bloque azul cancha baja un poco (#2643BC) para no encandilar. Los dos temas comparten los tokens. |

## Paleta oscura

| Token | Claro | Oscuro | Uso |
| --- | --- | --- | --- |
| `--bg` | #FFFFFF | #0E1630 | Fondo azul noche, no negro |
| `--surface` | #FFFFFF | #141E3D | Barras de abajo |
| `--surface-2` | #FFFFFF | #1B2750 | Hoja y tu fila en la tabla |
| `--block` | #1F45E0 | #2643BC | Bloques azul cancha: encabezados, fecha 8, marcador, Cargar |
| `--blue` (texto) | #1F45E0 | #8DA4FF | Acento sobre fondo: pestaña activa, Masters, Ganaste, barras |
| `--blue-tint` | #E8EDFF | #1B2A60 | Torneo de pádel, partido sin cargar |
| `--green` / `--green-tint` | #0B7A3B / #E3F5EA | #6CD49A / #133A2A | FIFA |
| `--ink` | #0E1A4A | #EDF0FA | Texto |
| `--muted` | #4B5675 | #A3AECF | Texto secundario |
| `--line` | #DCE1EE | #384679 | Divisores |
| `--cta` | #0E1A4A | #2643BC | Botón principal |
| `--choice` | #E8EDFF | #2A3A78, con borde #4A5A96 | Pareja sin elegir en la hoja |
| `--scrim` | rgba(14,26,74,.5) | rgba(4,8,22,.72) | Fondo detrás de la hoja |
| `--toast-bg` / acción | #0E1A4A / #C9D3FF | #EDF0FA / #1F45E0 | Superficie invertida |
| `--down` | #B42318 | #FF8B7B | Baja en la tabla |
| `--ball` | #DFFF4F | #DFFF4F | Solo "vos" |

**El amarillo, solo para vos, también en oscuro:**
- En la tabla:
  - Tu fila es elevada (#1B2750).
  - Lleva un borde izquierdo amarillo de 4 px.
  - El número del puesto va en amarillo.
- Tu nombre en la fecha va en texto amarillo subrayado, sin relleno.
- El 3° del encabezado y el 7 del marcador con Nico van en amarillo sobre azul.
- Nada más es amarillo.

**Arreglado también en claro:** el "Deshacer" del toast y el destello del partido recién guardado eran amarillos, y no son "vos". Ahora son azul suave (#C9D3FF).

## Contraste del oscuro (WCAG)

| Texto | Fondo | Ratio |
| --- | --- | --- |
| Texto #EDF0FA | fondo #0E1630 | 15.68 |
| Texto #EDF0FA | superficie #141E3D | 14.38 |
| Texto #EDF0FA | hoja y tu fila #1B2750 | 12.70 |
| Texto #EDF0FA | tinte pádel #1B2A60 | 11.93 |
| Texto #EDF0FA | opción de la hoja #2A3A78 | 9.34 |
| Texto #EDF0FA | tinte FIFA #133A2A | 11.07 |
| Secundario #A3AECF | fondo, superficie, hoja | 8.09, 7.42, 6.55 |
| Secundario #A3AECF | tinte pádel, tinte FIFA | 6.15, 5.71 |
| Azul texto #8DA4FF | fondo, superficie, hoja, tinte pádel | 7.56, 6.93, 6.12, 5.75 |
| Verde #6CD49A | tinte FIFA, fondo | 6.91, 9.80 |
| Blanco | bloque azul cancha #2643BC | 8.04 |
| Suave #C9D3FF | bloque azul | 5.45 |
| Amarillo #DFFF4F | bloque azul | 7.11 |
| Bloque #2643BC | píldora blanca "Ver la fecha" | 8.04 |
| Blanco | avatar sobre bloque (#4961C7 resultante) | 5.50 |
| Amarillo #DFFF4F | fondo, tu fila, tinte pádel | 15.78, 12.77, 12.00 |
| Baja #FF8B7B | fondo, tu fila | 7.85, 6.35 |
| Deshabilitado #97A2C4 | #1E2846 | 5.72 |
| Toast #0E1A4A | #EDF0FA | 14.58 |
| Deshacer #1F45E0 | #EDF0FA | 6.18 |
| Barras del gráfico #8DA4FF (dato) | fondo | 7.56 |
| Divisor #384679 (no es texto) | fondo, superficie | 1.97, 1.81 |
| Borde de la opción #4A5A96 (no es texto) | hoja | 2.20 |

## Qué delataba a una IA en el oscuro y cómo lo saqué

### Pasada 1 (oscuro v1)

- Error: "Martín" en la etiqueta amarilla salía en blanco sobre amarillo, porque la etiqueta heredaba la tinta invertida. Ahora la marca tiene tokens propios. En oscuro es texto amarillo subrayado, sin relleno, para que no sea una pastilla de neón sobre azul noche.
- "Cargar partido" casi blanco era lo más brillante de la pantalla, por encima de la fecha. Pasó a azul cancha.
- El bloque azul ocupaba media pantalla y encandilaba de noche. Bajó de #2847C8 a #2643BC. Sigue siendo azul cancha.
- En la hoja, la pareja sin elegir (#1B2A60) se fundía con la hoja (#1B2750). Ahora tiene un tono propio (#2A3A78) y un borde.

### Pasada 2 (oscuro v2)

- El subrayado de "Martín", hecho con una sombra redondeada, se curvaba como una sonrisa. Ahora es un subrayado de texto real, recto.
- La pareja elegida seguía mostrando el borde gris. Ahora no lo tiene.
- Me saqué un accesorio: el avatar "MP" blanco competía con la píldora blanca "Ver la fecha", dos manchas blancas en el mismo bloque. En oscuro el avatar es un círculo translúcido.

### Pasada 3 (oscuro v3 y final)

- El toast "Guardado" sobre azul noche es una superficie clara invertida, con el texto 14.58 y Deshacer 6.18. Lo dejé así: dura cuatro segundos y tiene que verse.
- Revisé en claro que nada cambiara salvo Deshacer y el destello.
