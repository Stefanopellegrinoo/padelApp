# Dirección Álbum · plan de diseño

Los amigos son la colección. Cada persona es una figurita del álbum del Mundial; todo lo que no es persona es papel blanco y tinta.

## Color

| Nombre | Hex | Uso |
| --- | --- | --- |
| Tinta de álbum | `#17284A` | Texto, iniciales, botón principal. Un azul marino de imprenta, no un negro teñido. |
| Papel | `#FFFFFF` | Fondo de la página y borde troquelado de cada figurita. |
| Celeste | `#7DB3E3` | Solo el marco de las figuritas, la lámina de confirmados y el corte del Masters. Nunca texto sobre papel. |
| Celeste hondo | `#1D5C9C` | Links, "ganaste", "sube", foco. |
| Dorado | `#D2AC45` | Solo la figurita del 1° de la tabla (Nico). Brillo de figurita metalizada. |
| Lápiz | `#5A6578` | Texto secundario. |

Derivados: línea `#E2E7EF` (separadores), lámina `#EEF4FB` (fondo de la zona Masters, de lo próximo y de la ronda en juego), fila vos `#DCEAFA`, centro de figurita `#F5F9FD` (oro: `#F8EFD2`).

Contraste (todo texto pasa AA): tinta/papel 14.6 · lápiz/papel 5.89 · hondo/papel 6.86 · tinta/lámina 13.18 · lápiz/lámina 5.32 · hondo/lámina 6.19 · lápiz/fila vos 4.82 · hondo/fila vos 5.61 · papel/tinta 14.6 · tinta/centro 13.8 · tinta/centro oro 12.7 · tinta/número celeste 6.55 · tinta/número dorado 6.76 · lápiz/botón deshabilitado 4.96.

## Tipografía

Familjen Grotesk (variable, una sola familia), incrustada en base64.
Por qué: su "a" y su "g" de un solo piso y los cuencos redondos la hacen amistosa, pero el dibujo es de grotesca adulta, no de libro infantil. Además se llama "familia". Bricolage era la otra candidata, pero es la fuente de moda de las landings generadas; Hanken y Schibsted se leían neutras, de planilla.

Escala (px, tamaño/interlínea): 12.5/16 · 14/20 · 16/22 (texto) · 20/24 · 28/30 (títulos) · iniciales de figurita = 36% del ancho de la figurita. Pesos: 450 texto, 600 énfasis, 760 títulos e iniciales. Cifras tabulares en la tabla y los resultados.

## Layout

Alineado a la izquierda, márgenes de 20 px, sin tarjetas: las listas van sobre el papel, separadas por líneas finas, y el color lo ponen las figuritas.

```
Hola, Martín                [MP 3]  <- tu figurita es tu cuenta
Inicio
─ Lo próximo ───────────────────────  (lámina celeste a todo el ancho)
Fecha 8, 12 huecos: 10 figuritas pegadas, 2 vacíos
[Ver la fecha]
Tus torneos     filas de texto, sin ícono
Con tus amigos  [fig] Nico Arias / resultado / historial
[Cargar un partido con un amigo]
Crear torneo | Torneo rápido
```

Tabla: los 4 del Masters son una página del álbum (2 × 2 figuritas de 64 px con sus puntos); del 5° al 12° es una lista común con el puesto en la primera columna, sin figurita.
La fecha: las parejas son dos figuritas pegadas una sobre otra; la carga del partido en juego va en la mitad de abajo, con botones de 56 px.

## Principios

1. Solo las personas son figuritas. Torneos, fechas y botones son tipografía sobre papel.
2. La figurita tiene anatomía real: borde blanco troquelado con una sombra de despegue hacia abajo a la derecha, retrato enmarcado con las iniciales, banda de color abajo con el nombre corto ("Nico") y el número (su puesto) en la esquina de arriba. Colores planos, sin brillo. Dos tamaños: 64 px (Masters y parejas) y 44 px (filas; nombre a 10 px).
3. Una sola figurita dorada en toda la app: el primero.
4. Las palabras dicen lo que pasa, como en el grupo: "le ganaste", "ganás 7 a 5".
5. Radios por jerarquía: figurita 5 px (troquel), botones 10 px, nada más redondeado.

## Revisión contra los defaults

Primer plan y qué cambió:

- **Lo próximo como tarjeta de color con "3° de 12" gigante.** Era el combo número grande + etiqueta + fondo de color que el brief prohíbe. Ahora es una lámina del álbum: 12 huecos, 10 con figurita pegada y 2 vacíos. "Confirmaron 10 de 12" se ve en vez de leerse.
- **Bricolage Grotesque.** Es la fuente que más aparece en diseños generados. Cambié a Familjen Grotesk.
- **Secciones en tarjetas redondeadas con sombra gris.** Sacadas: listas sobre papel con líneas finas. La única "sombra" es el canto de la figurita (1 px duro, como papel pegado).
- **Títulos de sección en mayúsculas espaciadas.** Ahora son títulos en oración, del mismo color que el texto.
- **Figuritas para todo (torneos, acciones).** Se volvía infantil. Contención: solo personas.
- **Metadatos con punto medio ("Pádel · Fecha 7").** Reescritos como frases: "Pádel, fecha 7 de 12".

Cambios durante la autocrítica sobre capturas:

- **Campo celeste lleno con trama de rayas.** Se leía como un mosaico o un relleno de "placeholder". Pasó a marco celeste con centro claro: ahora parece figurita y las iniciales tienen más contraste. El número va en una esquina del color del marco.
- **Lámina de confirmados con figuritas enmarcadas.** A 25 px parecían casilleros vacíos. Volvieron a ser llenas: lo que importa ahí es lleno contra vacío.
- **Tarjetas en "Armar algo nuevo" y tarjeta blanca dentro de la ronda en juego.** Sacadas. Filas y botones directos sobre la lámina.
- **Figuritas superpuestas en las parejas.** Tapaban las iniciales. Ahora van pegadas lado a lado, apenas torcidas, como recién pegadas.
- **Figuritas dentro de los botones de "¿Quién ganó?".** Repetían las parejas y achicaban el toque. Quedó el nombre grande.

Ronda 2 de crítica (director de arte):

- **La figurita era una caja de iniciales con borde.** Ahora tiene banda con el nombre, número en la esquina, sombra de despegue y dos tamaños pensados aparte. Se sacó el brillo del dorado: color plano.
- **12 figuritas iguales en la tabla.** Solo los 4 del Masters son figuritas, en una página del álbum; los casilleros blancos detrás de cada una también se sacaron porque volvían a ser tarjetas.
- **Parejas sin rótulo de texto:** el nombre ya va en la banda de cada figurita.
- **"Faltan 4 partidos":** 6 partidos en total, la ronda 1 está guardada y el partido de la ronda 2 todavía no.
