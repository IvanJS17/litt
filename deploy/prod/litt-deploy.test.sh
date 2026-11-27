#!/usr/bin/env bash
# Pruebas de litt-deploy.sh con dobles de `docker` y `df` (sin Docker real ni root).
#   bash deploy/prod/litt-deploy.test.sh
# shellcheck disable=SC2034  # `st` se lee dentro de las condiciones de check (eval)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
GIB=$((1024 * 1024 * 1024))
NEW=$(printf 'a%.0s' {1..40}); LIVE=$(printf 'b%.0s' {1..40}); OLD=$(printf 'c%.0s' {1..40})
BID="sha256:$(printf '1%.0s' {1..64})"; FID="sha256:$(printf '2%.0s' {1..64})"; WID="sha256:$(printf '3%.0s' {1..64})"
fails=0

setup() {
  T=$(mktemp -d); mkdir -p "$T/bin" "$T/app/backups" "$T/app/deploy/prod"
  printf 'LITT_SOURCE_COMMIT=%s\nOTRA=1\nWORD_ADDIN_URL=https://word.example.test\nLITT_EDGE_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n' "$LIVE" > "$T/app/.env"; echo "$LIVE" > "$T/app/RELEASE_SHA"
  echo dump > "$T/app/backups/db.dump"; echo viejo > "$T/app/viejo.txt"
  mkdir -p "$T/tree/deploy/prod"; echo nuevo > "$T/tree/nuevo.txt"
  tar -czf "$T/tree.tgz" -C "$T/tree" .; chmod 600 "$T/tree.tgz"
  # El script y el archivo del release viven en un directorio privado (mktemp -d, modo 700) y el
  # digest es el real del archivo: las comprobaciones de entrada se cumplen de verdad, sin atajos.
  cp "$HERE/litt-deploy.sh" "$T/litt-deploy.sh"; chmod 700 "$T/litt-deploy.sh"
  TGZ="$T/tree.tgz"; DIG=$(sha256sum "$TGZ" | cut -d' ' -f1)
  for r in litt-backend litt-frontend litt-word; do printf '%s\n' "$LIVE" "$OLD" > "$T/tags-$r"; done
  : > "$T/calls"; echo "$1" > "$T/free"
  cat > "$T/bin/df" <<EOF
#!/usr/bin/env bash
echo Avail; cat "$T/free"
EOF
  cat > "$T/bin/docker" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$T/calls"
case "\$1 \$2" in
  "image ls") [ "\$3" = --filter ] && exit 0; grep -v '^\$' "$T/tags-\$3" || true; echo '<none>' ;;
  "rmi "*) repo=\${2%%:*} tag=\${2#*:}; [ "\$tag" = '<none>' ] && { echo "Error: invalid reference" >&2; exit 1; }; grep -vx "\$tag" "$T/tags-\$repo" > "$T/t2" || true; mv "$T/t2" "$T/tags-\$repo"
           echo \$(( \$(cat "$T/free") + $GIB )) > "$T/free" ;;
  "run --rm") [ -f "$T/devonly" ] && cat "$T/devonly"; exit 0 ;;
  "load ") cat > /dev/null; for r in litt-backend litt-frontend litt-word; do echo "$NEW" >> "$T/tags-\$r"; done ;;
  "image inspect") case "\$5" in litt-backend:*) echo "$BID";; litt-word:*) echo "$WID";; *) echo "$FID";; esac ;;
  "compose --env-file")
    case "\$*" in
      *"config --services"*) printf '%s\n' db auth db-init backend litt-web litt-word ;;
      *"--status running"*) printf '%s\n' auth backend db litt-web litt-word ;;
      *" ps --format"*) echo "db=running/healthy backend=running/healthy auth=running/healthy litt-web=running/healthy litt-word=running/healthy" ;;
    esac ;;
esac
EOF
  chmod +x "$T/bin/df" "$T/bin/docker"
}
# TGZ y DIG los fija setup; `unset DIG` omite el argumento del digest.
run() { echo imagen | gzip | PATH="$T/bin:$PATH" LITT_APP_DIR="$T/app" bash "$T/litt-deploy.sh" "$NEW" "$1" "$BID" "$FID" "$WID" "$TGZ" ${DIG+"$DIG"} > "$T/out" 2>&1; }
snap() { { find "$T/app" -printf '%p %y %s %T@\n' | sort; cat "$T/app/.env"; } | sha256sum; }
# Rechazo de entrada: sale con error, dice por qué y no cambia nada en el host de prueba
# (ni docker, ni marcador, ni archivos bajo el directorio de la aplicación).
refused() { [ $st -ne 0 ] && grep -q "$1" "$T/out" && [ ! -s "$T/calls" ] && ! grep -q iniciado "$T/out" && [ "$(snap)" = "$(cat "$T/snap")" ]; }
check() { if eval "$2"; then echo "ok   - $1"; else echo "FAIL - $1"; fails=$((fails + 1)); sed 's/^/       /' "$T/out"; fi; }

