# App real · tokens

Ronda 4. Brief: `design/brief-ronda-4.md`. Spec: `odd/tasks/rediseno-app.md` (S2-S7).

## Plan

1. La captura tiene que pasar por una app del App Store: barra de estado, barra de navegación con título grande, listas agrupadas, barra de pestañas, hoja que sube desde abajo e indicador de inicio.
2. El fondo es el gris agrupado de iOS y las celdas son blancas. No hay tarjetas decorativas: solo grupos de filas.
3. El único gesto de marca es el color del deporte. Pádel es azul y FIFA es verde, y ese color tiñe el ícono, tu puesto, los links y la pestaña activa adentro del torneo.
4. Fuera de un torneo, el tinte es negro: el botón Cargar partido y el texto.
5. Usamos una sola familia, Hanken Grotesk, porque tiene cifras tabulares reales. Instrument Sans no las tiene y Onest es muy ancha a 15 px.
6. Datos en vez de oraciones: "10/12" con ícono, "Rama no va", "Sorteo pendiente" como estado y el formato en una sola línea gris.
7. Hay como máximo tres encabezados por pantalla, en gris y con mayúscula solo en la inicial. No hay saludo.
8. Las filas de la tabla miden 44 px y los 12 jugadores entran en 844 px.
9. La carga se hace en dos toques: la pareja ganadora ya está marcada con su 6 y los games del perdedor esperan en un recuadro punteado.
10. El dibujo propio se usa solo donde no hay ícono. La raqueta con pelota se hizo a mano con la grilla y el trazo de Lucide.

Revisión del plan contra los rasgos de IA del brief: la primera versión del plan tenía una tarjeta "Próxima fecha" con un encabezado propio y una fila de avatares apilados como prueba social. Las dos cosas son relleno de dashboard. Se sacaron antes de la versión final (ver más abajo).

## Color

| Token | Hex | Uso |
| --- | --- | --- |
| ink | `#000000` | Texto principal y botón Cargar partido |
| ink-2 | `#3c3c43` | Texto secundario fuerte (lugar, fecha y hora) |
| muted | `#6c6c70` | Gris secundario, encabezados de sección y pestañas inactivas |
| quiet | `#c4c4c7` | Chevrons y el guion de "sin cambio" (decorativos, no son texto) |
| hair | `#c6c6c8` | Separadores de 0,5 px |
| bg | `#f2f2f7` | Fondo agrupado y botones de games |
| cell | `#ffffff` | Celdas y hoja |
| padel | `#0b5cd5` / soft `#e8f0fc` | Pádel: ícono, tu puesto, links, zona Masters y pareja elegida |
| fifa | `#1a7a3a` / soft `#e4f3e8` | FIFA |
| up / down | `#1a7a3a` / `#c4141f` | Cambio de puesto |
| estado | `#7a4b00` sobre `#fff1d6` | Sorteo pendiente |

Avatares: hay un tinte fijo por persona, con fondo claro e iniciales oscuras del mismo tono. Es el mismo en las tres pantallas: Nico y Mati índigo, Lucas naranja, Martín y Fede verde agua, Juampi verde, Tomi y Pato rosa, Gonza y Rama ocre, Facu violeta y Seba pizarra.

### Contraste (WCAG AA)

| Par | Texto | Fondo | Ratio |
| --- | --- | --- | --- |
| Texto principal en celda | `#000000` | `#ffffff` | 21.00 |
| Texto en fondo agrupado, números de la hoja | `#000000` | `#f2f2f7` | 18.82 |
| Tu fila, pareja elegida | `#000000` | `#e8f0fc` | 18.30 |
| Secundario fuerte en celda | `#3c3c43` | `#ffffff` | 10.94 |
| Meta de la fecha | `#3c3c43` | `#f2f2f7` | 9.80 |
| Gris secundario en celda | `#6c6c70` | `#ffffff` | 5.23 |
| Encabezados de sección | `#6c6c70` | `#f2f2f7` | 4.69 |
| "vos" en tu fila | `#6c6c70` | `#e8f0fc` | 4.56 |
| Pestañas inactivas | `#6c6c70` | `#fafafc` | 5.02 |
| Pádel en celda | `#0b5cd5` | `#ffffff` | 5.99 |
| Volver, sobre fondo agrupado | `#0b5cd5` | `#f2f2f7` | 5.37 |
| Tu puesto, En juego | `#0b5cd5` | `#e8f0fc` | 5.22 |
| Pestaña activa | `#0b5cd5` | `#fafafc` | 5.75 |
| 6 de la pareja ganadora | `#ffffff` | `#0b5cd5` | 5.99 |
| FIFA, sube | `#1a7a3a` | `#ffffff` | 5.40 |
| Baja | `#c4141f` | `#ffffff` | 6.06 |
| Baja en tu fila | `#c4141f` | `#e8f0fc` | 5.28 |
| Sorteo pendiente | `#7a4b00` | `#fff1d6` | 6.64 |
| Cargar partido | `#ffffff` | `#000000` | 21.00 |
| Avatar Nico, Mati | `#30379b` | `#e1e5fb` | 7.83 |
| Avatar Lucas | `#873800` | `#fde5d2` | 6.67 |
| Avatar Martín, Fede | `#0d5c60` | `#d6eff0` | 6.43 |
| Avatar Juampi | `#1c6a33` | `#dcf2e1` | 5.64 |
| Avatar Tomi, Pato | `#9a1a2f` | `#fbe1e5` | 6.63 |
| Avatar Gonza, Rama | `#6b5000` | `#f7edc4` | 6.44 |
| Avatar Facu | `#6a2b9c` | `#ede0f9` | 6.82 |
| Avatar Seba | `#3d4855` | `#e3e7ec` | 7.49 |
| Ícono cerrar de la hoja | `#55555a` | `#eeeef0` | 6.40 |
| Cerrar la fecha, deshabilitado | `#8e8e93` | `#ffffff` | 3.26 (exento: control inactivo) |

