# Rediseño de la app

Rediseño visual y de estructura de toda la app, decidido de a una decisión por vez.
Cada decisión se maqueta en `design/<slug>/`, el usuario elige y queda anotada en el Log con su motivo.

## Specs

- S1. Objetivo primero: "quiero mejorar la pagina desde lo visual. Pero para eso necsitamos entende bien cual el objetivo de la misma, que es lo que buscamos"
- S2. El objetivo de la app, en palabras del dueño (`docs/historial-entre-amigos.md:33`): "que con tus amigos puedas armar torneos fácilmente y que puedas tener un historial de todos los que jugaron." Identidad, respuesta del usuario: "torneo entre amigos e historial entre amigos".
- S3. Lo que molesta hoy (respuesta del usuario, las cuatro): "Perderse navegando", "Armar y cargar la fecha", "Crear y configurar el torneo", "Cómo se ve". Alcance: "La app entera".
- S4. Qué buscamos (propuesta aceptada con "si"):
  - Que las dos partes estén a la vista desde que abrís la app.
  - Que puedas crear un torneo sin manual y sin jerga.
  - Que la fecha se pueda armar y cargar parado en el club, con una mano.
  - Que llegues a tu historial con un amigo en dos toques.
  - Que siempre sepas dónde estás y cómo volver.
  - Que dé ganas de abrirla, con cara de "entre amigos" y no de planilla.
- S5. Método: "si pero ademas de eso quiero que vayamsos pensando bien cada diecision y el estilo de la app"
- S6. Maquetas: "me podes hacer las maqueteas, y de paso vemos el estilo, que teparec?"
- S7. Galería: "hacelo siempre en esta ip http://100.81.177.86/" → servida en `http://100.81.177.86:8091/` (el puerto 80 lo usa otra app; el usuario eligió la galería fija).

## Tasks

- [x] T0 · S1-S4 · inline · Definir el objetivo y qué buscamos.
- [x] T1 · S2-S6 · inline · Decisión 1, pantalla de entrada: elegida B (`design/inicio/02-inicio-dos-partes.html`). Commit: —
- [ ] T2 · S5-S7 · worker · Estilo: ronda 1 (01-03) sin ganador; ronda 2 (04-06) variantes de la familia de 01 en `design/estilo/`. Commit: —
- [ ] T3 · S3-S5 · inline · Decisión 2, cómo te movés (navegación de la app y del torneo).
- [ ] T4 · S3-S5 · inline · Decisión 3, flujos clave: crear torneo, la fecha en el club, historial con un amigo.
- [ ] T5 · S5 · inline · Cerrar el estilo: personalidad, color, tipografía, densidad.

## Log

