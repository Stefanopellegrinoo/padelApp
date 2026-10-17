#!/usr/bin/env bash
# El gate de deadlocks del camino de escritura del plantel.
#
#   npm run test:deadlock          # N=60 por par, 3m44s medidos
#   npm run test:deadlock -- 20    # más rápido, menos potencia
#
# Necesita la Supabase local levantada (`npm run db:start`) y `psql` en el PATH.
# Es DESTRUCTIVO: crea y borra una temporada llamada DL-MEASURE una vez por
# iteración.
#
# ── Esto GATEA: sale ≠ 0 ────────────────────────────────────────────────────
# Cada par declara qué espera (`cero` o `positivo`) y la tanda sale ≠ 0 si no se
# cumple, si alguna iteración no sincronizó, si alguna dejó la base inconsistente
# o si alguna murió con un error que el par no venía a medir.
#
# **NO está cableado a CI.** `ci.yml` corre `typecheck`, `npm test`, `build` y
# `test:db`; esto no. Se corre a mano, y es lo que uno corre cuando toca un lock.
# Que salga ≠ 0 sirve igual: hace que un `&&` en una cadena de comandos corte, y
# deja la puerta abierta a cablearlo sin tener que arreglarlo primero. (Ojo si
# se cablea: `run.sh` usa `rg`, que no viene en un runner de GitHub pelado.)
#
# ── Qué mide, y qué NO ──────────────────────────────────────────────────────
# Las tasas de acá NO son probabilidades de producción. La barrera de arranque
# (`fixture.sql`) garantiza que los dos statements se encimen, así que lo que se
# mide es "¿existe el ciclo, y se alcanza cuando de verdad se enciman?".
#
# Cuánto amplifica, medido sobre las dos carreras que se midieron de las dos
# formas: 17/240 → 60/60 contra `add_squad_seat(p_before)` (14x) y 30/200 →
# 60/60 contra `shift_seeds_up` (6,7x). La barrera sube la probabilidad de
# solaparse; no inventa el ciclo.
#
# ── Los controles, y cuál sirve para qué ────────────────────────────────────
#   CTRL-NEG  tiene que dar 0. Si da ≠ 0, el advisory entre dos altas está roto
#             — es un bug del código, no del instrumento. Ojo: este control NO
#             puede detectar una barrera descalibrada, porque una barrera rota
#             también da 0, que es su valor esperado.
#   CTRL-POS  tienen que dar ≥ N/2. ÉSTOS son los que detectan el instrumento
#             descalibrado: si la barrera deja de encimar los statements, acá se
#             ve. Son los dos únicos pares que llaman a un corrimiento de cola
#             SUELTO, y ninguno es alcanzable desde la app (ACL
#             `postgres=X/postgres`; sus dos callers toman el advisory antes).
#             Están para probar que el harness todavía sabe encontrar un
#             deadlock cuando hay uno.
#
# ── Por qué faltan pares que antes estaban ──────────────────────────────────
# Se borraron TRES: los dos de `delete_season` y `remove_squad_seat ‖
# add_discipline`. En `add_squad_seat ‖ delete_season` y en `remove_squad_seat ‖
# add_discipline`, medido, las 60 iteraciones morían con un 23503 ANTES de que
# las dos transacciones llegaran a contender (la temporada o el asiento
# desaparecían abajo), así que su `deadlock=0` no significaba "no hay ciclo",
# significaba "no se midió". `remove_squad_seat ‖ delete_season` daba `otros=0`
# en las corridas cortas, pero por suerte: depende de quién gane, y cuando gana
# el `delete_season` la baja rebota con "Ese asiento no existe". Los tres tienen
# el mismo defecto — no pueden distinguir "no hay ciclo" de "no llegaron a
# contender" — y con `otros` gateando habrían fallado de forma intermitente.
#
# Lo que sigue faltando, y es deuda escrita: ningún par contra escritores de
# FECHA (`close_matchday`, `reopen_matchday`, `cancel_matchday`,
# `removeGuest`...). El deadlock 6/6 de la ronda 3 fue `promote_guest ‖
# close_matchday` (ver 0084), así que el harness NO cubre el par que definió la
# clase de bug que existe para prevenir. Se razonó leyendo —0084 dejó el
# advisory antes del `for update` de `matchdays`, así que `promote_guest` no
# puede sostener esa fila mientras espera— y eso es exactamente lo que este
# archivo dice que no alcanza.
#
# ── Historia, para el que venga a agregar un par ────────────────────────────
# Tres rondas seguidas de revisión encontraron que el arreglo de la ronda
# anterior creaba un deadlock NUEVO: la fila de `seasons` como mutex (ronda 2)
# se auto-deadlockeaba contra el `FOR KEY SHARE` de su propia FK; el advisory
# que la reemplazó (ronda 3) quedó insertado DENTRO de otra cadena de locks en
# `promote_guest` y midió 6/6. La lección: el advisory tiene que ser el PRIMER
# lock de la transacción, y eso se verifica midiendo, no leyendo.
#
# Si tocás un lock: agregá el par acá y corré esto ANTES y DESPUÉS. Un 0 sin un
# CTRL-POS al lado no dice nada.
set -u
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
N=${1:-60}
export PGPASSWORD=${PGPASSWORD:-postgres}

