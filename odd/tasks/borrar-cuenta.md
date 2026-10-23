# Borrar cuenta + pasar administración + política de privacidad
Objetivo: requisitos de App Store (borrar cuenta in-app, política de privacidad) sin romper torneos ajenos.
Rama: feat/borrar-cuenta · Entrega: single-pr (3 commits) · Tests: vitest (`npm test`) + db (`npm run test:db`, Supabase local)

## Specs
- S1 Pasar la administración: en Ajustes del torneo, el admin elige otro jugador CON cuenta que juega en el torneo y pasa a ser el admin (`seasons.created_by`). Sólo el admin actual puede. Pide confirmación.
- S2 Borrar cuenta "desvinculando" (acordado: "Perfecto"): se borra la cuenta (login, mail, amistades); el jugador queda en los torneos con su nombre como jugador sin cuenta (`players.user_id = null`); tablas y resultados de los demás no cambian.
- S3 Si es admin de algún torneo, no deja borrar la cuenta y dice cuáles, hasta que pase la administración (S1) o borre el torneo.
- S4 Página `/privacidad` pública, enlazada desde el registro y el menú de cuenta.

## Tasks
- T1 S1 migración `transfer_season_admin` (0107) + UI Ajustes + tests · inline · hecho c2e6e30
- T2 S2-S3 migración `delete_my_account` (0108) + pantalla de confirmación + tests · inline · hecho 0ee7143
- T3 S4 página de privacidad + links · inline · hecho 662dc8f

## Log
- L1 (2026-10-23) "Que más podemos hacer para que la app quede profesional e ir viendo de hacerla app de iOS" → propuesta: borrar cuenta + privacidad primero. Usuario: "Ok".
- L2 Propuesta "desvincular" (cuenta se borra, jugador queda con su nombre; si es único admin, bloquear hasta pasar admin o borrar torneo). Usuario: "Perfecto".
- L3 Mapa: cada torneo tiene un único admin (`seasons.created_by`, RESTRICT) y no existe transferir. Propuesta agregar "Pasar la administración". Usuario: "Dale".
- L4 Riesgo: item 1 (datos: borra auth.users), item 2 (permisos: RPCs SECURITY DEFINER). Engram no conectado: mirror pendiente.
- L5 Evidencia: RED (funciones inexistentes) → GREEN 8/8 `db/account.db.test.ts`; suites 1638 unit + 693 db; build OK; E2E Chromium local: borrar sin torneos → `/` y login inválido; organizador → "Organizás Liga E2E Jueves…" sin borrar.
- L6 Verificador independiente: S1-S4 pass, sin bloqueos. Advertencias: asiento de cuenta borrada sigue en la lista "Organiza" (elegirlo da "no tiene cuenta"); `?error=` se muestra como texto (patrón previo).
- L7 Pendiente: aplicar 0107/0108 en producción (la CI no migra) ANTES de mergear; mail de contacto para la política (pedido al usuario).
