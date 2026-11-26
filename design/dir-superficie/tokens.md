# Dirección Superficie · plan de diseño

La app toma los materiales del club. Lo administrativo es papel blanco; el césped aparece solo donde hay juego, y la cancha vista desde arriba es el único elemento audaz.

## Color

| Nombre | Hex | Uso |
| --- | --- | --- |
| Papel | `#FFFFFF` | Fondo de todo lo que no es juego |
| Tinta | `#17212B` | Texto principal, botón principal |
| Gris vestuario | `#5B6670` | Texto secundario (5,87:1 sobre papel) |
| Césped pádel | `#2163B0` | Canchas de pádel, zona Masters, pestaña activa (blanco encima 6,04:1) |
| Césped FIFA | `#2B7A3E` | Lo que es FIFA (blanco encima 5,31:1) |
| Pelota | `#D8F03A` | Solo el punto que marca "vos"; nunca texto |

Apoyos sin rol de marca: línea de papel `#E2E6EA` (separadores), línea de cancha fantasma `#C3CBD2` (partidos ya jugados).

## Tipografía

- **Barlow** (400, 500, 600, 700): todo el texto. Grotesca de cartelería vial: se lee como la señalética del complejo.
- **Barlow Condensed** (600, 700): solo cifras de juego (games, puntos, puestos, horario). Angosta como un tablero de club, entra en columnas estrechas.
- Escala (px): 13 · 15 · 17 · 22 · 30 · 44. Interlineado 1,3 en texto, 1 en cifras. Sin mayúsculas decorativas, sin tracking abierto.

## Layout

- Columna única de 390 px, márgenes de 20 px, todo alineado a la izquierda; las cifras alineadas a la derecha en su columna.
- La cancha se dibuja vertical (como la ves desde la tribuna del fondo): la red cruza horizontal y separa las dos parejas, una arriba y otra abajo, cada una con el ancho completo para su nombre.
- En la tabla, los 4 del Masters juegan "adentro" de la cancha: el corte del Masters es la línea de fondo.
- En la fecha, cada mitad de la cancha es un botón: tocás la pareja que ganó (toque 1) y los games del perdedor (toque 2).

```
Inicio                     Tabla                      La fecha
Hola, Martín      (MP)     ‹ Inicio                   ‹ Los Pibes del Martes
Lo próximo                 Los Pibes del Martes       Fecha 8
┌──────────────────┐       ┌─────────────────┐        formato, parejas
│ Fecha 8 · horario│       │ 1 Nico       58 │        Ronda 1 (líneas fantasma)
│────── red ───────│       │ 2 Lucas      54 │        Ronda 2
│ ●●●●●●●●●● ○○    │       │ 3 Martín ●   51 │        ┌──────────────┐
└──────────────────┘       │ 4 Juampi     47 │        │ Martín y Tomi│ ganó
Tus torneos  [tira]        └── corte ────────┘        │──── red ─────│
Con tus amigos             5 Tomi        44           │ 0 1 2 3 4 5  │
[Cargar un partido]        …                          └──────────────┘
Crear torneo | Rápido      Tabla Fechas Stats Reglas  [Cerrar la fecha] faltan
```

## Principios

1. El color de césped es información: significa "acá se juega" y dice qué deporte es. Nunca decora.
2. Las líneas blancas de la cancha siempre separan algo real (parejas, el corte del Masters).
3. Papel tranquilo: listas sin tarjetas, separadas por aire y una línea fina; un solo radio chico (4 px) en canchas, 10 px en botones.
4. Lo que se toca de pie va abajo y mide 52 px o más.
5. Copys de una línea, con voseo, sin relleno.

## Revisión contra los defaults

Antes de construir:

- El primer plan ponía lo próximo en una tarjeta azul lisa con botón, que es la ronda 1 repintada. Lo cambié por una cancha dibujada donde la red separa algo real: arriba cuándo y dónde, abajo quiénes confirmaron.
- Ganó y perdió iban en verde y rojo. El verde ya significa FIFA, así que el resultado se dice con palabras ("Le ganaste", "Perdiste") y el color del marcador dice el deporte.
- Las subidas y bajadas de la tabla iban en verde y rojo: quedaron como triángulos en tinta y gris.

En las capturas:

- Inicio: saqué la tira de 12 casilleros con el puesto (parecía un slider y repetía el "3° de 12"), saqué la línea de arriba de cada lista y achiqué la zona de saque de la cancha.
- Tabla: saqué la raya decorativa al lado de "Los 4 primeros van al Masters" y la barra de pestañas fija que tapaba filas; reacomodé columnas para que "Juampi Ledesma" entre en una línea.
- La fecha: saqué el recuadro punteado del score que falta (la pregunta ya lo dice) y bajé el tinte de la mitad ganadora para que el blanco siga en AA.