# 1. Sin espacio: aborta antes de cargar SIN retirar ninguna imagen (viva y anterior intactas) y borra el marcador.
setup $((4 * GIB))
if run $((2 * GIB)); then st=0; else st=$?; fi
check "aborta por espacio" '[ $st -ne 0 ] && grep -q "espacio insuficiente" "$T/out"'
check "no carga la imagen" '! grep -q "^load" "$T/calls"'
check "no retira ninguna imagen antes de abortar" '! grep -q "^rmi" "$T/calls" && grep -qx "$LIVE" "$T/tags-litt-backend" && grep -qx "$OLD" "$T/tags-litt-backend"'
check "marcador borrado en error" '[ ! -e "$T/app/.deploy-in-progress" ]'
check "no toca el árbol ni .env" '[ -f "$T/app/viejo.txt" ] && grep -qx "LITT_SOURCE_COMMIT=$LIVE" "$T/app/.env"'
rm -rf "$T"

# 2. Con espacio: carga, reemplaza el árbol (conserva .env y backups/), y retiene viva + anterior.
setup $((20 * GIB))
if run $((2 * GIB)); then st=0; else st=$?; fi
check "deploy exitoso" '[ $st -eq 0 ] && grep -q "deploy $NEW terminado" "$T/out"'
check "árbol nuevo, .env y backups conservados" '[ -f "$T/app/nuevo.txt" ] && [ ! -e "$T/app/viejo.txt" ] && [ -f "$T/app/backups/db.dump" ] && grep -qx OTRA=1 "$T/app/.env"'
check "LITT_SOURCE_COMMIT y RELEASE_SHA = nuevo" 'grep -qx "LITT_SOURCE_COMMIT=$NEW" "$T/app/.env" && [ "$(cat "$T/app/RELEASE_SHA")" = "$NEW" ]'
check "verifica el manifiesto de Word contra WORD_ADDIN_URL" 'tr "\n" " " < "$T/calls" | grep -q "exec -T litt-word .*https://word.example.test/taskpane.html"'
check "retención: retira solo la vieja, por tag y después de up" 'grep -n "rmi litt-backend:$OLD" "$T/calls" | cut -d: -f1 > "$T/a"; grep -n "up -d" "$T/calls" | cut -d: -f1 > "$T/b"; [ "$(cat "$T/a")" -gt "$(cat "$T/b")" ] && ! grep -q "rmi .*:$LIVE" "$T/calls" && ! grep -q "rmi .*:$NEW" "$T/calls"'
check "retención también para litt-word" 'grep -qx "rmi litt-word:$OLD" "$T/calls" && ! grep -q "rmi litt-word:$LIVE" "$T/calls"'
check "nunca usa prune" '! grep -q prune "$T/calls"'
check "ignora imágenes colgantes (<none>)" '! grep -q "rmi .*<none>" "$T/calls"'
check "sin carpeta temporal del release" '! ls -d "$T/app"/.release-* > /dev/null 2>&1'
check "inspecciona la imagen del frontend antes del up" 'grep -n "^run --rm" "$T/calls" | cut -d: -f1 > "$T/a"; grep -n "up -d" "$T/calls" | cut -d: -f1 > "$T/b"; [ "$(cat "$T/a")" -lt "$(cat "$T/b")" ]'
check "marcador borrado al terminar" '[ ! -e "$T/app/.deploy-in-progress" ]'
rm -rf "$T"

# 2b. La imagen del frontend con rutas solo de desarrollo: aborta antes de tocar el árbol y la viva sigue.
setup $((20 * GIB))
echo /app/node_modules/@opennextjs > "$T/devonly"
if run $((2 * GIB)); then st=0; else st=$?; fi
check "rechaza imagen con rutas solo de desarrollo" '[ $st -ne 0 ] && grep -q "solo de desarrollo" "$T/out" && grep -q "^run --rm" "$T/calls"'
check "no toca árbol, .env ni arranca contenedores" '[ -f "$T/app/viejo.txt" ] && grep -qx "LITT_SOURCE_COMMIT=$LIVE" "$T/app/.env" && ! grep -q "up -d" "$T/calls"'
rm -rf "$T"

# 3. Sin WORD_ADDIN_URL en .env: aborta antes de marcar, cargar o tocar el árbol.
setup $((20 * GIB))
sed -i '/^WORD_ADDIN_URL=/d' "$T/app/.env"
if run $((2 * GIB)); then st=0; else st=$?; fi
check "exige WORD_ADDIN_URL" '[ $st -ne 0 ] && grep -q WORD_ADDIN_URL "$T/out" && ! grep -q "^load" "$T/calls" && [ -f "$T/app/viejo.txt" ]'
rm -rf "$T"

# 4. Sin LITT_EDGE_SECRET en .env: aborta antes de marcar, cargar o tocar el árbol.
setup $((20 * GIB))
sed -i '/^LITT_EDGE_SECRET=/d' "$T/app/.env"
if run $((2 * GIB)); then st=0; else st=$?; fi
check "exige LITT_EDGE_SECRET" '[ $st -ne 0 ] && grep -q LITT_EDGE_SECRET "$T/out" && ! grep -q "^load" "$T/calls" && [ -f "$T/app/viejo.txt" ]'
rm -rf "$T"

