#!/usr/bin/env bash
# El gate de deadlocks del camino de escritura del plantel.
#
#   npm run test:deadlock          # N=60 por par, ~12 min
#   npm run test:deadlock -- 20    # más rápido, menos potencia
#
# Necesita la Supabase local levantada (`npm run db:start`) y `psql` en el PATH.
# Es DESTRUCTIVO igual que `npm run test:db`: crea y borra una temporada
# llamada DL-MEASURE una vez por iteración.
#
# ── Qué mide, y qué NO ──────────────────────────────────────────────────────
# Las tasas de acá NO son probabilidades de producción. La barrera de arranque
# (`fixture.sql`) garantiza que los dos statements se encimen, así que lo que
# se mide es "¿existe el ciclo, y se alcanza cuando de verdad se enciman?".
# Para calibrar cuánto amplifica: la carrera de `removeSeat` contra
# `add_squad_seat(p_before)` medía 17/240 contra PostgREST, sin barrera, y
# 60/60 acá. La barrera multiplica ~10x la chance de solaparse; no inventa el
# ciclo.
#
# Por eso las dos primeras filas son CONTROLES y no resultados:
#
#   CTRL-NEG  tiene que dar 0. Si no, la barrera o el fixture están mal y todos
#             los ceros de abajo son falsos negativos.
#   CTRL-POS  tiene que dar ~N. Es el único par del harness que se llama a
#             `shift_seeds_up` SUELTA, y no es alcanzable desde la app
#             (`ACL postgres=X/postgres`, y sus dos únicos callers —
#             `add_squad_seat` y `promote_guest` — toman el advisory antes).
#             Está para probar que el harness todavía sabe encontrar un
#             deadlock cuando hay uno.
#
# ── Historia, para el que venga a agregar un par ────────────────────────────
# Tres rondas seguidas de revisión encontraron que el arreglo de la ronda
# anterior creaba un deadlock NUEVO, cada una en un lugar invisible desde donde
# miraba la anterior: la fila de `seasons` como mutex (ronda 2) se auto-
# deadlockeaba contra el `FOR KEY SHARE` de su propia FK; el advisory que la
# reemplazó (ronda 3) quedó insertado DENTRO de otra cadena de locks en
# `promote_guest` y midió 6/6. La lección que quedó: el advisory tiene que ser
# el PRIMER lock de la transacción, y eso se verifica midiendo, no leyendo.
#
# Así que si tocás un lock: agregá el par acá y corré esto ANTES y DESPUÉS. Un
# 0 sin un CTRL-POS al lado no dice nada.
set -u
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
N=${1:-60}
export PGPASSWORD=${PGPASSWORD:-postgres}
psql -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-54322}" -U "${PGUSER:-postgres}" \
  -d "${PGDATABASE:-postgres}" -q -v ON_ERROR_STOP=1 -f "$here/fixture.sql" || exit 1

R() { "$here/run.sh" "$@" "$N"; }
echo "### N=$N por par. Solapamiento garantizado por barrera — leer el encabezado"
echo "### de battery.sh antes de interpretar cualquier número."
echo
echo "── CONTROLES ──────────────────────────────────────────────────────────────"
R "CTRL-NEG add_squad_seat || add_squad_seat" add_squad_seat.sql add_squad_seat.sql
R "CTRL-POS shift_seeds_up || remove_squad_seat" shift_seeds_up.sql remove_squad_seat.sql
echo
echo "── LOS CUATRO ESCRITORES QUE TOMAN EL ADVISORY, ENTRE SÍ ──────────────────"
R "add_squad_seat || promote_guest" add_squad_seat.sql promote_guest.sql
R "add_squad_seat || remove_squad_seat" add_squad_seat.sql remove_squad_seat.sql
R "promote_guest  || remove_squad_seat" promote_guest.sql remove_squad_seat.sql
R "remove_squad_seat || remove_squad_seat" remove_squad_seat.sql remove_squad_seat.sql
echo
echo "── CONTRA LOS ESCRITORES QUE NO TOMAN NINGÚN LOCK ─────────────────────────"
R "add_squad_seat    || add_to_discipline" add_squad_seat.sql add_to_discipline.sql
R "add_squad_seat    || remove_from_discipline" add_squad_seat.sql remove_from_discipline.sql
R "add_squad_seat    || add_discipline" add_squad_seat.sql add_discipline.sql
R "add_squad_seat    || delete_season" add_squad_seat.sql delete_season.sql
R "remove_squad_seat || add_to_discipline" remove_squad_seat.sql add_to_discipline.sql
R "remove_squad_seat || remove_from_discipline" remove_squad_seat.sql remove_from_discipline.sql
R "remove_squad_seat || add_discipline" remove_squad_seat.sql add_discipline.sql
R "remove_squad_seat || delete_season" remove_squad_seat.sql delete_season.sql
