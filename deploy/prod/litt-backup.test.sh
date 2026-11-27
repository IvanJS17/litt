#!/usr/bin/env bash
# Pruebas de litt-backup.sh con dobles de `docker` y `restic` (sin Docker real,
# sin restic real y sin root), en un directorio temporal y bajo `umask 022`.
#   bash deploy/prod/litt-backup.test.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
fails=0

setup() {
  T=$(mktemp -d); mkdir -p "$T/bin" "$T/app"
  printf 'LITT_EDGE_SECRET=sintetico\n' > "$T/app/.env"; chmod 600 "$T/app/.env"
  printf 'RESTIC_REPOSITORY=%s\nRESTIC_PASSWORD=x\nAWS_ACCESS_KEY_ID=x\nAWS_SECRET_ACCESS_KEY=x\n' "$T/repo" > "$T/restic.env"; chmod 600 "$T/restic.env"
  : > "$T/calls"
  # docker: el pg_dump de mentira escribe unos bytes y sale con 0, o con 1 si existe $T/pgfail.
  # Anota en $T/during el modo del archivo al que escribe y el de su directorio, mientras escribe.
  cat > "$T/bin/docker" <<EOS
#!/usr/bin/env bash
echo "docker \$*" >> "$T/calls"
out=\$(readlink "/proc/\$\$/fd/1")
echo "\$(stat -c '%a' "\$out") \$(stat -c '%a' "\$(dirname "\$out")") \$(basename "\$out")" >> "$T/during"
printf 'volcado-nuevo\n'
[ -f "$T/pgfail" ] && exit 1
exit 0
EOS
  cat > "$T/bin/restic" <<EOS
#!/usr/bin/env bash
echo "restic \$*" >> "$T/calls"
EOS
  printf '#!/usr/bin/env bash\necho 15\n' > "$T/bin/date"   # día 15: restic check simple
  chmod +x "$T/bin/docker" "$T/bin/restic" "$T/bin/date"
}
run() {
  ( umask 022; PATH="$T/bin:$PATH" LITT_APP_DIR="$T/app" LITT_RESTIC_ENV="$T/restic.env" \
      bash "$HERE/litt-backup.sh" > "$T/out" 2>&1 )
}
check() { if eval "$2"; then echo "ok   - $1"; else echo "FAIL - $1"; fails=$((fails + 1)); sed 's/^/       /' "$T/out"; fi; }
mode() { stat -c '%a' "$1"; }

# 1. Corrida normal: dump 600, directorio 700, sin archivos temporales.
setup
if run; then st=0; else st=$?; fi
check "el dump queda en modo 600 con el contenido nuevo" '[ $st -eq 0 ] && [ "$(mode "$T/app/backups/db.dump")" = 600 ] && grep -q volcado-nuevo "$T/app/backups/db.dump"'
check "el directorio de respaldos queda en modo 700" '[ "$(mode "$T/app/backups")" = 700 ]'
check "no queda archivo temporal" '[ "$(ls -A "$T/app/backups")" = db.dump ]'
# 5. restic como hasta ahora, en el mismo orden.
check "restic backup, check y forget --keep-daily 30 --prune en orden" \
  '[ "$(grep ^restic "$T/calls")" = "$(printf "restic backup %s %s\nrestic check\nrestic forget --keep-daily 30 --prune" "$T/app/backups" "$T/app/.env")" ]'
rm -rf "$T"

# 2. Un dump previo con modo 644 se reemplaza por uno privado con el contenido nuevo.
setup; mkdir -p "$T/app/backups"; echo viejo > "$T/app/backups/db.dump"; chmod 644 "$T/app/backups/db.dump"
if run; then st=0; else st=$?; fi
check "un dump previo en 644 termina en 600 con el contenido nuevo" '[ $st -eq 0 ] && [ "$(mode "$T/app/backups/db.dump")" = 600 ] && grep -q volcado-nuevo "$T/app/backups/db.dump" && ! grep -q viejo "$T/app/backups/db.dump"'
rm -rf "$T"

# 3. Un directorio previo en 755 termina en 700.
setup; mkdir -p "$T/app/backups"; chmod 755 "$T/app/backups"
if run; then st=0; else st=$?; fi
check "un directorio previo en 755 termina en 700" '[ $st -eq 0 ] && [ "$(mode "$T/app/backups")" = 700 ]'
check "mientras se escribe, el volcado ya es privado y su directorio también" '[ "$(cat "$T/during")" = "600 700 db.dump.tmp" ]'
rm -rf "$T"

# 3b. Un temporal viejo que es un enlace no se sigue: lo que apunta queda igual.
setup; mkdir -p "$T/app/backups"; echo intacto > "$T/ajeno"; ln -s "$T/ajeno" "$T/app/backups/db.dump.tmp"
if run; then st=0; else st=$?; fi
check "un temporal viejo que es un enlace se quita y no se escribe a través de él" '[ $st -eq 0 ] && [ "$(cat "$T/ajeno")" = intacto ] && [ ! -L "$T/app/backups/db.dump" ] && grep -q volcado-nuevo "$T/app/backups/db.dump"'
rm -rf "$T"

# 4. Si pg_dump falla: sale con error, el dump anterior queda igual, sin temporal ni restic.
setup; mkdir -p "$T/app/backups"; echo bueno-anterior > "$T/app/backups/db.dump"; cp "$T/app/backups/db.dump" "$T/copia"; touch "$T/pgfail"
if run; then st=0; else st=$?; fi
check "pg_dump fallido: sale con error y el dump anterior queda intacto" '[ $st -ne 0 ] && cmp -s "$T/copia" "$T/app/backups/db.dump"'
check "pg_dump fallido: no queda archivo temporal" '[ "$(ls -A "$T/app/backups")" = db.dump ]'
check "pg_dump fallido: no se llama a restic" '! grep -q "^restic" "$T/calls"'
rm -rf "$T"

[ "$fails" -eq 0 ] && echo "todo bien" || { echo "$fails fallas"; exit 1; }
