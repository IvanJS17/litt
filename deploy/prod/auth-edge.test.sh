#!/usr/bin/env bash
# Pruebas de auth-edge.conf contra un nginx real (nginx:1.27.5-alpine) y un
# upstream de mentira que registra lo que recibe. Sin GoTrue, sin red externa.
#   bash deploy/prod/auth-edge.test.sh
# Se omite (sale 0) si no hay Docker. Los recursos llevan el prefijo
# ${LITT_TEST_PREFIX:-litt-auth-edge-test} y se retiran al terminar.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
CONF="${AUTH_EDGE_CONF:-$HERE/auth-edge.conf}"
IMAGE=nginx:1.27.5-alpine
P="${LITT_TEST_PREFIX:-litt-auth-edge-test}-$$"
NET="$P-net"; STUB="$P-stub"
SECRET=$(printf 'a1B2%.0s' {1..8})   # 32 caracteres alfanuméricos, sintético
fails=0

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "omitida: no hay Docker disponible"; exit 0
fi
T=$(mktemp -d)
cleanup() {
  docker rm -f $(docker ps -aq --filter "name=$P-") >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$T"
}
trap cleanup EXIT

check() { # nombre, condición (eval)
  if eval "$2"; then echo "ok   - $1"; else echo "FALLA - $1"; fails=$((fails + 1)); fi
}

docker network create "$NET" >/dev/null
cat > "$T/stub.conf" <<'EOF'
log_format stub 'STUB $request_method $request_uri edge=[$http_x_litt_edge] xff=[$http_x_forwarded_for]';
server {
    listen 9999;
    access_log /dev/stdout stub;
    location / { return 200 "stub\n"; }
}
EOF
docker run -d --name "$STUB" --network "$NET" --network-alias litt-gotrue \
  -v "$T/stub.conf:/etc/nginx/conf.d/default.conf:ro" "$IMAGE" >/dev/null

hits() { docker logs "$STUB" 2>&1 | grep -c '^STUB ' || true; }

# start_edge NOMBRE [VAR=valor ...]: arranca auth-edge con la configuración del
# repositorio como plantilla (igual que compose) y deja el puerto en $PORT.
start_edge() {
  local name="$P-$1"; shift
  local envs=(); for e in "$@"; do envs+=(-e "$e"); done
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" --network "$NET" -p 127.0.0.1::8000 "${envs[@]}" \
    -v "$CONF:/etc/nginx/templates/default.conf.template:ro" "$IMAGE" >/dev/null
  PORT=$(docker port "$name" 8000/tcp | head -1 | sed 's/.*://')
  for _ in $(seq 1 50); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/healthz" || true)" = 200 ] && return 0
    sleep 0.2
  done
  return 1
}
code() { curl -s -o /dev/null -w '%{http_code}' --globoff "$@" || true; }
verify() { code "http://127.0.0.1:$PORT/auth/v1/verify$1" "${@:2}"; }

TOK=$(printf '0123456789abcdef%.0s' {1..3}; printf 'abcdef01')   # 56 hex
RT='https%3A%2F%2Flitt.example.test%2F'

# 1. Solo el tipo invite llega a GoTrue; todo lo demás responde 404 sin llegar.
start_edge tipos "LITT_EDGE_SECRET=$SECRET"
for q in \
  "?token=$TOK&type=invite&redirect_to=$RT" \
  "?token=$TOK&type=invite" \
  "?token=$TOK&type=invite&redirect_to=" \
  "?token=$TOK&type=invite&redirect_to=https://litt.example.test/a?b=c"; do
  before=$(hits); st=$(verify "$q")
  check "invite llega a GoTrue: ${q#?token=*&}" '[ "$st" = 200 ] && [ $(( $(hits) - before )) -eq 1 ]'
