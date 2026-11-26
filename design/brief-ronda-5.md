# Brief ronda 5 · prototipo que se toca

Spec: `odd/tasks/rediseno-app.md` (S2-S7 y el Log). Contenido: el de `design/brief-direcciones.md` ("Las tres pantallas", con "Faltan 4 partidos"), más la pantalla de un amigo.

## Feedback acumulado

- Ronda 4 (`design/app-real/`, iOS gris agrupado): "no horrible".
- Test de gusto (`design/gusto/`, 14 estilos): "no me gusto ninguno, usa las skills dee diseñooo".
- Ronda 3: "muy hecho por ia".

## Qué cambia en esta ronda

Todas las rondas anteriores fueron imágenes quietas. Esta ronda es **un prototipo navegable en un solo archivo**: se abre en el celular, se toca y responde como una app.

Skills a seguir, en este orden. Leelas antes de diseñar.

1. `/home/stefano/.claude/plugins/marketplaces/ui-ux-pro-max-skill/.claude/skills/ui-ux-pro-max/SKILL.md`.
   - Para este producto (deportes, club, social), su base recomienda el estilo **"Vibrant & Block-based"** con **"Motion-Driven"**: bloques de color con decisión, tipografía grande, contraste alto y movimiento con sentido.
   - Usá su CLI para afinar:
     - `python3 scripts/search.py "<consulta>" --domain style|color|typography|ux`
     - El directorio de la skill es `/home/stefano/.claude/plugins/marketplaces/ui-ux-pro-max-skill/.claude/skills/ui-ux-pro-max`.
   - Su checklist de "Common Rules for Professional UI" es obligatorio.
2. `/home/stefano/.agents/skills/emil-design-eng/SKILL.md` completo. La terminación sale de acá:
   - `:active` con `scale(.97)`.
   - La hoja sube con la curva `cubic-bezier(0.32,0.72,0,1)`.
   - Nada aparece desde `scale(0)`.
   - Las animaciones duran menos de 300 ms, sin `transition: all`, y respetan `prefers-reduced-motion`.
3. `/home/stefano/.claude/plugins/cache/claude-plugins-official/frontend-design/1.1.1/skills/frontend-design/SKILL.md`, para evitar los defaults de IA.
4. `/home/stefano/.claude/plugins/synced/210ac0a3-5fcb-41ca-a870-419fb3d4ccfb_bf555f57-d565-43b0-ad72-97d63a20bcb7/design/skills/design-critique/SKILL.md`, para tu autocrítica sobre capturas.

## Dirección visual

- **Claro, con bloques de color de verdad.** No grises de iOS ni papel. Cada deporte tiene un color propio y saturado:
  - Pádel: azul eléctrico o azul cancha.
  - FIFA: verde.
  - El color se usa en bloques grandes con decisión, no solo como acento de texto.
- **Una tipografía deportiva con carácter.** La base de la skill recomienda Barlow Condensed para títulos y Barlow para texto, pero ya se usó en la ronda 3. Probá otra de las de `/tmp/gdesign/node_modules`; si instalás una nueva, que sea con `npm i @fontsource/<x>` en `/tmp/gdesign`. Justificá la elección con una captura comparativa.
- **Números grandes donde importan:** tu puesto, el marcador y el historial con un amigo.
- **Prohibido:** la estética gris agrupada tipo Ajustes de iOS, oraciones que narran, saludo, etiquetas en MAYÚSCULAS decorativas, "·", "→" y emojis.

## Prototipo

Archivo: `design/prototipo/index.html`. Mide 390 px de ancho y se ve a pantalla completa en el celular.

Pantallas navegables con transición entre ellas:

1. **Inicio:** la próxima fecha, tus torneos, tus amigos y "Cargar partido".
2. **Torneo:** pestañas Tabla, Fechas y Stats, con barra inferior.
   - Tabla real, con los 12.
   - Fechas mínima: lista de fechas con su estado.
   - Stats puede ser un placeholder visual simple, pero sin lorem.
3. **La fecha 8:** rondas y partidos.
   - Tocar un partido sin cargar abre la hoja de carga.
   - Tocar la pareja ganadora y después los games del perdedor guarda el partido: la hoja baja, el partido aparece cargado y el contador de "Faltan N partidos" baja.
4. **Amigo (Nico):** historial 7 a 5, últimos partidos y "Cargar partido".

Además:
- "Volver" funciona en todas las pantallas.
- Hay feedback al tocar en todo lo tocable.
- Barra de estado dibujada solo si no se ve en pantalla completa: usá `@media (display-mode: standalone)` o simplemente no la dibujes.
- Es un único archivo autocontenido con fuentes en base64 (`node /tmp/gdesign/font.mjs`), sin URLs, en JS vanilla.

También: capturas estáticas de cada pantalla para la galería, en `design/prototipo/0N-<pantalla>.html`. Cada una es una copia que abre `index.html` en ese estado con `index.html#inicio`, `#tabla`, `#fecha`, `#hoja` y `#amigo`. El `design.json` apunta a esas, de 390x844.

## Proceso

1. Plan de tokens con las búsquedas de la skill.
2. Construir.
3. Por cada pantalla y estado: captura con `PLAYWRIGHT_BROWSERS_PATH=/tmp/gdesign/browsers node /tmp/gdesign/shot.mjs <archivo|url> <png> 390 844`, después crítica con el formato de design-critique, después corrección. Al menos tres pasadas.
4. Probá la interacción con Playwright: cargar un resultado en la hoja y verificar que el contador baja.