# Exclusión mutua. `dl.state`, `dl.gate` y `dl.arrived` son singletons: dos
# tandas a la vez se envenenan en las dos direcciones —una vio un falso ROJO de
# la otra durante la revisión, y el falso VERDE también es posible (el reset
# ajeno borra la temporada antes de que los corredores contiendan).
# ponytail: flock protege de dos tandas en la MISMA máquina, que es el caso real
# (dos personas en el mismo equipo). Dos máquinas contra la misma base siguen
# pudiendo chocar; el día que eso pase, un `pg_advisory_lock` sostenido por una
# sesión de fondo lo cierra.
exec 9>"${TMPDIR:-/tmp}/padelapp-deadlock-gate.lock"
if ! flock -n 9; then
  echo "FALLA: ya hay otra tanda del gate corriendo en esta máquina."
  echo "Dos tandas comparten dl.state/dl.gate/dl.arrived y se envenenan."
  exit 1
fi

psql -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-54322}" -U "${PGUSER:-postgres}" \
  -d "${PGDATABASE:-postgres}" -q -v ON_ERROR_STOP=1 -f "$here/fixture.sql" || exit 1

fail=0
R() { "$here/run.sh" "$1" "$2" "$3" "$N" "$4" || fail=$((fail + 1)); }
echo "### N=$N por par. Solapamiento garantizado por barrera — leer el encabezado"
echo "### de battery.sh antes de interpretar cualquier número."
echo
echo "── CONTROLES ──────────────────────────────────────────────────────────────"
R "CTRL-NEG add_squad_seat || add_squad_seat" add_squad_seat.sql add_squad_seat.sql cero
R "CTRL-POS shift_seeds_up || remove_squad_seat" shift_seeds_up.sql remove_squad_seat.sql positivo
R "CTRL-POS shift_season_seeds_up || remove_squad_seat" shift_season_seeds_up.sql remove_squad_seat.sql positivo
echo
# Son TRES, no cuatro: `add_squad_seat`, `promote_guest` y `remove_squad_seat`.
# `claim_seat` es el otro escritor de `entries` grantado a `authenticated` y NO
# toma ningún advisory (verificado contra `pg_proc.prosrc`). No está en esta
# sección porque no pertenece, y no está en la de abajo porque nadie lo midió
# todavía: queda como par pendiente.
echo "── LOS TRES ESCRITORES QUE TOMAN EL ADVISORY, ENTRE SÍ ────────────────────"
R "add_squad_seat || promote_guest" add_squad_seat.sql promote_guest.sql cero
R "add_squad_seat || remove_squad_seat" add_squad_seat.sql remove_squad_seat.sql cero
R "promote_guest  || remove_squad_seat" promote_guest.sql remove_squad_seat.sql cero
R "remove_squad_seat || remove_squad_seat" remove_squad_seat.sql remove_squad_seat.sql cero
echo
echo "── CONTRA LOS ESCRITORES QUE NO TOMAN NINGÚN LOCK ─────────────────────────"
R "add_squad_seat    || add_to_discipline" add_squad_seat.sql add_to_discipline.sql cero
R "add_squad_seat    || remove_from_discipline" add_squad_seat.sql remove_from_discipline.sql cero
R "add_squad_seat    || add_discipline" add_squad_seat.sql add_discipline.sql cero
R "remove_squad_seat || add_to_discipline" remove_squad_seat.sql add_to_discipline.sql cero
R "remove_squad_seat || remove_from_discipline" remove_squad_seat.sql remove_from_discipline.sql cero

echo
if [[ $fail -ne 0 ]]; then
  echo "FALLA: $fail par(es) no dieron lo esperado. Un CTRL-POS en rojo invalida"
  echo "TODOS los ceros de abajo — mirá el encabezado antes de creerle a ninguno."
  exit 1
fi
echo "OK: todos los pares dieron lo esperado, controles incluidos."
