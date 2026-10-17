#!/usr/bin/env bash
# Corte a producción: aplica las migraciones pendientes sobre prod con backup,
# chequeos antes y después, y una sola confirmación antes de lo irreversible.
# Es el guion de docs/despliegue.md ("El corte a producción") hecho script: si
# algo no da, frena, deshace lo que se puede deshacer y dice qué hacer.
#
#   bash scripts/corte-prod/corte.sh
#
# Para ensayarlo contra una copia LOCAL de prod (nunca contra prod):
#   CORTE_DB_URL='postgresql://postgres:postgres@127.0.0.1:<puerto>/postgres?sslmode=disable' \
#   CORTE_BACKUP_DIR=<carpeta vacía> bash scripts/corte-prod/corte.sh
set -Eeuo pipefail
cd "$(dirname "$0")/../.."

SB=./node_modules/.bin/supabase
# Lo que prod tiene registrado hoy (medido el 17/10/2026). Son timestamps porque
# se aplicaron desde el dashboard; corresponden a 0001..0014 y 0089.
PROD_TS=(20260811191556 20260811191630 20260811191646 20260811191704 20260811191738
         20260811191747 20260811191812 20260811191827 20260811192144 20260811193416
         20260813214453 20260816144332 20260816144347 20260816144415 20260911214125)
YA_APLICADAS=(0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013 0014 0089)

etapa=inicio   # hasta dónde llegó: decide qué se deshace si algo falla
B=''
DB=''

paso()   { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
ok()     { printf '   ✓ %s\n' "$*"; }
frenar() { printf '\n\033[31mFRENO: %s\033[0m\n' "$*" >&2; exit 1; }
# Ningún comando lee la terminal: así no se comen lo que se escribe en los `read`.
sb() { "$SB" "$@" </dev/null; }
q()  { psql -X -v ON_ERROR_STOP=1 "$DB" "$@" </dev/null; }
historial() { q -Atc "select coalesce(string_agg(version, ' ' order by version), '') from supabase_migrations.schema_migrations"; }

restaurar_historial() {
  echo "Devolviendo el historial de migraciones a como estaba..."
  if test -s "$B/schema_migrations.tsv" && q --single-transaction \
       -c 'delete from supabase_migrations.schema_migrations' \
       -c "\\copy supabase_migrations.schema_migrations from '$B/schema_migrations.tsv'"; then
    ok "historial restaurado"
  else
    echo "   ✗ NO pude restaurar el historial. La copia está en $B/schema_migrations.tsv."
    echo "     No hagas nada más y mandame este mensaje."
  fi
}

borrar_audit() {
  if q -qc 'drop schema if exists audit_pre cascade'; then ok "borré la foto audit_pre"
  else echo "   ✗ no pude borrar audit_pre (no es grave: drop schema audit_pre cascade)"; fi
}

al_salir() {
  local code=$?
  [ "$code" -eq 0 ] && return
  set +e
  echo
  case "$etapa" in
    inicio)
      echo "No se tocó nada en la base." ;;
    pre_ok)
      borrar_audit
      echo "No se aplicó ninguna migración: prod quedó como estaba." ;;
    historial)
      restaurar_historial; borrar_audit
      echo "No se aplicó ninguna migración: prod quedó como estaba." ;;
    push)
      echo "El push falló a mitad de camino. NO mergees y que nadie use la app."
      echo "Quedaron aplicadas las migraciones anteriores a la que falló. No reintentes:"
      echo "mandame $B/push.txt. El backup está en $B." ;;
    post)
      echo "Las migraciones se aplicaron pero el POST no dio. NO mergees."
      echo "Mandame $B/post.txt. El backup está en $B." ;;
    listo)
      echo "El corte salió bien; sólo falló el último paso de limpieza." ;;
  esac
}
trap al_salir EXIT
trap 'exit 130' INT