done
before=$(hits); verify "?token=$TOK&type=invite&redirect_to=$RT" -H "X-Litt-Edge: $SECRET" -H "X-Forwarded-For: 192.0.2.7" >/dev/null
last=$(docker logs "$STUB" 2>&1 | grep '^STUB ' | tail -1)
check "invite conserva la consulta original" '[[ "$last" == "STUB GET /verify?token=$TOK&type=invite&redirect_to=$RT edge=[-] "* ]]'
check "el secreto no llega a GoTrue" '[[ "$last" == *"edge=[-]"* ]]'

refused=(
  "?token=$TOK&type=recovery"
  "?token=$TOK&type=signup"
  "?token=$TOK&type=email_change"
  "?token=$TOK&type=magiclink"
  "?token=$TOK&type=sms"
  "?token=$TOK&type=phone_change"
  "?token=$TOK&type=reauthentication"
  "?token=$TOK&type=recovery&redirect_to=$RT"
  "?token=$TOK"
  "?token=$TOK&type="
  "?type=invite"
  ""
  "?"
  "?token=$TOK&type=invite&type=recovery"
  "?token=$TOK&type=recovery&type=invite"
  "?type=recovery&token=$TOK&type=invite"
  "?token=$TOK&type=invite&redirect_to=$RT&type=recovery"
  "?token=$TOK&type=invite&redirect_to=$RT&TYPE=recovery"
  "?token=$TOK&TYPE=invite"
  "?token=$TOK&TYPE=recovery&type=invite"
  "?token=$TOK&Type=invite"
  "?token=$TOK&type=Invite"
  "?token=$TOK&type=INVITE"
  "?token=$TOK&type=%69nvite"
  "?token=$TOK&typ%65=invite"
  "?token=$TOK&%74ype=invite"
  "?token=$TOK&type=invite%00"
  "?token=$TOK&type=invite%20"
  "?token=$TOK&type=invite+"
  "?token=$TOK&type=invite%26type%3Drecovery"
  "?token=$TOK&type[]=recovery&type=invite"
  "?token=$TOK&type[]=invite"
  "?token=$TOK&type=invite;type=recovery"
  "?token=$TOK;type=recovery&type=invite"
  "?token=$TOK&type=invite&redirect_to=$RT;type=recovery"
  "?token=$TOK&type=invite&foo=bar"
  "?token=$TOK&type=invite&&"
  "?token=$TOK&type=invite&"
  "?token=$TOK&token=$TOK&type=invite"
  "?token=&type=invite"
  "?token=$TOK%26type=recovery&type=invite"
  "?type=invite&token=$TOK"
)
before=$(hits); bad=0
for q in "${refused[@]}"; do
  st=$(verify "$q"); [ "$st" = 404 ] || { bad=$((bad + 1)); echo "  no se rechazó (HTTP $st): $q"; }
done
check "${#refused[@]} variantes de tipo/consulta responden 404" '[ "$bad" -eq 0 ]'
check "ninguna variante rechazada llega a GoTrue" '[ "$(hits)" -eq "$before" ]'
check "otra ruta sigue en 404" '[ "$(code "http://127.0.0.1:$PORT/auth/v1/verify/?token=$TOK&type=invite")" = 404 ] && [ "$(code "http://127.0.0.1:$PORT/auth/v1/token?type=invite")" = 404 ]'
check "POST sigue denegado" '[ "$(code -X POST "http://127.0.0.1:$PORT/auth/v1/verify?token=$TOK&type=invite")" = 403 ]'

# 2. Límite por dirección. Con el secreto, la clave es X-Forwarded-For; sin él,
# la dirección TCP, y un X-Forwarded-For propio no cambia la clave.
start_edge limite "LITT_EDGE_SECRET=$SECRET"
Q="?token=$TOK&type=invite"
burst() { # n, encabezados...; imprime los códigos separados por espacio
  local n=$1; shift; local out=""
  for _ in $(seq 1 "$n"); do out="$out $(verify "$Q" "$@")"; done; echo "$out"
}
A=(-H "X-Litt-Edge: $SECRET" -H "X-Forwarded-For: 203.0.113.10")
B=(-H "X-Litt-Edge: $SECRET" -H "X-Forwarded-For: 203.0.113.11")
ra=$(burst 30 "${A[@]}")
check "un cliente (con secreto) recibe 429 al pasar el límite" '[[ "$ra" == *429* ]] && [[ "$ra" == " 200"* ]]'
check "otro cliente (con secreto) no lo recibe" '[ "$(verify "$Q" "${B[@]}")" = 200 ]'
check "el cliente limitado sigue limitado" '[ "$(verify "$Q" "${A[@]}")" = 429 ]'

