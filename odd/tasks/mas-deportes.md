# Más deportes

Suma tenis, fútbol tenis, ajedrez, bowling, pool y beer pong a los torneos y al torneo rápido.
Ajedrez trae una forma nueva de anotar (gana/pierde/tablas) y bowling una fecha tipo ranking (cada uno carga sus pinos).

## Specs

- S1. Pedido textual: "quiero agregar mas deportes, para los torneos y los torneos rapidos. como tenis, futbol tenis, ajedrez, bowling, pool, beerpong."
- S2. Valores iniciales aprobados (respuesta "Sí, así están bien"):
  - Tenis: 1 set a 6 con tie-break.
  - Fútbol tenis: 1 set a 15, ganando por 2.
  - Pool: a 3 bolas.
  - Beer pong: a 10 vasos, individual o en parejas.

  Se cambian por torneo en "Personalizar reglas".
- S3. Ajedrez, respuesta elegida: "Gana, pierde o tablas (recomendado)": un solo toque para ganó uno, ganó el otro o tablas. La tabla cuenta victorias y empates.
- S4. Bowling, respuesta textual: "no seria solo poner el total final que hizo cada uno, entonces el q mas hizo gano y para abajo". Empates, respuesta elegida: "Comparten el puesto y los puntos (recomendado)". Por ejemplo, dos con 180 quedan los dos 2° y se llevan los puntos del 2°, y el siguiente queda 4°.
- S5. Colores, respuesta elegida: "Un color por deporte (recomendado)": cada deporte con su color y su ícono, con buen contraste en claro y oscuro.
- S6. Set real, respuesta textual: "como el recomendado, airve para padel. asi es en la vida real". Se gana 6-0 a 6-4, o 7-5, y si llegan a 6-6 va tie-break y queda 7-6. Vale para tenis y para pádel. Con otro número de games la regla es la misma: a N con ventaja de 2, y tie-break en N-N que queda N+1 a N.

## Decisiones del orquestador (para que el usuario corrija si no le cierran)

- La regla de S6 es una opción del formato del partido. Los torneos ya creados conservan la regla con la que se armaron, porque un 4-3 ya cargado no puede volverse inválido. Los nuevos de tenis y de pádel nacen con la regla real. El organizador la cambia en "Personalizar reglas".
- Bowling se juega individual: no hay parejas en una fecha de pinos.
- Los deportes nuevos también aparecen en los partidos con amigos, porque salen del mismo registro. En partidos con amigos, el bowling se carga como un mano a mano por pinos.

## Tasks

- [ ] T1 · S1, S2, S5, S6 · worker · Registro (tenis, fútbol tenis, pool, beer pong), regla real del set (núcleo, validación, máquina de dos toques, personalizar reglas, texto de reglas), color e ícono por deporte, partidos con amigos y torneo rápido (incluida la carga con ventaja, por ejemplo 16-14). Commit: —
- [ ] T2 · S1, S3 · worker · Ajedrez: familia "resultado" (1-0 / 0-1 / 0-0 guardados como un set), carga de un toque en la fecha, en partidos con amigos y en el torneo rápido; estadísticas sin "games". Commit: —
- [ ] T3 · S1, S4 · worker (worktree) · Bowling: fecha tipo ranking (tabla nueva de pinos con RLS, `close_matchday`, puestos y puntos compartidos), carga de pinos, tabla del día, torneo rápido en modo ranking. Riesgo alto: migración y función `security definer`. Commit: —
- [ ] T4 · S1-S6 · verify · Verificación independiente (bowling por el riesgo) y recorrido en el navegador de los seis deportes en torneo, rápido y con amigos. Commit: —

## Log

- L1 (2026-11-25) Pedido: "quiero agregar mas deportes, para los torneos y los torneos rapidos. como tenis, futbol tenis, ajedrez, bowling, pool, beerpong."
- L2 Relevamiento (gentle-ai-explore):
  - Los deportes son datos en `core/sports.ts`. La base acepta cualquier id desde la 0094, para torneos, y la 0093, para partidos casuales.
  - Las familias de anotación hoy son `sets` y `goals`. Color e ícono no son datos: se definen en `app/globals.css` (`data-deporte`) y en `app/torneos/inicio/iconos.tsx`.
  - Torneo rápido: `app/rapido/rapido-state.ts` (`DEPORTES`, `DEPORTE_OBJETIVO`). Hoy no permite cargar con ventaja (12-10).
  - Ajedrez entra guardando un set 1-0, 0-1 o 0-0 con empates permitidos.
  - Bowling necesita una tabla nueva de pinos por jugador, ensanchar los checks de `formato` y cambiar `close_matchday`, que hoy exige partidos.
  - Tests que fijan la lista de deportes: `core/sports.test.ts`, `app/amigos/[playerId]/cargar.unit.test.ts:517`, `app/rapido/rapido-state.unit.test.ts:48`.
- L3 Rama `feat/mas-deportes` desde `main` local, que tiene el rediseño sin publicar.
