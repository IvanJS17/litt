#!/usr/bin/env bash
# LiTT — deploy de un release en el VPS compartido (README §1–§4; HOST-RULES §3–§5).
#
# Uso, desde la máquina de build (README §1). El script y el árbol del release se dejan en un
# directorio hecho para ese deploy y privado de la cuenta (mktemp -d, modo 700), no en nombres
# fijos del directorio temporal compartido; el directorio se borra al terminar:
#   D=$(ssh staging-apps-dev 'mktemp -d'); B=$(mktemp -d); [ -n "$D" ] || exit 1
#   git archive --format=tar.gz "$SHA" > "$B/litt-$SHA.tar.gz"      # el mismo archivo se resume y se envía
#   TREE_SHA256=$(sha256sum "$B/litt-$SHA.tar.gz" | cut -d' ' -f1)
#   scp deploy/prod/litt-deploy.sh "staging-apps-dev:$D/litt-deploy.sh"
#   scp "$B/litt-$SHA.tar.gz" "staging-apps-dev:$D/litt-$SHA.tar.gz"
#   docker save "litt-backend:$SHA" "litt-frontend:$SHA" "litt-word:$SHA" | gzip -1 | ssh staging-apps-dev \
#     bash "$D/litt-deploy.sh" "$SHA" "$IMAGE_BYTES" "$BACKEND_ID" "$FRONTEND_ID" "$WORD_ID" "$D/litt-$SHA.tar.gz" "$TREE_SHA256" \
#     && st=0 || st=$?
#   ssh staging-apps-dev "rm -rf '$D'"; rm -rf "$B"       # la limpieza corre también si el deploy falló
#   echo "deploy: estado de salida $st"; [ "$st" -eq 0 ]   # el bloque termina en fallo si el deploy falló
#
# Antes de cambiar nada en el host el script exige: el árbol es un archivo regular (no un
# enlace), de la cuenta que corre el script y no escribible por grupo ni otros; su directorio
# es de la cuenta y no escribible por grupo ni otros (un directorio compartido se rechaza); el
# propio script cumple dueño y modo; y el sha256 del árbol es el TREE_SHA256 que se pasa.
#
# Las imágenes llegan por stdin (sin copias temporales en disco). El script:
#   1. marca el deploy en curso (/srv/litt/.deploy-in-progress, borrado con trap);
#   2. comprueba el espacio ANTES de cargar: libres >= max(7 GiB, 2 × IMAGE_BYTES + 5 GiB),
#      con IMAGE_BYTES = tamaño de la unión de capas de las tres imágenes (README §1).
#      Si no alcanza, aborta sin tocar nada: no retira imágenes (la viva y la anterior
#      siguen cargadas, el rollback depende de ello);
#   3. carga las imágenes y verifica sus IDs contra los de la máquina de build;
#   4. reemplaza el árbol del release sin dejarlo vacío en ningún momento (extrae aparte y
#      sincroniza con rsync; conserva .env y backups/) y fija LITT_SOURCE_COMMIT;
#   5. `up -d --remove-orphans` y espera a que todo quede healthy, /health reporte el SHA y
#      el complemento de Word sirva un manifest.xml con su URL pública (WORD_ADDIN_URL);
#   6. solo entonces aplica la retención: imagen viva + 1 anterior, retirando por tag
#      explícito. Nunca usa prune.
set -euo pipefail

APP_DIR=${LITT_APP_DIR:-/srv/litt}   # LITT_APP_DIR solo lo usa litt-deploy.test.sh
MARK="$APP_DIR/.deploy-in-progress"
REPOS=(litt-backend litt-frontend litt-word)
GIB=$((1024 * 1024 * 1024))

die() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "$(date -u +%FT%TZ) $*"; }

[ "$#" -eq 7 ] || die "uso: litt-deploy.sh <SHA> <IMAGE_BYTES> <BACKEND_ID> <FRONTEND_ID> <WORD_ID> <TREE_TGZ> <TREE_SHA256>"
SHA=$1 IMAGE_BYTES=$2 BACKEND_ID=$3 FRONTEND_ID=$4 WORD_ID=$5 TREE_TGZ=$6 TREE_SHA256=$7
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "SHA debe ser el commit completo (40 hex)"
[[ "$IMAGE_BYTES" =~ ^[1-9][0-9]*$ ]] || die "IMAGE_BYTES debe ser un entero positivo"
for id in "$BACKEND_ID" "$FRONTEND_ID" "$WORD_ID"; do
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || die "ID de imagen inválido: $id"
done
[[ "$TREE_SHA256" =~ ^[0-9a-f]{64}$ ]] || die "TREE_SHA256 (sha256 inválido): se esperan 64 hex en minúsculas"