- L1 (2026-11-15) Pedido original: "quiero mejorar la pagina desde lo visual. Pero para eso necsitamos entende bien cual el objetivo de la misma, que es lo que buscamos"
- L2 Respuestas: identidad "torneo entre amigos e historial entre amigos"; molesta todo (navegación, fecha, crear torneo, cómo se ve); alcance "La app entera". A la pregunta "¿para quién diseñamos primero?" el usuario respondió "para un poco, que te dije en el mensjaje????": el objetivo ya estaba dicho (S2), no inventar dicotomías de usuarios.
- L3 Evidencia: a Amigos solo se llega desde el menú del círculo de Mis torneos (`app/torneos/cuenta.tsx:68`), al lado de Privacidad.
- L4 "si pero ademas de eso quiero que vayamsos pensando bien cada diecision y el estilo de la app". Orden propuesto: entrada, navegación, flujos clave, estilo.
- L5 Decisión 1 planteada (A: Mis torneos + Amigos abajo; B: Inicio con las dos partes; C: pestañas Torneos/Amigos). Recomendación: B. El usuario pidió maquetas: "me podes hacer las maqueteas, y de paso vemos el estilo, que teparec?"
- L6 Sistema actual sincronizado en `design/system.md` y `design/system.html` (fuente `app/globals.css`). Maquetas: `design/inicio/` con 01-mis-torneos-mas-amigos (A), 02-inicio-dos-partes (B), 03-pestanas-torneos-amigos (C), en el estilo actual para comparar solo estructura. `design/estilo/` con 01-cancha, 02-noche-de-club, 03-grupo-de-amigos, las tres sobre la estructura B y apartándose a propósito del sistema actual.
- L7 "hacelo siempre en esta ip http://100.81.177.86/". Galería fija `scripts/design-gallery.mjs` en el puerto 8091 de esa IP (opción elegida por el usuario).
- L8 "el B me gusto, pero ningun diseño me gusto, el mas cerca es mas tirando el 1, peo tampoco mme mato, los otros 2 horribles". Decisión 1 = B. Estilo: 2 (oscuro, color pelota) y 3 (crema, colores por amigo) descartados; 1 (evolución del verde actual) es lo más cercano pero no convence. Ronda 2: tres variantes claras dentro de esa familia, que difieren en un eje cada una (mínimo, enérgico, pulido).
- L9 Ronda 2 escrita por un worker: `design/estilo/04-limpio.html`, `05-energico.html` (azul cancha #0b4fd1), `06-pulido.html`; manifiesto con 01-06. Contraste AA verificado por el worker; alturas estimadas sin navegador.
- L10 "ninguno, podes usar todas las skills de diseño que tnees para hacerlo lo mejor posoble, como un equipo porfesional de diseño, y que no parezca ia". Diagnóstico: rondas 1-2 tenían los rasgos típicos de IA (skill frontend-design) y se renderizaban con fuente genérica (Archivo no instalada). Ronda 3: brief `design/brief-direcciones.md` con tres direcciones (Superficie/lugar, Marcador/resultado, Álbum/gente), tres pantallas cada una (inicio, tabla, fecha), fuentes incrustadas, capturas con Chromium headless en `/tmp/gdesign` y autocrítica. Tres workers en paralelo: `design/dir-superficie/`, `design/dir-marcador/`, `design/dir-album/`.
- L11 Dos pasadas de crítica de dirección de arte sobre capturas. Correcciones: "Faltan 4 partidos" (el brief decía 3, error de cuenta); Marcador: celdas oscuras solo para el Masters; Superficie: sin "Vas 3°" repetido y partido sin cargar compacto; Álbum: figurita real con franja de nombre en dos tamaños, figuritas solo para los 4 del Masters. Las tres publicadas en la galería; falta que el usuario elija.
- L12 "no me gusta el diseño todavia, usa las skills mejorala". A la pregunta de qué molesta: "muy hecho por ia". Diagnóstico en `design/brief-ronda-4.md`: narra en vez de mostrar, layout de página web con saludo y secciones, sin íconos ni elementos de app, ritmo parejo, metáforas dibujadas literal. Ronda 4: una sola dirección con terminación de app real de iOS en `design/app-real/` (worker).
- L13 Ronda 4 entregada: `design/app-real/01-inicio`, `02-tabla`, `03-fecha` (Hanken Grotesk, chrome iOS, pádel #0b5cd5, FIFA #1a7a3a, tabla de 44 px, carga en hoja). Revisada por el director de arte sobre capturas; publicada en la galería. Falta el veredicto del usuario.
- L14 Veredicto ronda 4: "no horrible". Sin dato concreto tras cuatro rondas; el usuario eligió un test de gusto visual. `design/gusto/01-test.html`: el mismo contenido en 14 estilos distintos (generado con `/tmp/gdesign/gusto/build.mjs`) para que marque cuáles le gustan y cuáles no.
- L15 "Dejo de funcionar el link": el reinicio del 18/11 mató la galería; ahora es el servicio de usuario `padel-design-gallery` (systemd, arranca solo).
- L16 Test de gusto: "no me gusto ninguno, usa las skills dee diseñooo". Skills nuevas aplicadas: ui-ux-pro-max (base de estilos: para deportes recomienda "Vibrant & Block-based" + "Motion-Driven"), emil-design-eng (terminación e interacción), design-critique. Ronda 5 (`design/brief-ronda-5.md`): prototipo navegable que se toca, en `design/prototipo/` (worker).
- L17 Ronda 5 entregada: `design/prototipo/index.html`, navegable (Inicio, Torneo con Tabla/Fechas/Stats/Reglas, Fecha 8 con hoja de carga en dos toques y Deshacer, Nico). Azul cancha #1F45E0, FIFA #0B7A3B, amarillo pelota #DFFF4F solo para "vos", Archivo con eje de ancho. Test Playwright: "Faltan 4 partidos" pasa a "Faltan 3 partidos" sin errores de JS. Revisado por el director de arte; falta el veredicto del usuario.
- L18 "y como se ve el modo oscuro". El prototipo no tenía tema oscuro. Encargado (worker): oscuro diseñado (no invertido) que sigue al sistema y se fuerza con `?tema=oscuro`; amarillo solo para "vos" para no caer en el negro con lima que el usuario rechazó en la ronda 1.
- L19 Modo oscuro entregado: fondo azul marino #0E1630 con superficies #141E3D/#1B2750, bloque cancha #2643BC, azul de texto #8DA4FF, FIFA #6CD49A; "vos" en oscuro = fila elevada con borde amarillo. Sigue al sistema, se fuerza con `?tema=oscuro|claro` sin parpadeo. Galería: `design/prototipo/06-09` en oscuro. En claro, "Deshacer" y el destello de guardado pasaron de amarillo a azul suave (no son "vos"). Tests de carga, navegación y tema verdes en los dos temas.
