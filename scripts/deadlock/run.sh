#!/usr/bin/env bash
# run.sh <nombre> <racerA.sql> <racerB.sql> <N> <cero|positivo>
#
# Corre N carreras de A contra B, con el solapamiento garantizado por la
# barrera de `fixture.sql`, y cuenta:
#
#   deadlock  40P01, el ciclo que Postgres detecta y aborta
#   dup_key   23505, la escritura que se perdió sin deadlockear
#   otros     iteraciones que terminaron con CUALQUIER otro error. FALLA el
#             gate: una iteración que murió antes de contender no midió el
#             orden de locks, y se lee idéntica a una que midió limpio. Los dos
#             pares cuyo resultado esperado era un error (`delete_season`
#             volteando el alta concurrente, y `add_discipline` contra una baja)
#             se borraron de la batería en vez de excepcionarse: un par que
#             nunca llega a contender no aporta información sobre deadlocks.
#   ESTADO    iteraciones que dejaron la temporada rota (`dl.inconsistent()`)
#   sin_sync  iteraciones donde los dos corredores NO llegaron juntos a la
#             compuerta. Cualquier valor distinto de 2 cuenta: un 3 o un 4
#             significa que había llegadas viejas y la compuerta se abrió antes
#             de que los de esta iteración estuvieran adentro.
#
# El último argumento es lo que se ESPERA, y es lo que convierte a esto en un
# gate en vez de un reporte: `cero` exige `deadlock == 0`; `positivo` exige
# `deadlock >= N/2` y no `> 0` — un control positivo que pasa con 1 de 60 no
# prueba que el instrumento sirva, prueba que tuvo suerte una vez.
#
# Sale ≠ 0 si la expectativa falla, si alguna iteración no sincronizó, si alguna
# dejó la base inconsistente, o si alguna terminó con un error que no era ni el
# deadlock ni el choque de unique que el par viene a medir.
set -u
export PGPASSWORD=${PGPASSWORD:-postgres}
P=(psql -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-54322}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -q)
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
name=$1
A=$here/racers/$2
B=$here/racers/$3
N=$4
esperado=$5
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
dl=0; dup=0; otros=0; inc=0; bad=0

for ((i = 1; i <= N; i++)); do
  # Un `dl.reset()` que falla callado envenena TODO lo que sigue: es lo único
  # que vacía `dl.arrived` y cierra la compuerta, así que sin él los dos
  # `gate_wait()` vuelven al instante (compuerta abierta de la vuelta anterior)
  # y `go_when_ready` cuenta las llegadas viejas — cero solapamiento,
  # `sin_sync=0`, fila verde. Se aborta la tanda entera: una medición sobre un
  # fixture que no se sabe en qué estado está no vale nada.
  if ! "${P[@]}" -v ON_ERROR_STOP=1 -c "select dl.reset();" >"$dir/reset" 2>&1; then
    printf '%-46s RESET FALLÓ en la iteración %d — tanda abortada\n' "$name" "$i"
    tail -3 "$dir/reset"
    exit 2
  fi
  "${P[@]}" -f "$A" >"$dir/a" 2>&1 &
  pa=$!
  "${P[@]}" -f "$B" >"$dir/b" 2>&1 &
  pb=$!
  sync=$("${P[@]}" -Atc "select dl.go_when_ready(2);" 2>/dev/null)
  wait $pa
  wait $pb
  # `!= 2` y no `== -1`: un 3 o un 4 es tan malo como un -1, y si el psql del
  # controlador falla, `sync` es la cadena vacía y tampoco es 2.
  [[ "$sync" != "2" ]] && bad=$((bad + 1))
  out=$(<"$dir/a")$'\n'$(<"$dir/b")
  [[ "$out" == *40P01* ]] && dl=$((dl + 1))
  [[ "$out" == *23505* ]] && dup=$((dup + 1))
  if [[ "$out" == *ERROR:* && "$out" != *40P01* && "$out" != *23505* ]]; then
    otros=$((otros + 1))
  fi
  broken=$("${P[@]}" -Atc "select dl.inconsistent();" 2>/dev/null)
  if [[ -n "$broken" ]]; then
    inc=$((inc + 1))
    printf '%s\n' "$broken" >>"$dir/inc.log"
  fi
  printf '%s' "$out" >>"$dir/all.log"
done

fail=0
case $esperado in
  cero)     [[ $dl -ne 0 ]] && fail=1 ;;
  # `>= N/2`, no `> 0`: ver el encabezado.
  positivo) [[ $dl -lt $(( (N + 1) / 2 )) ]] && fail=1 ;;
  *) echo "esperado inválido: $esperado (usá cero|positivo)"; exit 2 ;;
esac
[[ $bad -ne 0 ]] && fail=1
# ESTADO y otros TAMBIÉN gatean. Sin esto, una corrida que corrompía
# `season_seed_order` en el 100% de las iteraciones salía con exit 0 — en la
# única columna que detecta corrupción de datos, que es la señal más fuerte de
# la tabla.
[[ $inc -ne 0 ]] && fail=1
[[ $otros -ne 0 ]] && fail=1

printf '%-46s deadlock=%3d/%-3d dup_key=%3d otros=%3d ESTADO=%3d sin_sync=%d%s\n' \
  "$name" "$dl" "$N" "$dup" "$otros" "$inc" "$bad" "$([[ $fail -ne 0 ]] && echo '   ← FALLA')"
# Una muestra del error real: un número sin ver qué lo produjo no sirve.
rg -o 'ERROR:.{0,74}' "$dir/all.log" 2>/dev/null | sort | uniq -c | sort -rn | head -3
[[ -f "$dir/inc.log" ]] && { echo "   estado roto:"; sort "$dir/inc.log" | uniq -c | sort -rn | head -2; }
exit $fail
