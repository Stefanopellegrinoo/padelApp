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

## Tasks

- [ ] T1 · S1, S2, S6 · worker (backstop) · A: chip en el perfil del torneo (Agregar / Enviado + Deshacer / tarjeta "te pidió" con Aceptar y ✕ / Amigos ›) y borrar amistad en `db/friends.ts`. Commit: —
- [ ] T2 · S1, S3, S6 · worker (backstop) · B: lectura "gente de tus torneos" (fechas juntos, torneos compartidos), sección en Amigos con "Ver los N", Inicio sin amigos. Commit: —
- [ ] T3 · S1, S4 · worker (backstop) · C: pedidos en Inicio con aviso al aceptar, rechazar y cancelar en Amigos, "de dónde lo conocés" y "hace N días". Commit: —
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
