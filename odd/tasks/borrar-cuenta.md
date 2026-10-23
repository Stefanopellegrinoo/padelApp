# Borrar cuenta + pasar administración + política de privacidad
Objetivo: requisitos de App Store (borrar cuenta in-app, política de privacidad) sin romper torneos ajenos.
Rama: feat/borrar-cuenta · Entrega: single-pr (3 commits) · Tests: vitest (`npm test`) + db (`npm run test:db`, Supabase local)

## Specs
- S1 Pasar la administración: en Ajustes del torneo, el admin elige otro jugador CON cuenta que juega en el torneo y pasa a ser el admin (`seasons.created_by`). Sólo el admin actual puede. Pide confirmación.
- S2 Borrar cuenta "desvinculando" (acordado: "Perfecto"): se borra la cuenta (login, mail, amistades); el jugador queda en los torneos con su nombre como jugador sin cuenta (`players.user_id = null`); tablas y resultados de los demás no cambian.
- S3 Si es admin de algún torneo, no deja borrar la cuenta y dice cuáles, hasta que pase la administración (S1) o borre el torneo.
- S4 Página `/privacidad` pública, enlazada desde el registro y el menú de cuenta.

## Tasks
- T1 S1 migración `transfer_season_admin` + UI Ajustes + tests · inline · pendiente
- T2 S2-S3 migración `delete_my_account` + pantalla de confirmación + tests · inline · pendiente
- T3 S4 página de privacidad + links · inline · pendiente

## Log
- L1 (2026-10-23) "Que más podemos hacer para que la app quede profesional e ir viendo de hacerla app de iOS" → propuesta: borrar cuenta + privacidad primero. Usuario: "Ok".
- L2 Propuesta "desvincular" (cuenta se borra, jugador queda con su nombre; si es único admin, bloquear hasta pasar admin o borrar torneo). Usuario: "Perfecto".
- L3 Mapa: cada torneo tiene un único admin (`seasons.created_by`, RESTRICT) y no existe transferir. Propuesta agregar "Pasar la administración". Usuario: "Dale".
- L4 Riesgo: item 1 (datos: borra auth.users), item 2 (permisos: RPCs SECURITY DEFINER). Engram no conectado: mirror pendiente.