La pantalla de la fecha atenuada detrás de la hoja es inerte (`aria-hidden`) y no se mide.

## Tipografía

Usamos Hanken Grotesk, incrustada en base64 (la latina variable). Las cifras son tabulares en todo el documento.

| Rol | Tamaño / interlínea | Peso |
| --- | --- | --- |
| Título grande (Inicio) | 34 / 41 | 700, tracking −0,025em |
| Título grande (torneo, fecha) | 30 / 36 | 700 |
| Hora y fecha destacadas | 22 / 28 | 700 |
| Cuerpo y filas | 17 / 22 | 400; nombres de amigos 600; puntos 700 |
| Secundario y encabezados | 15 / 20 | 400; encabezados 600 |
| Notas y estados | 13 / 18 | 400-600 |
| Pestañas | 11 / 13 | 600 |

## Espaciado y forma

- Márgenes laterales de 16 px. Los grupos tienen 12 px de radio y la hoja 16 px arriba. Los botones de games y las parejas tienen 14 px de radio.
- Alturas: filas de tabla de 44 px, filas de lista de 46-60 px, botones de games de 58 px, botón principal de 50 px y barra de pestañas de 49 + 34 px.
- Los separadores son de 0,5 px y arrancan donde empieza el texto, no en el borde.
- Objetivos de toque de 44 px como mínimo y `:focus-visible` de 3 px con el color del deporte.

## Íconos

- Un solo set, de trazo 2 con puntas y uniones redondas, en una grilla de 24.
- Los trazos son de Lucide (ISC) copiados a mano: chevrons, más, cruz, tilde, puntos, pin, personas, persona con cruz, rayo, trofeo, calendario, barras, libro y joystick.
- La raqueta con pelota es propia y está hecha con la misma grilla y el mismo trazo. La primera versión parecía una lupa y la segunda una lamparita.
- En los íconos de deporte de las listas el glifo va en blanco sobre un cuadrado redondeado del color del deporte, como en Ajustes de iOS. Las acciones van en tinta sobre gris.

## Qué delataba a una IA y cómo lo saqué

**Plan, antes de construir**
- Saqué el saludo y las secciones de página web ("Lo próximo", "Armar algo nuevo"). La pantalla se llama Inicio, con título grande de iOS.
- Saqué las oraciones que narraban, como "Confirmaron 10 de 12" y "Cada pareja juega con todas". Quedaron "10/12", "Sorteo pendiente" y "Todos contra todos, 1 set a 6".
- Saqué la cancha dibujada y las figuritas. La identidad quedó solo en el color del deporte.
- Saqué las tres acciones como botones grandes iguales. Cargar partido quedó en la barra fija de abajo, y Crear torneo y Torneo rápido como filas al final de Torneos.

**Pasada 1 (v1)**
- Inicio: la fila de cinco avatares apilados era prueba social de plantilla y cortaba las iniciales. La saqué.
- Inicio: saqué el encabezado "Próxima fecha", porque la celda ya dice Fecha 8 y 20:30.
- Inicio: la raqueta se leía como una lupa. La redibujé.
- Tabla: "Fechas" tenía otro tamaño que "Pts". Igualé los dos encabezados.
- Tabla: los separadores iban de borde a borde, como en una planilla. Ahora arrancan en el avatar.
- Fecha: el subtítulo de la hoja repetía las dos parejas que ya están abajo. Lo saqué y centré el título.
- Fecha: los avatares en pareja se pisaban las iniciales. Ajusté el orden y el solapamiento.

**Pasada 2**
- Inicio: la segunda raqueta parecía una lamparita. Quedó raqueta con pelota.
- Inicio: ajusté el ritmo de las filas para que la pantalla entre en 844 px sin scroll, como una captura real.
- Fecha: el partido en carga figuraba en la pantalla de atrás como si ya estuviera guardado. Ahora dice "Cargando".
- Fecha: se veía media línea de texto asomando bajo el borde de la hoja, y parecía un error. Moví el borde.

**Pasada 3**
- Revisé las tres capturas buscando mayúsculas decorativas, "·", "→", tarjetas iguales con sombra, degradés y textos de presentación. No quedó ninguno.
- Queda una sola línea de ayuda por pantalla: "Una tarde, sin tabla ni fechas", "Se descartan las 2 peores fechas" y "Faltan 4 partidos".

## Contenido que cambió respecto del brief de la ronda 3

- El último partido con Juampi pasa de 6-2 7-5 a 6-2 7-6, por la regla 9 del brief 4 (un 7-6 en algún resultado).
- Agregué "Rama no va" como el jugador que avisó que no va: 10 confirmados, Rama baja y queda uno sin responder.
