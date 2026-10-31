#!/usr/bin/env bash
# LiTT — deploy de un release en el VPS compartido (README §1–§4; HOST-RULES §3–§5).
#
# Uso, desde la máquina de build (README §1):
#   scp deploy/prod/litt-deploy.sh staging-apps-dev:/tmp/litt-deploy.sh
#   git archive --format=tar.gz "$SHA" | ssh staging-apps-dev "cat > /tmp/litt-$SHA.tar.gz"
#   docker save "litt-backend:$SHA" "litt-frontend:$SHA" | gzip -1 | ssh staging-apps-dev \
#     bash /tmp/litt-deploy.sh "$SHA" "$IMAGE_BYTES" "$BACKEND_ID" "$FRONTEND_ID" "/tmp/litt-$SHA.tar.gz"
#
# Las imágenes llegan por stdin (sin copias temporales en disco). El script:
#   1. marca el deploy en curso (/srv/litt/.deploy-in-progress, borrado con trap);
#   2. comprueba el espacio ANTES de cargar: libres >= max(7 GiB, 2 × IMAGE_BYTES + 5 GiB);
#      si no alcanza, retira primero imágenes litt-* que no son la viva y, si aún no
#      alcanza, aborta;
#   3. carga las imágenes y verifica sus IDs contra los de la máquina de build;
#   4. reemplaza el árbol del release sin dejarlo vacío en ningún momento (extrae aparte y
#      sincroniza con rsync; conserva .env y backups/) y fija LITT_SOURCE_COMMIT;
#   5. `up -d --remove-orphans` y espera a que todo quede healthy y /health reporte el SHA;
#   6. solo entonces aplica la retención: imagen viva + 1 anterior, retirando por tag
#      explícito. Nunca usa prune.
set -euo pipefail

APP_DIR=${LITT_APP_DIR:-/srv/litt}   # LITT_APP_DIR solo lo usa litt-deploy.test.sh
MARK="$APP_DIR/.deploy-in-progress"
REPOS=(litt-backend litt-frontend)
GIB=$((1024 * 1024 * 1024))

die() { echo "ERROR: $*" >&2; exit 1; }
log() { echo "$(date -u +%FT%TZ) $*"; }

[ "$#" -eq 5 ] || die "uso: litt-deploy.sh <SHA> <IMAGE_BYTES> <BACKEND_ID> <FRONTEND_ID> <TREE_TGZ>"
SHA=$1 IMAGE_BYTES=$2 BACKEND_ID=$3 FRONTEND_ID=$4 TREE_TGZ=$5
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "SHA debe ser el commit completo (40 hex)"
[[ "$IMAGE_BYTES" =~ ^[1-9][0-9]*$ ]] || die "IMAGE_BYTES debe ser un entero positivo"
for id in "$BACKEND_ID" "$FRONTEND_ID"; do
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || die "ID de imagen inválido: $id"
done
[ -f "$TREE_TGZ" ] || die "no existe el árbol del release: $TREE_TGZ"
[ -f "$APP_DIR/.env" ] || die "falta $APP_DIR/.env (primer arranque: README §3)"

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
if [ "$(free_bytes)" -lt "$NEED" ]; then
  log "libres $(free_bytes) < necesarios $NEED: retiro imágenes litt-* que no son la viva ($LIVE)"
  for repo in "${REPOS[@]}"; do
    for tag in $(own_tags "$repo"); do
      [ "$tag" = "$LIVE" ] || [ "$tag" = "$SHA" ] || docker rmi "$repo:$tag"
    done
  done
fi
FREE=$(free_bytes)
[ "$FREE" -ge "$NEED" ] || die "espacio insuficiente: libres $FREE < necesarios $NEED; se aborta sin cargar"
log "espacio ok: libres $FREE >= necesarios $NEED"

# 3. Carga e identidad de las imágenes.
gzip -dc | docker load
[ "$(docker image inspect --format '{{.Id}}' "litt-backend:$SHA")" = "$BACKEND_ID" ] || die "ID de litt-backend:$SHA distinto al construido"
[ "$(docker image inspect --format '{{.Id}}' "litt-frontend:$SHA")" = "$FRONTEND_ID" ] || die "ID de litt-frontend:$SHA distinto al construido"
log "imágenes cargadas con los IDs esperados"

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

# 6. Retención: viva ($SHA) + 1 anterior ($LIVE), por tag explícito.
for repo in "${REPOS[@]}"; do
  for tag in $(own_tags "$repo"); do
    [ "$tag" = "$SHA" ] || [ "$tag" = "$LIVE" ] || docker rmi "$repo:$tag"
  done
done
log "retención aplicada: $(docker image ls --filter 'reference=litt-*' --format '{{.Repository}}:{{.Tag}}' | tr '\n' ' ')"
log "deploy $SHA terminado"