start_edge forjado "LITT_EDGE_SECRET=$SECRET"
n429=0
for i in $(seq 1 30); do
  [ "$(verify "$Q" -H "X-Forwarded-For: 198.51.100.$i")" = 429 ] && n429=$((n429 + 1))
done
check "sin secreto, rotar X-Forwarded-For no evita el límite" '[ "$n429" -gt 0 ]'
n429=0
for i in $(seq 1 30); do
  [ "$(verify "$Q" -H "X-Litt-Edge: ${SECRET}x" -H "X-Forwarded-For: 198.51.100.$i")" = 429 ] && n429=$((n429 + 1))
done
check "con secreto incorrecto tampoco" '[ "$n429" -gt 0 ]'
UP=$(printf '%s' "$SECRET" | tr 'a-z' 'A-Z')
start_edge mayus "LITT_EDGE_SECRET=$SECRET"
n429=0
for i in $(seq 1 30); do
  [ "$(verify "$Q" -H "X-Litt-Edge: $UP" -H "X-Forwarded-For: 198.51.100.$i")" = 429 ] && n429=$((n429 + 1))
done
check "el secreto se compara distinguiendo mayúsculas" '[ "$n429" -gt 0 ]'
# El cliente limitado sin secreto no arrastra a uno de confianza con otra dirección.
check "una dirección de confianza distinta sigue libre" '[ "$(verify "$Q" "${B[@]}")" = 200 ]'
start_edge xff "LITT_EDGE_SECRET=$SECRET"
before=$(hits); st=$(verify "$Q" -H "X-Forwarded-For: 192.0.2.99")
last=$(docker logs "$STUB" 2>&1 | grep '^STUB ' | tail -1)
check "GoTrue no recibe un X-Forwarded-For elegido por quien llama" '[ "$st" = 200 ] && [ $(( $(hits) - before )) -eq 1 ] && [[ "$last" != *192.0.2.99* ]]'
before=$(hits); st=$(verify "$Q" -H "X-Litt-Edge: $SECRET" -H "X-Forwarded-For: 192.0.2.98")
last=$(docker logs "$STUB" 2>&1 | grep '^STUB ' | tail -1)
check "con secreto, GoTrue recibe la dirección del visitante y no el secreto" '[ "$st" = 200 ] && [[ "$last" == *"edge=[-] xff=[192.0.2.98]" ]]'

# 3. Configuración defectuosa: falla del lado seguro.
if start_edge sinvar; then st=up; else st=down; fi
check "sin LITT_EDGE_SECRET en el entorno, nginx no arranca" '[ "$st" = down ] && [ "$(docker inspect -f "{{.State.Running}}" "$P-sinvar")" = false ]'
start_edge vacio "LITT_EDGE_SECRET="
n429=0; n200=0
for i in $(seq 1 30); do
  c=$(verify "$Q" -H "X-Litt-Edge;" -H "X-Forwarded-For: 198.51.100.$i")
  [ "$c" = 429 ] && n429=$((n429 + 1)); [ "$c" = 200 ] && n200=$((n200 + 1))
done
check "con secreto vacío nadie es de confianza (la clave es la dirección TCP)" '[ "$n429" -gt 0 ] && [ "$n200" -gt 0 ]'
n429=0
for i in $(seq 1 30); do
  [ "$(verify "$Q" -H "X-Forwarded-For: 198.51.100.$((100 + i))")" = 429 ] && n429=$((n429 + 1))
done
check "con secreto vacío, sin encabezado tampoco" '[ "$n429" -gt 0 ]'

[ "$fails" -eq 0 ] && echo "todas las pruebas pasaron" || { echo "$fails fallas"; exit 1; }
