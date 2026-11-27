# Amigos fáciles

Sumar amigos sin copiar IDs: desde el perfil del torneo, con sugerencias de la gente de tus torneos, con los pedidos a la vista y con un link de amistad.
Maquetas aprobadas en `design/amigos-faciles/` (A, B, C, D). Rama `feat/amigos-faciles`.

## Specs

- S1. Pedido textual: "Quiero agregar que sea mas facil agregar amigos, tipo que desde torneos se puedan agregar amigos y cosas asi, pensemoslo bien. Siempre hay que buscar cual es la manera para que al usuario le sea comoda y facil de usar la app"
- S2. A · Agregar desde el perfil del torneo (`design/amigos-faciles/01-perfil-del-torneo.html`, opción 1 "Arriba a la derecha"). El control va en la misma línea que "‹ Tabla", a la derecha, y cambia según el estado:
  - No son amigos: chip "Agregar". Un toque manda el pedido.
  - Pedido enviado: chip "Enviado" y el aviso "Le mandaste el pedido a Nico" con "Deshacer", que borra el pedido.
  - Él te pidió: respuesta textual "el "nico ya te pdio" a que se noto mas como antes". Va la tarjeta blanca grande en el encabezado: "Nico te pidió ser amigos", "Hace 2 días", "Aceptar" y ✕ (rechaza).
  - Ya son amigos: chip "Amigos ›", que lleva al historial entre los dos.
  - No aparece en tu propio perfil ni en un lugar del torneo que nadie reclamó (sin cuenta).
- S3. B · Gente de tus torneos (`02-gente-de-tus-torneos.html`). En Amigos, abajo de "Tus amigos", la sección "Gente de tus torneos" con "Jugaron con vos y tienen cuenta": gente con cuenta que compartió al menos un torneo con vos, que no es tu amiga y no tiene un pedido pendiente con vos, en ninguna dirección. Primero los que más fechas jugaron con vos. Cada fila dice de dónde ("Los Pibes del Martes · 7 fechas" o "2 torneos · 9 fechas juntos") y tiene "Agregar", que pasa a "Enviado". Se ven unos pocos y "Ver los 11" muestra el resto. En Inicio, si todavía no tenés amigos, la sección Amigos muestra "Empezá por la gente de tus torneos" con las dos primeras personas y "Ver más gente".
  - Respuesta elegida: "No, uno por uno (recomendado)": sin "Agregar a todos".
  - Respuesta elegida: "Sí, vuelve a aparecer (recomendado)": si alguien rechaza tu pedido, vuelve a aparecer en las sugerencias.
  - Sin buscador por nombre: la lista de todos los jugadores está cerrada a propósito (0103).
- S4. C · Los pedidos se ven (`03-pedidos-visibles.html`).
  - Inicio: el pedido va arriba de tus amigos, resaltado: "Juampi Ledesma", "Te pidió ser amigos · Los Pibes del Martes", "Aceptar" y ✕. Al aceptar: aviso "Ahora sos amigo de Juampi" con "Ver", que lleva a su historial.
  - Amigos: "Te pidieron" con "De Los Pibes del Martes", "Aceptar" y ✕; "Pedidos enviados" con "Sin respuesta · hace 3 días" y "Cancelar".
  - Rechazar borra el pedido. Al otro le desaparece de "Pedidos enviados", sin aviso. No tiene deshacer.
  - "De dónde lo conocés" sale de los torneos compartidos. Si no comparten ninguno, no dice nada.
- S5. D · Tu link de amistad (`04-link-de-amistad.html`). Respuesta elegida: "Amigos al toque (recomendado)": "Compartir el link ya es tu consentimiento, como el link de invitación al torneo. Si el link se filtra, lo podés regenerar."
  - Amigos: respuesta textual "en la d Amigos . que Amigos este en la misma linea compartir mi linkk". "Compartir mi link" va en la misma línea que el título "Amigos". El cuadro del ID desaparece.
  - Hoja "Tu link de amistad": "Quien lo abra queda como tu amigo. Mandáselo a quien quieras sumar.", el link con "Copiar", "Compartir" (menú del teléfono; si no hay, copia) y "Cambiar el link" con "El de ahora deja de andar. Tus amigos siguen."
  - Quien abre el link ve "Link de amistad", el nombre, "te invita a ser amigos", "Siendo amigos": "Ven el historial de lo que jueguen" ("En torneos y en partidos sueltos") y "Cargan partidos entre ustedes" ("Sin armar un torneo"), "Sumarme como amigo", "Ahora no" y "¿No tenés cuenta? La creás y volvés acá solo."
  - Al confirmar quedan amigos y cae en el historial con "Listo, ya son amigos" y "Cargar un partido con Martín".
  - Casos borde: si ya eran amigos, abre el historial. Si abrís tu propio link, te avisa. Con un link cambiado: "Este link ya no anda, pedile uno nuevo".
