# Dirección Marcador · plan de diseño

Idea: cada partido de la app se lee como el marcador que ponen en la tele arriba a la izquierda (el "scorebug"). Dos franjas, una por pareja, códigos de tres letras y los games en celdas fijas. Todo lo demás es papel y tinta, callado.

## Color

| Nombre | Hex | Uso |
| --- | --- | --- |
| Hormigón | `#ECEEF1` | Fondo de la app. Gris frío, como el piso de la tribuna. Nunca crema. |
| Papel | `#FFFFFF` | Hojas de lista (torneos, amigos, tabla) y franjas de pareja. |
| Tablero | `#1C2638` | Celdas de marcador: azul pizarra de tablero, no negro teñido. |
| Tinta | `#1A1F29` | Texto principal sobre claro. |
| Grafito | `#5A6270` | Texto secundario. |
| LED | `#D1231B` | El único acento. Solo marca "en juego" y "vos". Sobre tablero se usa su versión encendida `#FF5247`. |

Colores de pareja (solo en La fecha, porque ahí hay cuatro parejas que se repiten en tres rondas): un set fijo de cuatro pestañas, `#2F5BD3` azul, `#14896A` verde, `#C98A0B` ámbar, `#7A4FD1` violeta. Nunca llevan texto encima; son la pestaña de color del equipo, como en la tele.

## Tipografía

- **Barlow Condensed itálica 600/700**: todo lo que es gráfico de marcador. Dígitos, códigos de tres letras (NIC, LUC, MAR), nombres de torneo dentro del tablero. La itálica es la inclinación de los zócalos deportivos.
- **Barlow Condensed recta 600**: títulos de pantalla y de sección; condensada pero sin inclinar, para que el gráfico (inclinado) y la estructura (recta) no se confundan.
- **Barlow 400/500/600**: texto corrido, nombres completos, explicaciones.
- Dígitos con `tabular-nums` para que las celdas no bailen.

Escala (px): 13 · 15 · 17 · 22 · 30. Cifras de celda: 22 en listas, 30 en el marcador grande y en el selector de games. Interlineado 1.35 en texto corrido, 1 en celdas.

## Layout

Columna única de 390, márgenes de 16. Alineado a la izquierda; los números se alinean a la derecha dentro de sus celdas.

```
Inicio                         Tabla                         La fecha
┌───────────────────────┐      ┌───────────────────────┐     ┌───────────────────────┐
│ Hola, Martín      [MP]│      │ Inicio   Los Pibes…   │     │ Fecha 8      ● En juego│
│ Lo próximo            │      │ ▌1 NIC Nico Arias  58 │     │ parejas: ▌MAR/TOM …   │
│ ███ tablero: fecha 8  │      │ ▌2 LUC …           54 │     │ Ronda 1  [bug] [bug]  │
│ ███ 20:30 ● ● ● ○ ○   │      │ ▌3 MAR vos (LED)   51 │     │ Ronda 2  [bug carga]  │
│ Tus torneos (hoja)    │      │ ▌4 JUA …           47 │     │ Ronda 3  pendiente    │
│ Con tus amigos        │      │ ── corte Masters ──── │     │┌─────────────────────┐│
│ [bug MAR 6 6 / NIC 4 3]│     │ 5 … 12                │     ││ games de JUA/GON    ││
│ Cargar · Crear · Rápido│     │ Tabla Fechas Stats…   │     ││ [0][1][2][3][4][5]  ││
└───────────────────────┘      └───────────────────────┘     ││ Cerrar la fecha     ││
                                                             └─────────────────────┘
```

## Principios

1. Lo memorable es el scorebug y aparece solo donde hay un resultado: amigos en Inicio, cada partido de La fecha, el selector de games. La tabla usa el mismo tablero para la columna de puesto y puntos, nada más.
2. El rojo LED significa "vos" o "en juego". Si algo es rojo y no es ninguna de las dos cosas, está mal.
3. Los códigos de tres letras van en mayúsculas porque así existen en un marcador. Ninguna otra cosa va en mayúsculas.
4. Nada de tarjetas iguales: hay hojas blancas con renglones, tableros oscuros con celdas y botones. Tres objetos, tres formas.
5. En La fecha lo que se toca está abajo, al alcance del pulgar, en celdas de 52 px.

## Revisión contra los defaults

Primer plan y lo que cambié:

- **Fondo casi negro con el rojo como acento único.** Era mi primera imagen de "marcador de estadio" y es exactamente el default 2 (negro con un acento brillante), además de que el usuario rechazó lo oscuro. Pasé a hormigón claro y dejé lo oscuro solo dentro de las celdas, que es donde un marcador real es oscuro.
- **Tablero `#111`.** Negro teñido es una marca de plantilla. Lo cambié por azul pizarra `#1C2638`, que es el color real de los gráficos de transmisión y separa la celda del texto en tinta.
- **Fuente mono para los dígitos.** La tenía anotada "porque es un marcador": es el default 5. Las celdas ya dan el ancho fijo; con `tabular-nums` en Barlow Condensed alcanza.
- **"3°" gigante en el próximo partido.** Era el combo número enorme + etiqueta chica que el usuario ya vio. Ahora el puesto va en una frase ("Vas 3° de 12") y lo grande del bloque es el tablero de confirmados: doce luces, diez encendidas.
- **Encabezados de sección como etiquetas chicas en mayúsculas con tracking.** Pasaron a Barlow Condensed recta, tamaño de título, en minúsculas normales.
- **Colores por pareja en todas las pantallas.** Los recorté a La fecha, la única pantalla donde distinguir cuatro parejas en tres rondas ayuda a leer. En Inicio y Tabla no suman.

Durante la construcción, en las pasadas de autocrítica sobre las capturas, saqué esto:

- Inicio: el contador de fechas en rayitas debajo de cada torneo, las celdas oscuras del puesto en "Tus torneos" y el relleno oscuro del botón "Cargar un partido con un amigo". El resultado: solo hay dos cosas oscuras, el tablero de lo próximo y los marcadores con amigos.
- Tabla: la columna oscura de puesto (quedaba en dos columnas oscuras; ahora solo los puntos son celdas de marcador) y la frase del Masters repetida en la nota. Además saqué la barra de navegación fija, que tapaba la nota.
- La fecha: el código MAR/TOM en rojo en cada marcador (ahí la pareja ya se reconoce por su pestaña) y el marco rojo alrededor del partido que se está cargando. El rojo quedó solo para "En juego" y para la celda del game que falta.

Segunda ronda, después de la crítica del director de arte:

- Tabla: solo los puntos del 1 al 4 (la zona del Masters) van en celdas llenas de tablero. Del 5 al 12, la misma celda pero en papel, con un contorno fino y dígitos en tinta. El corte del Masters se lee dos veces.
- La fecha: "En juego" al lado de Ronda 2 pasó al gris tranquilo de "Terminada" y "Pendiente"; el rojo queda solo en el encabezado. El pie dice "Faltan 4 partidos".