cat <<'EOF'
Corte a producción. Antes de empezar:
  - Avisaste al grupo que nadie use la app por unos 15 minutos.
  - Sacaste una captura de la tabla de cada torneo.
  - El PR de integracion → main está abierto, con el CI y el preview en verde.
Hasta el paso 6 no se cambia ningún dato, y ahí te pido confirmación.
EOF
read -r -p "Enter para empezar (Ctrl-C para salir): " _

paso "0. Revisar que esté todo listo"
[ -x "$SB" ] || frenar "no encuentro $SB: corré esto desde el repo con node_modules."
v=$("$SB" --version)
[ "$v" = 2.113.0 ] || frenar "el CLI de Supabase es $v y el ensayado es 2.113.0."
command -v psql >/dev/null || frenar "falta psql."
command -v python3 >/dev/null || frenar "falta python3."
docker info >/dev/null 2>&1 || frenar "Docker no está corriendo (el backup lo usa)."
[ ! -e supabase/.temp/project-ref ] || frenar "el repo está linkeado (supabase/.temp/project-ref). El corte no usa link: borrá ese archivo."
git diff --quiet HEAD -- supabase/migrations scripts/corte-prod || frenar "hay cambios sin commitear en supabase/migrations o scripts/corte-prod."
mapfile -t locales < <(for f in supabase/migrations/*.sql; do basename "$f"; done | LC_ALL=C sort)
mapfile -t esperadas < <(for f in "${locales[@]}"; do
  [[ " ${YA_APLICADAS[*]} " == *" ${f%%_*} "* ]] || echo "$f"; done)
for m in "${YA_APLICADAS[@]}"; do
  [[ " ${locales[*]%%_*} " == *" $m "* ]] || frenar "falta el archivo de la migración $m en el repo."
done
ok "CLI $v, Docker, psql; ${#locales[@]} migraciones en el repo, ${#esperadas[@]} por aplicar"

paso "1. Conectar con la base"
if [ -n "${CORTE_DB_URL:-}" ]; then
  DB=$CORTE_DB_URL
  [[ $DB == *@127.0.0.1:* || $DB == *@localhost:* ]] || frenar "CORTE_DB_URL es sólo para ensayar contra una copia local."
  echo "   ENSAYO contra una copia local"
else
  echo "En el dashboard de Supabase: Connect → Session pooler → copiá la URI (la que dice [YOUR-PASSWORD])."
  read -r -p "URI: " uri
  [[ $uri == postgresql://*'[YOUR-PASSWORD]'@*.pooler.supabase.com:5432/postgres ]] \
    || frenar "esa no es la URI del Session pooler: tiene que tener [YOUR-PASSWORD] y terminar en .pooler.supabase.com:5432/postgres."
  read -r -s -p "Contraseña de la base (no se ve al escribir): " pw; echo
  [ -n "$pw" ] || frenar "la contraseña está vacía."
  # Escapada: una contraseña con @ o # rompe la URL.
  enc=$(printf %s "$pw" | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read(),safe=""))')
  DB=${uri/'[YOUR-PASSWORD]'/$enc}
  unset pw enc
fi
q -Atqc 'select 1' >/dev/null || frenar "no pude conectar: revisá la URI y la contraseña."
sb migration list --db-url "$DB" >/dev/null || frenar "el CLI no pudo leer el historial. Si se queja de .env.local, corré desde un worktree limpio de integracion."
h=$(historial)
[ "$h" = "${PROD_TS[*]}" ] || frenar "el historial de migraciones no es el ensayado (los 15 timestamps). Hay: ${h:-nada}."
ok "conectado; el historial es el de siempre"

paso "2. Backup"
B=${CORTE_BACKUP_DIR:-$HOME/backups/padelapp/$(date +%F_%H%M)-corte}
mkdir -p "$B"
shopt -s nullglob dotglob; contenido=("$B"/*); shopt -u nullglob dotglob
[ "${#contenido[@]}" -eq 0 ] || frenar "$B no está vacía."
echo "   carpeta: $B"
sb db dump --db-url "$DB" -f "$B/roles.sql" --role-only
sb db dump --db-url "$DB" -f "$B/schema.sql"
sb db dump --db-url "$DB" -f "$B/data.sql" --data-only --use-copy
q -qc "\\copy supabase_migrations.schema_migrations to '$B/schema_migrations.tsv'"
n_auth=$(rg -c '^COPY "auth"\."users"' "$B/data.sql" || true)
n_pub=$(rg -c '^COPY "public"\.' "$B/data.sql" || true)
t_pub=$(q -Atc "select count(*) from pg_tables where schemaname = 'public'")
n_hist=$(wc -l < "$B/schema_migrations.tsv")
[ "$n_auth" = 1 ] || frenar "el backup no trae auth.users."
[ "$n_pub" = "$t_pub" ] || frenar "el backup trae ${n_pub:-0} tablas de public y la base tiene $t_pub."
[ "$n_hist" -eq 15 ] || frenar "el historial guardado tiene $n_hist filas, no 15."
ok "backup completo: usuarios, $n_pub tablas y el historial"

paso "3. Chequeos de antes (PRE)"
q --single-transaction -f scripts/corte-prod/pre.sql 2>&1 | tee "$B/pre.txt"
etapa=pre_ok

paso "4. Alinear el historial de migraciones"
etapa=historial
sb migration repair --db-url "$DB" --status reverted "${PROD_TS[@]}"
sb migration repair --db-url "$DB" --status applied "${YA_APLICADAS[@]}"
h=$(historial)
[ "$h" = "${YA_APLICADAS[*]}" ] || frenar "el historial no quedó como se esperaba: $h"
ok "historial alineado con el repo"

paso "5. Ensayo en seco"
sb db push --db-url "$DB" --include-all --dry-run 2>&1 | tee "$B/dry-run.txt"
mapfile -t listadas < <(rg -o '[0-9]{4}_[a-z0-9_]+\.sql' "$B/dry-run.txt" | LC_ALL=C sort -u)
[ "${listadas[*]}" = "${esperadas[*]}" ] || frenar "el ensayo en seco no lista exactamente las ${#esperadas[@]} migraciones esperadas."
ok "lista exactamente las ${#esperadas[@]} esperadas, sin la 0089"

paso "6. Confirmación"
echo "Hasta acá no cambió ningún dato. Lo próximo aplica ${#esperadas[@]} migraciones,"
echo "y eso NO tiene vuelta atrás sin restaurar el backup ($B)."
read -r -p "Escribí CORTE para aplicar (cualquier otra cosa cancela y deja todo como estaba): " r
[ "$r" = CORTE ] || frenar "cancelado."

paso "7. Aplicar las migraciones"
etapa=push
sb --yes db push --db-url "$DB" --include-all 2>&1 | tee "$B/push.txt"

paso "8. Chequeos de después (POST)"
etapa=post
q --single-transaction -f scripts/corte-prod/post.sql 2>&1 | tee "$B/post.txt"
h=$(historial)
[ "$h" = "$(for f in "${locales[@]}"; do echo "${f%%_*}"; done | paste -sd' ')" ] \
  || frenar "el historial no coincide con los archivos del repo."
ok "el historial tiene las ${#locales[@]} migraciones del repo"
etapa=listo

paso "LISTO: las migraciones están aplicadas y los datos dieron igual que antes"
cat <<EOF
Ahora, enseguida:
  1. Mergeá el PR de integracion → main. Vercel deploya solo (tarda unos minutos).
  2. Cuando cargue, compará la tabla de cada torneo con tus capturas.
El backup quedó en $B
EOF
read -r -p "Cuando las tablas se vean bien, escribí LIMPIAR para borrar la foto audit_pre (tiene una copia de los mails). Enter para dejarla: " r
if [ "$r" = LIMPIAR ]; then borrar_audit
else echo "   audit_pre quedó. Para borrarla después: drop schema audit_pre cascade"; fi
echo "Por último: reseteá la contraseña de la base en el dashboard."