# Entradas: dueño y modo antes de usarlas (siempre; sin opción para omitirlo).
owner_mode_ok() { # <ruta> <qué es>
  local st uid mode
  st=$(stat -c '%u %a' -- "$1") || die "no se pudo leer dueño y modo de $2: $1"
  uid=${st% *} mode=${st#* }
  [ "$uid" = "$(id -u)" ] || die "$2 no pertenece a la cuenta que corre el script: $1"
  [ $((8#$mode & 8#022)) -eq 0 ] || die "$2 es escribible por grupo u otros (modo $mode): $1"
}
[ ! -L "$TREE_TGZ" ] || die "el árbol del release es un enlace: $TREE_TGZ"
[ -f "$TREE_TGZ" ] || die "no existe el árbol del release (archivo regular): $TREE_TGZ"
owner_mode_ok "$TREE_TGZ" "el árbol del release"
owner_mode_ok "$(dirname -- "$TREE_TGZ")" "el directorio del árbol del release"
SELF=${BASH_SOURCE[0]:-}
[ -n "$SELF" ] && [ -f "$SELF" ] && [ ! -L "$SELF" ] || die "el script se corre desde su archivo (bash <directorio del deploy>/litt-deploy.sh ...), no desde la entrada estándar ni un enlace"
owner_mode_ok "$SELF" "el script"
[ "$(sha256sum -- "$TREE_TGZ" | cut -d' ' -f1)" = "$TREE_SHA256" ] || die "el sha256 no coincide con TREE_SHA256: el árbol del release no es el construido"

[ -f "$APP_DIR/.env" ] || die "falta $APP_DIR/.env (primer arranque: README §3)"
WORD_URL=$(sed -n 's/^WORD_ADDIN_URL=//p' "$APP_DIR/.env" | tail -1)
[[ "$WORD_URL" =~ ^https://[a-z0-9.-]+$ ]] || die "WORD_ADDIN_URL en .env debe ser un origen https (README §Complemento de Word)"
grep -Eq '^LITT_EDGE_SECRET=[A-Za-z0-9]{32,}$' "$APP_DIR/.env" || die "LITT_EDGE_SECRET en .env debe tener 32 o más caracteres alfanuméricos (README §Dirección del cliente)"

STAGE="$APP_DIR/.release-$SHA"
touch "$MARK"
trap 'rm -rf "$MARK" "$STAGE"' EXIT
log "deploy $SHA iniciado (marcador $MARK)"

LIVE=$(cat "$APP_DIR/RELEASE_SHA" 2>/dev/null || true)

# Tags con nombre de un repositorio propio; las imágenes colgantes (<none>) las retira el
# guardián del host, y `docker rmi repo:<none>` fallaría.
own_tags() { docker image ls "$1" --format '{{.Tag}}' | grep -vx '<none>' || true; }
free_bytes() { df -B1 --output=avail / | tail -1 | tr -d ' '; }

# 2. Espacio antes de cargar (HOST-RULES §5).
NEED=$((2 * IMAGE_BYTES + 5 * GIB))
[ "$NEED" -ge $((7 * GIB)) ] || NEED=$((7 * GIB))
FREE=$(free_bytes)
[ "$FREE" -ge "$NEED" ] || die "espacio insuficiente: libres $FREE < necesarios $NEED; se aborta sin cargar"
log "espacio ok: libres $FREE >= necesarios $NEED"

# 3. Carga e identidad de las imágenes.
gzip -dc | docker load
[ "$(docker image inspect --format '{{.Id}}' "litt-backend:$SHA")" = "$BACKEND_ID" ] || die "ID de litt-backend:$SHA distinto al construido"
[ "$(docker image inspect --format '{{.Id}}' "litt-frontend:$SHA")" = "$FRONTEND_ID" ] || die "ID de litt-frontend:$SHA distinto al construido"
[ "$(docker image inspect --format '{{.Id}}' "litt-word:$SHA")" = "$WORD_ID" ] || die "ID de litt-word:$SHA distinto al construido"
log "imágenes cargadas con los IDs esperados"

# La allowlist de auditoría (scripts/audit-allowlist.json, notInProductionImage) afirma que la
# imagen del frontend no lleva las herramientas de desarrollo; aquí se comprueba de verdad.
# Se ejecuta antes de tocar el árbol o los contenedores: si falla, la versión viva sigue igual.
DEV_ONLY=$(docker run --rm --network none --entrypoint sh "litt-frontend:$SHA" -c \
  "find / -xdev \\( -path '*/node_modules/@parcel/watcher' -o -path '*/node_modules/micromatch' -o -path '*/node_modules/@opennextjs' \\) -not -path '/usr/local/lib/node_modules/npm/*' 2>/dev/null; true" \
  ) || die "no se pudo inspeccionar la imagen litt-frontend:$SHA"
[ -z "$DEV_ONLY" ] || die "litt-frontend:$SHA contiene rutas solo de desarrollo: $(echo "$DEV_ONLY" | tr '\n' ' ')"
log "imagen del frontend sin rutas solo de desarrollo"

# 4. Árbol del release. Se extrae aparte y se sincroniza: rsync reemplaza cada archivo con
# un rename atómico, así que los bind-mounts de contenedores vivos (gateway.conf,
# auth-edge.conf) nunca desaparecen; borrar antes de extraer dejaría una ventana en la que
# un reinicio haría que Docker los materializara como directorios.
rm -rf "$STAGE"; mkdir -p "$STAGE"
tar -xzf "$TREE_TGZ" -C "$STAGE"
rsync -a --delete --exclude /.env --exclude /backups/ --exclude /.deploy-in-progress \
  --exclude '/.release-*' "$STAGE"/ "$APP_DIR"/
rm -rf "$STAGE" "$TREE_TGZ"
sed -i "s/^LITT_SOURCE_COMMIT=.*/LITT_SOURCE_COMMIT=$SHA/" "$APP_DIR/.env"
grep -qx "LITT_SOURCE_COMMIT=$SHA" "$APP_DIR/.env" || die "no se pudo fijar LITT_SOURCE_COMMIT en .env"
echo "$SHA" > "$APP_DIR/RELEASE_SHA"

# 5. Arranque y salud.
C=(docker compose --env-file "$APP_DIR/.env" -f "$APP_DIR/deploy/prod/compose.yaml")
"${C[@]}" up -d --remove-orphans
# Todo servicio de larga vida (todos menos el one-shot db-init) debe estar
# corriendo; los que tienen healthcheck, healthy.
expected=$("${C[@]}" config --services | grep -vx db-init | sort | tr '\n' ' ')
for _ in $(seq 1 60); do
  running=$("${C[@]}" ps --status running --format '{{.Service}}' | sort | tr '\n' ' ')
  states=$("${C[@]}" ps --format '{{.Service}}={{.State}}/{{.Health}}' | tr '\n' ' ')
  case "$states" in
    *unhealthy*|*restarting*) die "servicio con falla: $states" ;;
  esac
  if [ "$running" = "$expected" ] && [[ "$states" != *starting* ]]; then break; fi
  sleep 10
done
[ "$running" = "$expected" ] || die "servicios esperados: $expected; corriendo: $running"
[[ "$states" != *starting* ]] || die "timeout esperando salud: $states"
log "servicios: $states"
"${C[@]}" exec -T backend node -e "
fetch('http://127.0.0.1:3001/health').then(r => r.json()).then(b => {
  if (!b.ok || b.commit !== '$SHA') { console.error('health', JSON.stringify(b)); process.exit(1); }
}).catch(e => { console.error(e.message); process.exit(1); })" || die "/health no reporta $SHA"
log "/health reporta $SHA"
# El manifiesto lleva la URL pública con la que se construyó la imagen; si no coincide con
# WORD_ADDIN_URL del backend, Word cargaría un panel que el backend rechaza.
"${C[@]}" exec -T litt-word node -e "
fetch('http://127.0.0.1:3200/manifest.xml').then(r => r.text()).then(m => {
  if (!m.includes('<SourceLocation DefaultValue=\"$WORD_URL/taskpane.html\"')) { console.error('manifest sin $WORD_URL'); process.exit(1); }
}).catch(e => { console.error(e.message); process.exit(1); })" || die "manifest.xml de litt-word no apunta a $WORD_URL"
log "manifest.xml apunta a $WORD_URL"

# 6. Retención: viva ($SHA) + 1 anterior ($LIVE), por tag explícito.
for repo in "${REPOS[@]}"; do
  for tag in $(own_tags "$repo"); do
    [ "$tag" = "$SHA" ] || [ "$tag" = "$LIVE" ] || docker rmi "$repo:$tag"
  done
done
log "retención aplicada: $(docker image ls --filter 'reference=litt-*' --format '{{.Repository}}:{{.Tag}}' | tr '\n' ' ')"
log "deploy $SHA terminado"