- S6. Respuesta textual: "los botones de agregar son muy grandes". Los botones de agregar son chips de 34 px a la vista, con 44 px de zona de toque.

## Decisiones del orquestador (para que el usuario corrija si no le cierran)

- "Fechas juntos" cuenta las fechas de torneo en las que jugaron los dos.
- Si el otro ya te había pedido amistad, "Agregar" en el perfil o en las sugerencias acepta su pedido en vez de crear otro.
- El link de amistad lleva un token largo y aleatorio, no tu ID. Cambiarlo invalida el viejo; las amistades ya hechas siguen.
- Si al abrir el link había un pedido pendiente entre los dos, en cualquier dirección, queda aceptado.
- En "Gente de tus torneos", una fila a la que le tocaste "Agregar" queda con "Enviado" mientras sigas en la pantalla. Al volver a entrar, esa persona pasa a "Pedidos enviados" (S4) y deja de aparecer en las sugerencias.
- En Inicio, "Ver más gente" aparece solo si hay más de 2 sugerencias: con 1 o 2 no te mostraría a nadie nuevo.
- "De dónde lo conocés" con varios torneos compartidos muestra el primero y cuántos más, por ejemplo "De Los Pibes del Martes y 1 más".

## Tasks

- [x] T1 · S1, S2, S6 · worker (backstop) · A: chip en el perfil del torneo (Agregar / Enviado + Deshacer / tarjeta "te pidió" con Aceptar y ✕ / Amigos ›) y borrar amistad en `db/friends.ts`. Commit: 0e45fcf
- [x] T2 · S1, S3, S6 · worker (backstop) · B: lectura "gente de tus torneos" (fechas juntos, torneos compartidos), sección en Amigos con "Ver los N", Inicio sin amigos. Commit: 40bbe6a
- [x] T3 · S1, S4 · worker (backstop) · C: pedidos en Inicio con aviso al aceptar, rechazar y cancelar en Amigos, "de dónde lo conocés" y "hace N días". Commit: 1d923a5
- [ ] T4 · S1, S5, S6 · worker (backstop) · D: migración del link de amistad (token por jugador, funciones `security definer` para ver el nombre, aceptar y cambiar el link), `/amigo/[token]` con registro y vuelta, hoja de compartir, "Compartir mi link" en la línea del título, sin el cuadro del ID. Riesgo alto, ítem 2 (seguridad): commit propio. Commit: —
- [ ] T5 · S1-S6 · verify · Verificación independiente (D por riesgo) y recorrido en el navegador de A-D. Commit: —

## Log

- L1 (2026-11-27) Pedido: "Quiero agregar que sea mas facil agregar amigos, tipo que desde torneos se puedan agregar amigos y cosas asi, pensemoslo bien. Siempre hay que buscar cual es la manera para que al usuario le sea comoda y facil de usar la app"
- L2 Relevamiento:
  - Hoy sumar un amigo pide pegar un UUID (`app/amigos/mi-id.tsx`, input en `app/amigos/page.tsx`).
  - El perfil del torneo (`app/torneo/[id]/[disciplina]/jugador/[entryId]/page.tsx`) no tiene acción de amistad, aunque `entriesOf` trae `playerId` (null si nadie reclamó el lugar).
  - Inicio (`app/torneos/page.tsx`, `amigosDeInicio`) solo muestra amigos aceptados, así que los pedidos recibidos no se ven.
  - `friendships_delete` (0070) ya deja borrar a cualquiera de los dos, pero la UI no lo ofrece.
  - `player_display_names` (0103) resuelve nombres de quien comparte temporada, de amigos (aceptados o pendientes) y de quien comparte un partido casual. La lectura directa de `players` está cerrada.
