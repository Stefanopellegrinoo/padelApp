#!/usr/bin/env bash
# run.sh <nombre> <racerA.sql> <racerB.sql> <N>
#
# Corre N carreras de A contra B, con el solapamiento garantizado por la
# barrera de `fixture.sql`, y cuenta:
#
#   deadlock  40P01, el ciclo que Postgres detecta y aborta
#   dup_key   23505, la escritura que se perdió sin deadlockear
#   ESTADO    iteraciones que dejaron la temporada rota (`dl.inconsistent()`)
#   sin_sync  iteraciones donde los dos corredores NO llegaron juntos a la
#             compuerta: ésas no midieron nada. Si este número no es 0, el
#             resto de la fila vale menos de lo que parece.
set -u
export PGPASSWORD=${PGPASSWORD:-postgres}
P=(psql -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-54322}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -q)
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
name=$1
A=$here/racers/$2
B=$here/racers/$3
N=$4
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
dl=0; dup=0; inc=0; bad=0

for ((i = 1; i <= N; i++)); do
  "${P[@]}" -c "select dl.reset();" >/dev/null 2>&1
  "${P[@]}" -f "$A" >"$dir/a" 2>&1 &
  pa=$!
  "${P[@]}" -f "$B" >"$dir/b" 2>&1 &
  pb=$!
  sync=$("${P[@]}" -Atc "select dl.go_when_ready(2);" 2>/dev/null)
  wait $pa
  wait $pb
  [[ "$sync" == "-1" ]] && bad=$((bad + 1))
  out=$(<"$dir/a")$'\n'$(<"$dir/b")
  [[ "$out" == *40P01* ]] && dl=$((dl + 1))
  [[ "$out" == *23505* ]] && dup=$((dup + 1))
  broken=$("${P[@]}" -Atc "select dl.inconsistent();" 2>/dev/null)
  if [[ -n "$broken" ]]; then
    inc=$((inc + 1))
    printf '%s\n' "$broken" >>"$dir/inc.log"
  fi
  printf '%s' "$out" >>"$dir/all.log"
done

printf '%-46s deadlock=%3d/%-3d dup_key=%3d ESTADO=%3d sin_sync=%d\n' \
  "$name" "$dl" "$N" "$dup" "$inc" "$bad"
# Una muestra del error real: un número sin ver qué lo produjo no sirve.
rg -o 'ERROR:.{0,74}' "$dir/all.log" 2>/dev/null | sort | uniq -c | sort -rn | head -3
[[ -f "$dir/inc.log" ]] && { echo "   estado roto:"; sort "$dir/inc.log" | uniq -c | sort -rn | head -2; }
exit 0