# 5. Entradas del deploy: el archivo del release y su directorio son de la cuenta, no escribibles por
#    otros, y su sha256 coincide con el que pasa el operador. Se rechaza antes de tocar el host.
setup $((20 * GIB)); snap > "$T/snap"
if run $((2 * GIB)); then st=0; else st=$?; fi
check "entrada correcta: despliega" '[ $st -eq 0 ] && grep -q "deploy $NEW terminado" "$T/out" && [ ! -e "$T/app/viejo.txt" ] && [ ! -e "$TGZ" ]'
rm -rf "$T"

setup $((20 * GIB)); ln -s "$T/tree.tgz" "$T/liga.tgz"; TGZ="$T/liga.tgz"; snap > "$T/snap"
if run $((2 * GIB)); then st=0; else st=$?; fi
check "rechaza un archivo que es un enlace" 'refused "es un enlace"'
rm -rf "$T"

setup $((20 * GIB)); chmod 666 "$T/tree.tgz"; snap > "$T/snap"
if run $((2 * GIB)); then st=0; else st=$?; fi
check "rechaza un archivo escribible por otros" 'refused "escribible por grupo u otros"'
rm -rf "$T"

setup $((20 * GIB)); chmod 664 "$T/tree.tgz"; snap > "$T/snap"
if run $((2 * GIB)); then st=0; else st=$?; fi
check "rechaza un archivo escribible por el grupo" 'refused "escribible por grupo u otros"'
rm -rf "$T"

for m in 1777 777; do
  setup $((20 * GIB)); mkdir "$T/comun"; chmod "$m" "$T/comun"; cp "$T/tree.tgz" "$T/comun/"; TGZ="$T/comun/tree.tgz"; snap > "$T/snap"
  if run $((2 * GIB)); then st=0; else st=$?; fi
  check "rechaza un directorio con modo $m" 'refused "escribible por grupo u otros"'
  rm -rf "$T"
done

setup $((20 * GIB)); unset DIG; snap > "$T/snap"
if run $((2 * GIB)); then st=0; else st=$?; fi
check "exige el digest sha256" 'refused "TREE_SHA256"'
rm -rf "$T"

setup $((20 * GIB)); DIG=$(printf '0%.0s' {1..64}); snap > "$T/snap"
if run $((2 * GIB)); then st=0; else st=$?; fi
check "rechaza un digest que no coincide" 'refused "sha256 no coincide"'
rm -rf "$T"

setup $((20 * GIB)); DIG=abc; snap > "$T/snap"
if run $((2 * GIB)); then st=0; else st=$?; fi
check "rechaza un digest mal formado" 'refused "sha256 inválido"'
rm -rf "$T"

setup $((20 * GIB)); chmod 777 "$T/litt-deploy.sh"; snap > "$T/snap"
if run $((2 * GIB)); then st=0; else st=$?; fi
check "rechaza un script escribible por otros" 'refused "el script es escribible"'
rm -rf "$T"

setup $((20 * GIB)); DIG=$(printf '%s' "$DIG" | tr a-f A-F); snap > "$T/snap"
if run $((2 * GIB)); then st=0; else st=$?; fi
check "rechaza un digest en mayúsculas" 'refused "sha256 inválido"'
rm -rf "$T"

setup $((20 * GIB)); mkdir "$T/real"; mv "$T/tree.tgz" "$T/real/"; ln -s "$T/real" "$T/atajo"; TGZ="$T/atajo/tree.tgz"; snap > "$T/snap"
if run $((2 * GIB)); then st=0; else st=$?; fi
check "rechaza un archivo alcanzado a través de un directorio enlazado" 'refused "escribible por grupo u otros"'
rm -rf "$T"

setup $((20 * GIB)); snap > "$T/snap"
if echo imagen | gzip | PATH="$T/bin:$PATH" LITT_APP_DIR="$T/app" bash <(cat "$T/litt-deploy.sh") "$NEW" $((2 * GIB)) "$BID" "$FID" "$WID" "$TGZ" "$DIG" > "$T/out" 2>&1; then st=0; else st=$?; fi
check "rechaza correr el script si no viene de su archivo" 'refused "desde su archivo"'
rm -rf "$T"

# Otra cuenta no se puede producir sin otro usuario: se prueba la decisión con un `stat` de prueba
# que informa un dueño distinto.
setup $((20 * GIB)); snap > "$T/snap"
printf '#!/usr/bin/env bash\necho "%s 600"\n' $(( $(id -u) + 1 )) > "$T/bin/stat"; chmod +x "$T/bin/stat"
if run $((2 * GIB)); then st=0; else st=$?; fi
check "rechaza un dueño distinto a la cuenta que corre el script" 'refused "no pertenece a la cuenta"'
rm -rf "$T"

[ "$fails" -eq 0 ] && echo "todas las pruebas pasaron" || { echo "$fails fallas"; exit 1; }
