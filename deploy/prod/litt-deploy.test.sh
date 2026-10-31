#!/usr/bin/env bash
# Pruebas de litt-deploy.sh con dobles de `docker` y `df` (sin Docker real ni root).
#   bash deploy/prod/litt-deploy.test.sh
# shellcheck disable=SC2034  # `st` se lee dentro de las condiciones de check (eval)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
GIB=$((1024 * 1024 * 1024))
NEW=$(printf 'a%.0s' {1..40}); LIVE=$(printf 'b%.0s' {1..40}); OLD=$(printf 'c%.0s' {1..40})
BID="sha256:$(printf '1%.0s' {1..64})"; FID="sha256:$(printf '2%.0s' {1..64})"
fails=0

setup() {
  T=$(mktemp -d); mkdir -p "$T/bin" "$T/app/backups" "$T/app/deploy/prod"
  printf 'LITT_SOURCE_COMMIT=%s\nOTRA=1\n' "$LIVE" > "$T/app/.env"; echo "$LIVE" > "$T/app/RELEASE_SHA"
  echo dump > "$T/app/backups/db.dump"; echo viejo > "$T/app/viejo.txt"
  mkdir -p "$T/tree/deploy/prod"; echo nuevo > "$T/tree/nuevo.txt"
  tar -czf "$T/tree.tgz" -C "$T/tree" .
  printf '%s\n' "$LIVE" "$OLD" > "$T/tags"; : > "$T/calls"; echo "$1" > "$T/free"
  cat > "$T/bin/df" <<EOF
#!/usr/bin/env bash
echo Avail; cat "$T/free"
EOF
  cat > "$T/bin/docker" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$T/calls"
case "\$1 \$2" in
  "image ls") [ "\$3" = --filter ] && exit 0; grep -v '^\$' "$T/tags" || true; echo '<none>' ;;
  "rmi "*) tag=\${2#*:}; [ "\$tag" = '<none>' ] && { echo "Error: invalid reference" >&2; exit 1; }; grep -vx "\$tag" "$T/tags" > "$T/t2" || true; mv "$T/t2" "$T/tags"
           echo \$(( \$(cat "$T/free") + 3 * $GIB )) > "$T/free" ;;
  "load ") cat > /dev/null; echo "$NEW" >> "$T/tags" ;;
  "image inspect") case "\$5" in litt-backend:*) echo "$BID";; *) echo "$FID";; esac ;;
  "compose --env-file")
    case "\$*" in
      *"config --services"*) printf '%s\n' db auth db-init backend litt-web ;;
      *"--status running"*) printf '%s\n' auth backend db litt-web ;;
      *" ps --format"*) echo "db=running/healthy backend=running/healthy auth=running/healthy litt-web=running/healthy" ;;
    esac ;;
esac
EOF
  chmod +x "$T/bin/df" "$T/bin/docker"
}
run() { echo imagen | gzip | PATH="$T/bin:$PATH" LITT_APP_DIR="$T/app" bash "$HERE/litt-deploy.sh" "$NEW" "$1" "$BID" "$FID" "$T/tree.tgz" > "$T/out" 2>&1; }
check() { if eval "$2"; then echo "ok   - $1"; else echo "FAIL - $1"; fails=$((fails + 1)); sed 's/^/       /' "$T/out"; fi; }

# 1. Sin espacio ni retirando la imagen vieja: aborta antes de cargar, conserva la viva y borra el marcador.
setup $((4 * GIB))
if run $((2 * GIB)); then st=0; else st=$?; fi
check "aborta por espacio" '[ $st -ne 0 ] && grep -q "espacio insuficiente" "$T/out"'
check "no carga la imagen" '! grep -q "^load" "$T/calls"'
check "retira primero la vieja propia, nunca la viva" 'grep -qx "rmi litt-backend:$OLD" "$T/calls" && ! grep -q "rmi .*:$LIVE" "$T/calls"'
check "marcador borrado en error" '[ ! -e "$T/app/.deploy-in-progress" ]'
check "no toca el árbol ni .env" '[ -f "$T/app/viejo.txt" ] && grep -qx "LITT_SOURCE_COMMIT=$LIVE" "$T/app/.env"'
rm -rf "$T"

# 2. Con espacio: carga, reemplaza el árbol (conserva .env y backups/), y retiene viva + anterior.
setup $((20 * GIB))
if run $((2 * GIB)); then st=0; else st=$?; fi
check "deploy exitoso" '[ $st -eq 0 ] && grep -q "deploy $NEW terminado" "$T/out"'
check "árbol nuevo, .env y backups conservados" '[ -f "$T/app/nuevo.txt" ] && [ ! -e "$T/app/viejo.txt" ] && [ -f "$T/app/backups/db.dump" ] && grep -qx OTRA=1 "$T/app/.env"'
check "LITT_SOURCE_COMMIT y RELEASE_SHA = nuevo" 'grep -qx "LITT_SOURCE_COMMIT=$NEW" "$T/app/.env" && [ "$(cat "$T/app/RELEASE_SHA")" = "$NEW" ]'
check "retención: retira solo la vieja, por tag y después de up" 'grep -n "rmi litt-backend:$OLD" "$T/calls" | cut -d: -f1 > "$T/a"; grep -n "up -d" "$T/calls" | cut -d: -f1 > "$T/b"; [ "$(cat "$T/a")" -gt "$(cat "$T/b")" ] && ! grep -q "rmi .*:$LIVE" "$T/calls" && ! grep -q "rmi .*:$NEW" "$T/calls"'
check "nunca usa prune" '! grep -q prune "$T/calls"'
check "ignora imágenes colgantes (<none>)" '! grep -q "rmi .*<none>" "$T/calls"'
check "sin carpeta temporal del release" '! ls -d "$T/app"/.release-* > /dev/null 2>&1'
check "marcador borrado al terminar" '[ ! -e "$T/app/.deploy-in-progress" ]'
rm -rf "$T"

[ "$fails" -eq 0 ] && echo "todas las pruebas pasaron" || { echo "$fails fallas"; exit 1; }