- L3 Respuestas: link "Amigos al toque (recomendado)"; sugerencias "No, uno por uno (recomendado)". Alcance: el usuario pidió "me podes mostrar una maqueta de cada caso?".
- L4 Maquetas `design/amigos-faciles/`: 01 perfil del torneo, 02 gente de tus torneos, 03 pedidos visibles, 04 link de amistad. Canvas por Tailscale con el proxy de siempre (`proxy.mjs`, unidad `padel-canvas-proxy`, puerto 33039).
- L5 Feedback: "me gusta bastante, lo unico sientoq eu los botones de agregar son muy grandes y en perfil lo pondria en otro lado cappero despues en si me gusaaz". Botones de agregar pasan a chips; A muestra tres lugares y recomienda "Arriba a la derecha".
- L6 Feedback: "me gustron todos, el unico que cambiaria es que el "nico ya te pdio" a que se noto mas como antes. el rtesto esta muyu bien.  Y en la d Amigos . que Amigos este en la misma linea compartir mi linkk". Elegida la opción 1 de A; las cuatro láminas quedan como diseño aprobado, sin alternativas pendientes.
- L7 Respuestas: alcance "Todo: A + B + C + D (recomendado)"; rechazados "Sí, vuelve a aparecer (recomendado)".
- L8 Entrega: rama `feat/amigos-faciles` desde `main` local. 81c2062 trae este documento y las maquetas: unas 1300 líneas de HTML de diseño, sin código. Después va un commit por tarea, y T4 deja su migración en un commit propio para que se pueda revisar sola. T1 se delega por el límite de contexto del orquestador; T1 a T4 comparten `db/friends.ts` y `/amigos`, así que van de a una.
- L9 T1 hecho (0e45fcf, 990 líneas con los tests). `friendshipWith`, `addFriend`, `acceptFriendRequestFrom`, `cancelFriendRequest` y `rejectFriendRequest` en `db/friends.ts` trabajan con el id del otro jugador, nunca con un id de fila. Deshacer y ✕ solo borran un pedido pendiente: un Deshacer tarde no borra una amistad recién aceptada. Hero suma el prop `action`; sin él se ve igual que antes, y hay un test que lo fija. Evidencia: RED 17 db + 5 de página; GREEN db 71/71; typecheck limpio y unit 2230/2230, corridos por el orquestador; navegador a 390 px en claro y oscuro (Agregar → Enviado → Deshacer, tarjeta → Aceptar → Amigos ›, sin control en el perfil propio). ✕ no se probó en el navegador, pero lo cubren los tests de db y DOM. Pendiente para T3: "Amigos ›" lleva a `/amigos/<id>?desde=amigos`, así que el Volver de esa pantalla dice "Amigos" en vez de volver al perfil del torneo. La base local quedó con usuarios sembrados `amigos-t1-*@example.com`.
- L10 T2 hecho (40bbe6a). `genteDeTusTorneos` en `db/friends.ts` lee en páginas de 1000 filas con orden total y parte las listas largas de ids en tandas (150 por `in`, 500 nombres por llamada). Si los datos cambian entre una página y la siguiente, corta con error en vez de contar sobre datos mezclados. Lo comprobó un test: con tandas de 1000 y 5000, las pruebas de límites fallan ("URI too long"). Para una temporada de 12 personas son unas 8 consultas, e Inicio solo las corre si no tenés amigos. Evidencia: RED 6 db + 3 UI; GREEN db 77/77; typecheck limpio y unit 2249/2249, corridos por el orquestador; navegador a 390 px (Inicio con 2 filas y "Ver más gente"; Amigos con 4 filas, "Ver los 11" → 11, Agregar → Enviado, y al recargar "Ver los 10"). No se probó en el navegador Inicio con amigos (cubierto por un test unitario).
- L11 T3 hecho (1d923a5). Los pedidos recibidos van arriba de Amigos en Inicio, con y sin amigos. Al aceptar sale el aviso "Ahora sos amigo de <nombre>" con "Ver". En Amigos se rechaza con ✕ y se cancela un pedido enviado. Todas las acciones van por id de jugador: se fue el último formulario que mandaba un `friendshipId`. `torneosCompartidosCon` arranca de mis asientos y reusa las páginas y tandas de T2. `?desde=torneo` hace que el Volver del historial vuelva al perfil del torneo; `?desde=amigos` y sin parámetro siguen igual (con tests). Agregado del worker: el mismo aviso al aceptar en Amigos, para que las dos pantallas respondan igual. Evidencia: RED 6 db + 3 inicio + 2 Volver + 7 páginas; GREEN db 83/83; typecheck limpio y unit 2285/2285, corridos por el orquestador; navegador a 390 px en claro (Aceptar → aviso → Ver, ✕, Cancelar sigue al recargar, perfil → Amigos › → Volver al mismo perfil). No se probó en el navegador el oscuro ni Inicio con un pedido y sin amigos (cubierto por un test unitario). El orquestador corrigió dos comentarios que decían que `desde` solo puede ser `'amigos'`.
