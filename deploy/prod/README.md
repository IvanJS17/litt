# LiTT — despliegue de producción (`litt.asteroitt.com`)

Paquete operativo del despliegue al VPS compartido `staging-apps-dev`. Sigue el
patrón de la casa: la app vive en `/srv/litt` con su propio compose (`name: litt`),
**ningún puerto se publica al host**, el borde 80/443 lo sirve el ingress compartido
(`/srv/edge`, contenedor `edge-caddy-1`) con un bloque dedicado, y el respaldo es restic
por app. El VPS es compartido: LiTT cumple las reglas del host (`HOST-RULES.md` del repo
`asteroitt-ops`; copia en `/srv/edge/HOST-RULES.md`): retención de imágenes vivo + 1,
sin `docker system/image/volume prune`, chequeo de espacio antes de cargar, marcador
`/srv/litt/.deploy-in-progress` durante el deploy y presupuesto de disco declarado
(~6 GB: imágenes `litt-*` + Supabase + volúmenes). `litt-deploy.sh` aplica esas reglas
en cada deploy (§1).
Los documentos viven en **Cloudflare R2** (bucket `litt-docs`) y los respaldos
en otro bucket de R2 (`litt-backups`), cada uno con su propio token limitado a
él; no hay object storage local. El correo del sistema sale de
`no-reply@asteroitt.com` por SMTP.

## Piezas

| Archivo | Rol |
|---|---|
| `compose.yaml` | Stack completo (db, auth, rest, db-init, gateway, backend, litt-web, litt-word) |
| `gateway.conf` | Fachada interna de Supabase (gotrue+postgrest) para el backend |
| `auth-edge.conf` | Borde público de GoTrue: solo `GET /auth/v1/verify` del tipo `invite` (enlace del correo de invitación), con límite por visitante |
| `auth-edge.test.sh` | Prueba de `auth-edge.conf` con un nginx real y un upstream de mentira (`bash deploy/prod/auth-edge.test.sh`; se omite sin Docker; CI no la corre) |
| `Caddyfile.litt` | Bloques de `litt.asteroitt.com`, `word.litt.asteroitt.com` y `mcp.litt.asteroitt.com` para el Caddy compartido (marcadores `# BEGIN/END litt`) |
| `.env.example` | Contrato de variables (copiar a `/srv/litt/.env`, 600) |
| `supabase-jwt.py` | Generador de las llaves JWT `anon` / `service_role` |
| `litt-backup.sh` | Respaldo diario (pg_dump + restic en R2; sin documentos, por diseño) |
| `litt-restic.env.example` | Nombres de las variables de `/etc/litt-restic.env` (sin valores) |
| `litt-deploy.sh` | Deploy de un release en el VPS: marcador, espacio, carga verificada, árbol, salud y retención (§1) |
| `image-bytes.sh` | Tamaño en disco de un release para el chequeo de espacio (capas y blobs únicos de las tres imágenes) |
| `litt-deploy.test.sh` | Pruebas de `litt-deploy.sh` con dobles de `docker` y `df` (`bash deploy/prod/litt-deploy.test.sh`) |
| `word-addin-install.md` | Guía de una página para el administrador de Microsoft 365 de cada despacho (§9) |

## Requisitos previos (una vez)

- [ ] Buckets R2 `litt-docs` y `litt-backups` (ya existen), cada uno con su
      token S3 limitado a él; reglas CORS de `litt-docs` para
      `https://litt.asteroitt.com` (PUT/GET de las URLs firmadas).
- [ ] Buzón `no-reply@asteroitt.com` (Neubox) con SPF, DKIM y DMARC (ya
      configurados).
- [ ] Registro DNS `A litt` → `78.47.184.224` (Cloudflare; mismo modo que
      `contextlexmx`).
- [x] Registro DNS `A word.litt` → la misma IP, sin proxy de Cloudflare (§9);
      creado el 2026-11-11.
- [x] Registro DNS `A mcp.litt` → `78.47.184.224`, sin proxy de Cloudflare (§3, MCP);
      vivo desde el 2026-11-17.
- [ ] Imágenes del release construidas desde el commit exacto y verificadas
      (sección 1).

## 1. Imágenes (máquina de build → VPS)

Ningún workflow de CI construye imágenes: desde la sincronización con upstream
de 2026-10-23 la construcción pertenece a este gate de despliegue
([`../../docs/RELEASE_GATES.md`](../../docs/RELEASE_GATES.md), G7). No existen
imágenes verificadas del árbol sincronizado; los IDs de imagen de releases
anteriores no aplican.

**Código fuente correspondiente (AGPL-3.0 §13).** Quien use LiTT por la red
debe poder obtener el código de la versión exacta que corre. Cada imagen lleva
el SHA completo del commit del que se construyó (`--build-arg GIT_SHA`); el
backend lo reporta en `/health` y el frontend lo enlaza como **Código fuente**
(`https://github.com/IvanJS17/litt/tree/<SHA>`) en el pie del inicio de sesión
y en Ajustes → Acerca de. Sin `GIT_SHA` válido, los tres builds (backend,
frontend, add-in de Word) fallan, y el backend en producción no arranca. Por
eso el SHA debe ser un commit **publicado** en `IvanJS17/litt` y el checkout
debe estar limpio: lo construido es exactamente lo que el enlace ofrece.

```bash
# En la máquina de build, desde la raíz de un checkout limpio del commit a desplegar:
SHA=$(git rev-parse HEAD)
test -z "$(git status --porcelain)"                                   # árbol limpio
git fetch origin && git merge-base --is-ancestor "$SHA" origin/main   # publicado en main
gh api "repos/IvanJS17/litt/commits/$SHA" --jq .sha                   # == $SHA (visible en GitHub)
docker build -f backend/Dockerfile  --build-arg GIT_SHA="$SHA" -t "litt-backend:$SHA" .
docker build -f frontend/Dockerfile --build-arg GIT_SHA="$SHA" -t "litt-frontend:$SHA" .
# Complemento de Word (§9). REACT_APP_API_BASE_URL=/api lo fija el Dockerfile.
docker build -f word-addin/Dockerfile --build-arg GIT_SHA="$SHA" \
  --build-arg WORD_ADDIN_PUBLIC_URL=https://word.litt.asteroitt.com \
  --build-arg REACT_APP_WEB_APP_URL=https://litt.asteroitt.com \
  -t "litt-word:$SHA" .
for i in backend frontend word; do                                     # revisión == SHA; anotar el Id en el recibo
  docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}} {{.Id}}' "litt-$i:$SHA"
done
BID=$(docker image inspect --format '{{.Id}}' "litt-backend:$SHA")
FID=$(docker image inspect --format '{{.Id}}' "litt-frontend:$SHA")
WID=$(docker image inspect --format '{{.Id}}' "litt-word:$SHA")
# Tamaño en disco del release (capas descomprimidas + blobs comprimidos, cada uno una
# sola vez; así guarda las imágenes el almacén de containerd del VPS). Falla si falta
# alguna imagen: no se sigue con un BYTES incompleto.
BYTES=$(bash deploy/prod/image-bytes.sh "$SHA") || { echo "no se pudo medir BYTES"; exit 1; }
echo "BYTES=$BYTES"
# Deploy (el árbol del release viaja aparte; las imágenes, por stdin y sin copias en disco):
scp deploy/prod/litt-deploy.sh staging-apps-dev:/tmp/litt-deploy.sh
git archive --format=tar.gz "$SHA" | ssh staging-apps-dev "cat > /tmp/litt-$SHA.tar.gz"
docker save "litt-backend:$SHA" "litt-frontend:$SHA" "litt-word:$SHA" | gzip -1 | ssh staging-apps-dev \
  bash /tmp/litt-deploy.sh "$SHA" "$BYTES" "$BID" "$FID" "$WID" "/tmp/litt-$SHA.tar.gz"
```

`litt-deploy.sh` corre en el VPS como el dueño de `/srv/litt` y sigue las reglas del
host (`HOST-RULES.md` §3–§5):

1. Crea `/srv/litt/.deploy-in-progress` al empezar y lo borra al terminar, también si
   falla (`trap`). Mientras exista, el guardián de disco del host no retira imágenes.
2. **Antes de cargar** comprueba que haya libres al menos `max(7 GiB, 2 × BYTES + 5 GiB)`.
   `BYTES` es el tamaño en disco del release que da `image-bytes.sh` en la máquina de build:
   capas descomprimidas más blobs comprimidos, cada uno una sola vez, porque así guarda las
   imágenes el almacén de containerd del VPS. No es la suma de los tamaños de las tres
   imágenes, que cuenta tres veces la base compartida `node:22-slim`. Si no alcanza, **aborta sin tocar nada**: no
   retira ninguna imagen, así que la viva y la anterior siguen cargadas y producción queda
   intacta. Para liberar espacio, hacerlo a mano (por tag explícito, nunca `prune`) y
   volver a lanzar el deploy.
3. Carga las imágenes y compara sus IDs con los de la máquina de build.
4. Reemplaza el árbol del release. Lo extrae aparte y lo sincroniza con `rsync`, de modo
   que el árbol nunca queda vacío mientras corren los contenedores, que montan archivos
   de él. Conserva `.env` y `backups/`, y fija `LITT_SOURCE_COMMIT` y `RELEASE_SHA`.
5. `up -d --remove-orphans` (corre `db-init`, que aplica migraciones pendientes) y espera
   a que todo servicio de larga vida esté corriendo, healthy si tiene healthcheck (`rest`
   no tiene), a que `/health` reporte el SHA y a que `litt-word` sirva un `manifest.xml`
   cuyo panel apunta a `WORD_ADDIN_URL` del `.env` (una imagen construida con otra URL
   pública aborta el deploy). Sin `WORD_ADDIN_URL` ni `LITT_EDGE_SECRET` en el `.env`, el script aborta
   antes de cargar nada.
6. Solo entonces aplica la retención: imagen viva + 1 anterior, retirando el resto por tag
   explícito. Nunca usa `docker system/image/volume/builder prune`.

**Chequeo de la imagen del frontend (paso 3, antes de tocar el árbol).** Con `--network none`,
`litt-deploy.sh` busca dentro de `litt-frontend:<SHA>` las rutas que solo sirven para desarrollo
(`node_modules/@parcel/watcher`, `micromatch` y `@opennextjs`). Si encuentra alguna, aborta
antes de sincronizar el árbol o tocar los contenedores: la versión viva sigue igual. Así se
comprueba de verdad la afirmación `notInProductionImage` de `scripts/audit-allowlist.json`. En
el registro del despliegue aparece la línea «imagen del frontend sin rutas solo de desarrollo»
cuando la comprobación pasa.

**Rollback:** la imagen anterior siempre sigue cargada en el VPS: el deploy nunca retira
imágenes antes de cargar (si falta espacio, el paso 2 aborta sin tocar nada) y la retención del
paso 6 conserva la viva + 1 anterior. Se corre el mismo procedimiento con el SHA anterior: las
imágenes se mandan por stdin, reconstruyéndolas en la máquina de build desde ese commit (o con
`docker save` desde el VPS, donde siguen cargadas), y el árbol sale de `git archive` de ese
commit.

La etiqueta de las imágenes es el SHA completo y queda en `.env` como
`LITT_SOURCE_COMMIT`; `compose.yaml` no arranca sin ella. El contexto de build
es la raíz del repositorio (los Dockerfiles copian `packages/contracts`). El
deploy NO compila en el VPS; la comparación de IDs tras `docker load` ata el
deploy a los bytes construidos y verificados. La imagen del complemento de Word
lleva el mismo SHA; su enlace **Código fuente** está en Ajustes del panel.

**Sin secretos en lo que se ofrece.** El código ofrecido es el árbol público de
GitHub en ese SHA. Los secretos viven solo en `/srv/litt/.env` (fuera de Git,
§3) y el workflow `Secret scan` ([`.github/workflows/gitleaks.yml`](../../.github/workflows/gitleaks.yml))
escanea con gitleaks todo el historial en cada PR y en cada push a `main`.
Antes de construir, comprobar que su corrida en el commit desplegado está en
verde: `gh run list --repo IvanJS17/litt --workflow gitleaks.yml --commit "$SHA"`.

## 2. Árbol del release (VPS)

`litt-deploy.sh` extrae en cada deploy el árbol del SHA desplegado. Solo la primera
vez hay que crear el directorio. El dueño es `ivan`, igual que en `/srv/contextlex-mx`:

```bash
sudo -n mkdir -p /srv/litt && sudo -n chown ivan:ivan /srv/litt
```

## 3. Secretos (`/srv/litt/.env`, 600)

```bash
cp deploy/prod/.env.example /srv/litt/.env && chmod 600 /srv/litt/.env
# POSTGRES_PASSWORD, JWT_SECRET, DOWNLOAD_SIGNING_SECRET, USER_API_KEYS_ENCRYPTION_SECRET,
# AUTH_HANDOFF_ENCRYPTION_SECRET (uno distinto para cada uno):
openssl rand -hex 32
# Llaves de Supabase:
JWT_SECRET=<el de arriba> python3 deploy/prod/supabase-jwt.py anon
JWT_SECRET=<el de arriba> python3 deploy/prod/supabase-jwt.py service_role
# R2 (litt-docs) y SMTP: ver la tabla de abajo.
```
Nunca imprimir el contenido del `.env`.

### Tiempos del proveedor (opcionales)

| Variable | Valor en compose | Uso |
|---|---|---|
| `STREAM_CHUNK_TIMEOUT_MS` | `180000` (ms; rango 5000–1800000) | Silencio máximo entre salidas (texto, razonamiento, llamada a herramienta) de un modelo antes de abortar con «stopped responding». Los comentarios SSE de OpenRouter (`: OPENROUTER PROCESSING`) y los eventos `event: ping` de Anthropic reinician este reloj y el de primera salida; una conexión sin bytes aborta igual. Sin definirla en `/srv/litt/.env` rige el valor por defecto de compose; el valor por defecto del código (60000) solo aplica fuera de compose. |

### Checklist: de dónde sale cada secreto

Los valores viven en Bitwarden Secrets Manager; se pasan al VPS con `bws run`
o por un canal seguro, sin imprimirlos ni copiarlos a Git, al chat o a un
recibo. Los que no salen de Bitwarden se generan en el VPS.

| Variable | Archivo en el VPS | Origen |
|---|---|---|
| `R2_ENDPOINT_URL` | `/srv/litt/.env` | BWS `LITT_R2_ENDPOINT_URL` |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `/srv/litt/.env` | BWS `LITT_R2_DOCS_*` (token del bucket `litt-docs`) |
| `GOTRUE_SMTP_PASS` | `/srv/litt/.env` | BWS `NO_REPLY_ASTEROITT` (buzón `no-reply@asteroitt.com`) |
| `POSTGRES_PASSWORD`, `JWT_SECRET`, `DOWNLOAD_SIGNING_SECRET`, `USER_API_KEYS_ENCRYPTION_SECRET`, `AUTH_HANDOFF_ENCRYPTION_SECRET` | `/srv/litt/.env` | `openssl rand -hex 32` en el VPS |
| `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `/srv/litt/.env` | `supabase-jwt.py` con el `JWT_SECRET` de arriba |
| `RESTIC_REPOSITORY` | `/etc/litt-restic.env` | `s3:` + valor de `LITT_R2_ENDPOINT_URL` + `/litt-backups` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `/etc/litt-restic.env` | BWS `LITT_R2_BACKUPS_*` (token del bucket `litt-backups`) |
| `RESTIC_PASSWORD` | `/etc/litt-restic.env` | BWS `LITT_RESTIC_PASSWORD` |

Opcionales (apagados o vacíos por defecto): `TYPESAFE_API_KEY` es una llave **de la
plataforma** (verificación de citas; con `LITT_CITATION_CHECK=enabled`, ver
`docs/citation-support-check.md`) y las variables `GOOGLE_*` configuran los conectores
de Google (`docs/google-workspace.md`); sin cliente OAuth ninguno se puede conectar, y
sin `GOOGLE_WORKSPACE_DISABLED_PROVIDERS` Drive queda apagado.

`LITT_MCP_SERVER` (`disabled` por defecto) enciende el servidor de autorización OAuth y el
endpoint `/mcp` del backend (`docs/mcp-server.md`). Con `enabled` hace falta
`LITT_MCP_PUBLIC_URL`, el origen https del host MCP (el emisor de los tokens y la URL del
recurso son `<origen>` y `<origen>/mcp`); sin él, en producción el servidor queda apagado y el
arranque lo avisa en el log. `LITT_MCP_ALLOWED_ORIGINS` lista los orígenes de navegador que
pueden llamar a `/mcp` (vacío: ninguno; Claude, ChatGPT y Hermes llaman sin `Origin`). El
host MCP de producción es `https://mcp.litt.asteroitt.com`: registro A sin proxy de
Cloudflare hacia el VPS y el bloque `mcp.litt.asteroitt.com` de `Caddyfile.litt`, que solo deja
pasar `/mcp`, `/oauth/*` y los `.well-known` de OAuth y los reenvía al gateway `/api` de la web
(`litt:3000`), igual que el resto de la API. Para encenderlo: `LITT_MCP_SERVER=enabled` y
`LITT_MCP_PUBLIC_URL=https://mcp.litt.asteroitt.com` en `/srv/litt/.env`, y recrear el backend.
Está encendido en producción desde el 2026-11-17 (`20261117c`). Comprobación desde fuera:
`/.well-known/oauth-authorization-server` → 200; `POST /mcp` sin token → 401 con
`resource_metadata`; `/` del host MCP → 404 (por diseño: solo deja pasar las rutas de MCP y OAuth).
Las tablas MCP necesitan `GRANT ... TO service_role` en su propia migración (PR #229).

Los demás valores del `.env` no son secretos y ya vienen en `.env.example`:
el bucket, el host, el puerto y el usuario SMTP y el remitente.

## 4. Primer arranque

Solo en una base vacía; los deploys siguientes usan `litt-deploy.sh` (§1). Para esta
primera vez, extraer el árbol a mano (`git archive` → `tar -xzf` en `/srv/litt`) y
cargar las imágenes antes de arrancar:

```bash
cd /srv/litt
C="docker compose --env-file .env -f deploy/prod/compose.yaml"
$C up -d db auth rest gateway        # base + auth (el init de postgres tarda ~2-5 min)
$C up db-init                        # esquema completo + migraciones pendientes (one-shot)
$C up -d --remove-orphans            # backend + litt-web + litt-word
$C ps                                # todo healthy
```

## 5. Caddy compartido (quirúrgico)

El bloque manda todo a `litt:3000` (servicio `litt-web`), salvo `/auth/v1/verify`, que va
a `litt-auth:8000` (`auth-edge`). Esa es la ruta del enlace del correo de
invitación. Los correos de confirmación, recuperación y cambio de correo apuntan
a `/auth/confirm` (§Decisiones y pendientes) y no usan esa ruta. `auth-edge`
responde 404 a cualquier otra ruta y a cualquier consulta que no sea
exactamente `token=…&type=invite[&redirect_to=…]`, así que la red del Caddy
compartido no alcanza el signup, el token, la API admin ni PostgREST, y GoTrue
no recibe otro tipo de enlace por aquí.

Un deploy normal no toca el Caddyfile. Para cambiar el bloque `litt` hay que seguir
`HOST-RULES.md` §1: respaldar `/srv/edge/conf/Caddyfile` y probar **todos** sus dominios
antes y después de recargar. Si cambió algún dominio ajeno, restaurar el respaldo y
recargar de nuevo; `caddy validate` no detecta que se perdió el bloque de otra app.

```bash
C=/srv/edge/conf/Caddyfile; B="$C.bak-$(date -u +%Y%m%dT%H%M%SZ)"; sudo -n cp "$C" "$B"
probe() { for d in $(grep -oE '^[a-z0-9.-]+\.[a-z]+ \{' "$B" | cut -d' ' -f1 | sort -u); do
  printf '%s %s\n' "$d" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$d/")"; done; }
probe > /tmp/edge.before
# Editar SOLO entre `# BEGIN litt` y `# END litt` (contenido de deploy/prod/Caddyfile.litt).
sudo -n docker exec edge-caddy-1 caddy validate --config /etc/caddy/Caddyfile
sudo -n docker exec edge-caddy-1 caddy reload   --config /etc/caddy/Caddyfile
probe > /tmp/edge.after; diff /tmp/edge.before /tmp/edge.after   # si cambió uno ajeno: sudo -n cp "$B" "$C" y recargar
```

`/srv/edge/conf/` se monta como directorio, así que editar el archivo en sitio es seguro
(el antiguo bind de archivo suelto dejaba al Caddy leyendo una copia vieja).

**Nombres en la red compartida.** Solo `litt-web` (alias `litt`), `auth-edge` (alias
`litt-auth`) y `litt-word` (alias `litt-word`) entran a la red del ingress, `edge`, que comparten otras apps. Compose da a cada servicio
su nombre como alias en todas sus redes, así que esos servicios deben tener nombres
únicos en el host (`frontend`, `backend` y `web` ya son de otras apps) y sus llamadas
internas usan alias propios (`litt-backend`, `litt-gotrue`). Antes de agregar un
servicio a esa red, revisar `docker network inspect edge`.

## Dirección del cliente (límites por IP)

El backend limita por IP (inicio de sesión, registro, correos, MCP y el límite
general) y toma la dirección del último valor de `X-Forwarded-For` que le manda
el salto de la app (`litt-web` o `litt-word`); por eso `compose.yaml` fija
`TRUST_PROXY_HOPS: '1'`. El Caddy y una CDN no cuentan como saltos: el salto de
la app reenvía exactamente una dirección.

**Secreto del borde.** `LITT_EDGE_SECRET` es un valor aleatorio que el Caddy
compartido manda en `X-Litt-Edge` (con `X-Forwarded-For {client_ip}`, ver
`Caddyfile.litt`). `litt-web` y `litt-word` solo aceptan la dirección que
reciben si ese encabezado coincide con su propia variable; en cualquier otro caso
usan la dirección del contenedor que les habló, ignoran su `X-Forwarded-For` y
nunca reenvían `X-Litt-Edge`. Debe tener **el mismo valor en dos lugares**:
`/srv/litt/.env` (compose no arranca sin él) y el entorno del contenedor
`edge-caddy-1` (el compose de `/srv/edge`, fuera de este repositorio). Se genera
con `openssl rand -hex 32` y no se imprime ni se copia a Git.

**Orden seguro del despliegue.**

1. Poner `LITT_EDGE_SECRET` en `/srv/litt/.env` y en el entorno del Caddy
   compartido, y recrear `edge-caddy-1` para que lo lea (`caddy reload` no
   actualiza el entorno del proceso).
2. Aplicar el bloque nuevo de `Caddyfile.litt` con el procedimiento de §5. Las
   imágenes anteriores siguen funcionando igual: reciben la dirección única y
   copian `X-Litt-Edge` al backend por la red interna, que no lo registra. Por
   eso conviene no dejar pasar tiempo entre este paso y el siguiente.
3. Desplegar las imágenes nuevas (§1), que ya leen el secreto. Ese `up -d`
   recrea `auth-edge` (cambia su entorno y su plantilla); cualquier cambio
   posterior solo a `auth-edge.conf` exige recrearlo a mano para que lo lea:
   `$C up -d --force-recreate auth-edge`.

El bloque del Caddy y `auth-edge` dependen de la misma cadena: el orden de los
pasos 1 a 3 sirve también para `/auth/v1/verify`, y aquí no es opcional. Si el
Caddy no manda el secreto cuando `auth-edge` ya lo exige, todos los visitantes
comparten un solo cupo (el de la dirección del Caddy): unas pocas solicitudes
de cualquiera bastan para que las invitaciones de los demás respondan 429
mientras dure ese estado. Se nota en el log de `auth-edge`
(`$C logs auth-edge | grep 'limiting requests'` muestra la dirección del Caddy
en vez de la de un visitante); se corrige completando los pasos 1 y 2.

**Límite en `/auth/v1/verify` (`auth-edge`).** `auth-edge` también recibe
`LITT_EDGE_SECRET` (compose no arranca sin él) y usa la misma regla: con
`X-Litt-Edge` igual al secreto toma la dirección de `X-Forwarded-For` que manda
el Caddy; en cualquier otro caso usa la dirección TCP de quien llama y ignora su
`X-Forwarded-For` (un contenedor vecino de la red `edge` que le hable directo
queda limitado por su propia dirección). A GoTrue nunca le llega `X-Litt-Edge`;
su `X-Forwarded-For` es esa dirección. Si la variable queda vacía nadie es de
confianza; si no está definida, nginx no arranca (compose ya lo impide). El
límite es de 10 solicitudes por minuto por dirección, con una ráfaga de 10 más;
el resto recibe 429. Una persona que abre su invitación hace una solicitud (un
escáner de correo o un reintento suman pocas); una oficina entera detrás de una
sola dirección tendría que abrir más de 20 invitaciones en el mismo minuto para
notarlo. El límite acota el volumen por visitante; no es la única protección de
los enlaces. Los valores están en `auth-edge.conf` (`rate=10r/m`, `burst=10`).
Un 429 no gasta la invitación: el mismo enlace funciona al reintentar. Si GoTrue
no pudiera descargar las plantillas de LiTT usaría las suyas, cuyos enlaces de
confirmación, recuperación y cambio de correo apuntan a esta ruta y aquí reciben
404; hay que restablecer las plantillas (`$C restart auth`) y pedir el correo de
nuevo.

**Falla por secreto ausente o distinto** (en `.env` o en el Caddy): los saltos
tratan al Caddy como no confiable y el backend ve la dirección del salto, no la
del visitante. Todos los visitantes comparten un solo cupo de límite por IP:
falla del lado seguro, pero molesta (llegan 429 a todos). Se corrige igualando el
valor.

**Comprobación posterior (solo lectura).** Sin imprimir el secreto:
`docker exec edge-caddy-1 sh -c 'test -n "$LITT_EDGE_SECRET" && echo definido'`;
`docker exec litt-litt-web-1 sh -c 'test -n "$LITT_EDGE_SECRET" && echo definido'`
(y `litt-litt-word-1`); comparar `sha256sum` de los tres valores (cada contenedor
con `printf %s "$LITT_EDGE_SECRET" | sha256sum`), que deben ser iguales;
`caddy validate`; y desde dos redes distintas, `curl -s -o /dev/null -w '%{http_code}\n'
https://litt.asteroitt.com/api/health` debe responder 200 sin 429 para ninguna.
La comparación de `sha256sum` es la que detecta un valor distinto antes de que
alguien reciba un 429.

El Caddy en nivel de log `debug` escribe los encabezados que manda, incluido
`X-Litt-Edge`: no activarlo en producción, o rotar el secreto después.

**Rotación.** Generar un valor nuevo; ponerlo en `/srv/litt/.env` y en el entorno
del Caddy; recrear `litt-web` y `litt-word` (`$C up -d litt-web litt-word`) y
`edge-caddy-1` en la misma ventana. Entre ambos pasos hay una ventana corta en la
que se aplica la falla descrita arriba. No hay periodo de convivencia de dos
valores.

**El día que se encienda Cloudflare** hacen falta dos cambios más, ambos en el
servidor y fuera de este repositorio:

1. En las opciones globales del Caddy compartido, **antes** de activar el
   proxy de Cloudflare:

   ```
   {
       servers {
           trusted_proxies static <rangos de Cloudflare>
           client_ip_headers CF-Connecting-IP
       }
   }
   ```

   Con eso `{client_ip}` es el visitante real; sin ello sería la dirección de
   Cloudflare. El bloque es global: aplica a todos los sitios de ese Caddy, no
   solo a los de LiTT.
2. **Después** de activar el proxy, cerrar 80/443 a todo lo que no sea
   Cloudflare (firewall del host), para que el tráfico público entre solo por
   Cloudflare.

El orden acordado es desplegar primero esta cadena y después encender
Cloudflare. Queda aparte, sin hacer aquí, mover `litt-web`, `litt-word` y
`auth-edge` a una red de ingreso solo de LiTT (hoy comparten `edge` con otras apps).

## Cabeceras de seguridad de las páginas

Las páginas de la web y del complemento de Word (no el Caddy) envían estas
cabeceras; el código las define, así que un deploy normal no toca el Caddyfile:

| Cabecera | Valor |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (sin `preload`) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | cámara, micrófono, geolocalización, pagos y USB desactivados |
| `X-Frame-Options` | `DENY` en la web (el complemento de Word no la envía: Word lo enmarca) |
| `Content-Security-Policy` | web: `frontend/src/proxy.ts` (un nonce por petición) y `frontend/src/app/lib/securityHeaders.ts`; complemento: `word-addin/server.mjs` |

En `/api/*` de la web, estas cabeceras reemplazan a las del backend con el mismo
nombre (HSTS, marco), salvo `Referrer-Policy`, que ahí conserva el valor del
backend (`no-referrer`); en el proxy del complemento prevalecen las del
backend. El Caddy no
agrega ninguna de estas cabeceras: no repetirlas en `Caddyfile.litt`, porque una
copia con otro valor se sumaría a la del código (dos `Content-Security-Policy`
se aplican las dos).

**Variables** (las leen `litt-web` y `litt-word`; `compose.yaml` ya las pasa):

- `R2_ENDPOINT_URL`: de ahí sale el origen del almacén al que el navegador
  sube y baja archivos con URL firmadas (`connect-src` e `img-src`). Este
  `compose.yaml` no pasa `R2_PUBLIC_ENDPOINT_URL` a ningún servicio; el código
  la prefiere cuando existe (como el backend), y así la usa el entorno local.
  Si el valor no coincide con el que firma el backend, las subidas de archivos
  fallan en el navegador.
- `LITT_CSP_REPORT_ONLY` (vacío por defecto = la política **se aplica**).
  Con `true` o `1` la política se envía como `Content-Security-Policy-Report-Only`:
  el navegador solo anota las violaciones en su consola y no bloquea nada.
  Es el retroceso sin cambio de código si una pantalla se rompe tras un deploy:
  poner `LITT_CSP_REPORT_ONLY=true` en `/srv/litt/.env` y recrear los
  contenedores (`$C up -d litt-web litt-word`). `X-Frame-Options` y el resto de
  las cabeceras siguen aplicándose. No hay endpoint de reportes.

Comprobación tras un deploy (`/connect/authorize` y `/login` deben traer
`frame-ancestors 'none'` y `X-Frame-Options: DENY`; el panel de Word, un
`frame-ancestors` con los orígenes de Office y ningún `X-Frame-Options`):

```bash
curl -sI https://litt.asteroitt.com/login | grep -i 'content-security\|x-frame\|strict-transport'
curl -sI https://word.litt.asteroitt.com/taskpane.html | grep -i 'content-security\|x-frame\|strict-transport'
```

Los orígenes de Microsoft que pueden enmarcar el panel
(`OFFICE_FRAME_ANCESTORS` en `word-addin/server.mjs`) no salen de una lista
oficial: Microsoft no publica una para las páginas que enmarcan un complemento.
Abrir el panel en Word en la web (desde OneDrive y desde SharePoint) y en Word de
escritorio antes de dar el deploy por bueno; si la consola del navegador reporta
un origen que falta, agregarlo a esa lista.

## 6. DNS

Registro `A litt` → `78.47.184.224` en Cloudflare (igual que `contextlexmx`).
Verificar propagación con DoH (`cloudflare-dns.com/dns-query`); el certificado
ACME lo emite Caddy solo cuando el DNS resuelve.

## 7. Respaldo (restic en Cloudflare R2)

1. Destino: el bucket R2 `litt-backups`, que ya existe, con su propio token S3
   limitado a ese bucket. No se usa el token de `litt-docs`. Hetzner Object
   Storage queda como destino futuro posible, cambiando solo `RESTIC_REPOSITORY`
   y su token.
   **Custodia:** `RESTIC_PASSWORD` vive en Bitwarden (`LITT_RESTIC_PASSWORD`)
   además de en el VPS; sin ella el respaldo no se puede restaurar.
2. En el VPS, crear `/etc/litt-restic.env` (600 root:root) a partir de
   `deploy/prod/litt-restic.env.example`, con los valores de la checklist de
   §3 y sin imprimirlos:
   `RESTIC_REPOSITORY=s3:https://<account-id>.r2.cloudflarestorage.com/litt-backups`,
   `RESTIC_PASSWORD`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y
   `AWS_DEFAULT_REGION=auto`. La primera vez, `restic init` con ese entorno
   cargado.
3. `install -m 700 -o root -g root deploy/prod/litt-backup.sh /usr/local/sbin/litt-backup.sh`
   + `sha256sum` comparado en ambos lados.
4. Cron (root, sin pisar): `45 3 * * * /usr/local/sbin/litt-backup.sh >> /var/log/litt-backup.log 2>&1`
5. Correrlo una vez y **probar la restauración con profundidad**:
   `restic restore latest --target /tmp/litt-restore` →
   `pg_restore --list /tmp/litt-restore/srv/litt/backups/db.dump` (dump legible) →
   carga en una base temporal aislada (`createdb` + `pg_restore` + conteos
   mínimos dentro del contenedor `db`) → borrar la base temporal.
   El script verifica los secretos fail-closed (regulares, modo 600, dueño
   confiable) e integridad (`restic check` diario; `--read-data-subset=10%` el
   día 01).
6. **Retención: 30 respaldos diarios** (`restic forget --keep-daily 30
   --prune`), sin semanales ni mensuales (decisión del dueño, 2026-10-24). Es
   lo que hace verdadero el recibo de borrado de cuenta: los respaldos nunca se
   editan, y la última copia que contiene una cuenta borrada se elimina 30 días
   después del borrado. `keep-daily` cuenta días *con* respaldo: si el cron
   deja de correr, las copias viejas sobreviven esos días de más, así que una
   falla del respaldo se atiende el mismo día.

## 8. Verificación final (con Iván en el navegador)

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://litt.asteroitt.com          # 200 (login)
curl -s https://litt.asteroitt.com/api/health                     # {"ok":true,"commit":"<SHA>"}
curl -s https://word.litt.asteroitt.com/api/health                # el mismo, por el complemento de Word (§9)
```
`/api/health` debe mostrar el `LITT_SOURCE_COMMIT` desplegado.

El enlace **Código fuente** no se comprueba con `curl`: `/login` se entrega
como una página que el navegador arma al cargar, así que el HTML que devuelve
`curl` no contiene el enlace. Se comprueba en el navegador:

1. Abrir `https://litt.asteroitt.com/login`.
2. Al pie, el enlace **Código fuente** debe abrir
   `https://github.com/IvanJS17/litt/tree/<SHA>` con el mismo
   `LITT_SOURCE_COMMIT`, y GitHub debe mostrar ese commit (no un 404).
3. Repetir en Ajustes → Acerca de y en el add-in de Word (Ajustes).
Luego: abrir en el navegador y crear la cuenta del owner. Debe llegar el
correo de confirmación de `LiTT <no-reply@asteroitt.com>`, con un enlace a
`https://litt.asteroitt.com/auth/confirm…` que, al abrirlo, regresa a la app
con la cuenta confirmada. Si no llega, revisar `$C logs auth` (sin imprimir el
`.env`). Después, dar de alta la llave de IA (Ajustes) y subir un documento de
prueba. Comprobar también «Olvidé mi contraseña» con la misma cuenta.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://litt.asteroitt.com/auth/v1/signup   # 404 (auth-edge solo expone /verify)
curl -s -o /dev/null -w '%{http_code}\n' 'https://litt.asteroitt.com/auth/v1/verify?token=x&type=recovery'   # 404 (solo type=invite)
```

### Publicar el release de producción

Solo después de una verificación final correcta (arriba), publica un release de
GitHub. Cada despliegue a producción tiene su release, con la etiqueta
`prod-YYYYMMDDx`, donde `x` es una letra que distingue despliegues del mismo día.
Usa el `RELEASE_SHA` que quedó fijado en el VPS (el mismo que reporta `/api/health`):

```bash
SHA=<RELEASE_SHA desplegado>
gh release create prod-YYYYMMDDx --repo IvanJS17/litt --target "$SHA" \
  --title "prod-YYYYMMDDx" --notes "Despliegue de producción. Commit: $SHA"
```

Antes, revisa `gh release list --repo IvanJS17/litt` para no reutilizar una
etiqueta. El release no sustituye a la verificación: no lo publiques si el
despliegue falló o si `/api/health` no reporta ese SHA.

## 9. Complemento de Word (`word.litt.asteroitt.com`)

Decisión de Iván (7-nov-2026): el complemento se publica en
`https://word.litt.asteroitt.com` con un manifiesto propio de LiTT, y el
administrador de Microsoft 365 de cada despacho lo instala para todos desde
«Aplicaciones integradas» (implementación centralizada) siguiendo
[`word-addin-install.md`](word-addin-install.md). AppSource queda para después.

**Servicio.** `litt-word` (imagen `litt-word:<SHA>`, puerto interno 3200) sirve el
panel, `manifest.xml` y los iconos, y reenvía `/api/*` a `http://litt-backend:3001`
(`WORD_ADDIN_BACKEND_ORIGIN`). Así la API queda en el mismo origen que el panel y la
cookie de sesión es de primera parte en Word de escritorio y en la web. Solo los
archivos con hash de contenido se guardan en caché como inmutables; `manifest.xml`,
el HTML y los iconos van con `no-cache`.

**Manifiesto.** `word-addin/manifest.xml` es la fuente; el build
(`scripts/build-manifest.js`) cambia `https://localhost:3200` por
`WORD_ADDIN_PUBLIC_URL` y deja el resultado en `dist/manifest.xml`, que es lo que se
publica en `https://word.litt.asteroitt.com/manifest.xml`. El `<Id>` de LiTT es
`462ba401-01f2-4b55-ad88-f4722c3a29fa` y **no cambia nunca**: Microsoft 365 identifica
el complemento por él, y uno nuevo obligaría a cada despacho a quitarlo e instalarlo
de nuevo. Cada cambio del manifiesto sube `<Version>`.

**Variables** (`/srv/litt/.env`, §3; nunca en el repo):

| Variable | Valor | Uso |
|---|---|---|
| `WORD_ADDIN_URL` | `https://word.litt.asteroitt.com` | El backend acepta ese origen, usa cookies particionadas para Word en la web y habilita el traspaso de sesión. También forma la segunda entrada de `GOTRUE_URI_ALLOW_LIST`. `compose.yaml` y `litt-deploy.sh` no arrancan sin ella. |
| `AUTH_HANDOFF_ENCRYPTION_SECRET` | `openssl rand -hex 32` en el VPS | Cifra los boletos del traspaso de sesión. El backend no arranca si falta o tiene menos de 32 caracteres con `WORD_ADDIN_URL` puesto. |

La URL de regreso del inicio de sesión con un proveedor externo dentro de Word es
`https://word.litt.asteroitt.com/oauth-dialog.html`. En GoTrue va en
`GOTRUE_URI_ALLOW_LIST` (lista separada por comas; GoTrue v2.189.0 la lee como
`URIAllowList []string`), y `compose.yaml` ya la arma como
`${PUBLIC_URL},${WORD_ADDIN_URL}/oauth-dialog.html`. Hoy no hay proveedores externos
activos (`GOTRUE_EXTERNAL_GOOGLE_ENABLED=false`); la entrada deja listo el día en que
se active uno. La tabla del traspaso (`20260825_01_auth_handoff_tickets.sql`) ya está
en el esquema y en las migraciones que aplica `db-init`.

**DNS.** `A word.litt` → `78.47.184.224`, la misma IP que `litt`, **sin proxy de
Cloudflare (nube gris)**: el certificado universal de Cloudflare cubre
`*.asteroitt.com` pero no un segundo nivel como `*.litt.asteroitt.com`, así que con
proxy el navegador no tendría un certificado válido. Caddy emite el suyo por ACME en
cuanto el nombre resuelve a la IP. Verificar con DoH (`cloudflare-dns.com/dns-query`)
antes de recargar Caddy.

**Caddy.** `Caddyfile.litt` trae los bloques `word.litt.asteroitt.com` y `mcp.litt.asteroitt.com` →
`litt-word:3200` dentro de los mismos marcadores `# BEGIN litt` / `# END litt`. Se
aplica con el procedimiento de §5: respaldo, `probe` de **todos** los dominios antes,
editar solo entre los marcadores, `caddy validate`, `caddy reload`, `probe` después y
`diff`. Si cambió un dominio ajeno, restaurar el respaldo y recargar. `word.litt`
aparece en el `probe` de después (el de antes no lo conoce), lo esperado es `200`.

El 2026-11-11 el bloque de `word.litt.asteroitt.com` que está en vivo en el Caddy
compartido ya coincide con el de `Caddyfile.litt`.

### Checklist de la primera publicación

1. [ ] Este PR revisado y en `main`; el SHA de `main` es el que se construye (§1).
2. [ ] En `/srv/litt/.env` (sin imprimirlo): agregar `WORD_ADDIN_URL=https://word.litt.asteroitt.com`
       y `AUTH_HANDOFF_ENCRYPTION_SECRET=<openssl rand -hex 32>`. Comprobar con
       `grep -c '^WORD_ADDIN_URL=\|^AUTH_HANDOFF_ENCRYPTION_SECRET=' /srv/litt/.env` → `2`.
3. [x] DNS `A word.litt` → `78.47.184.224`, sin proxy; resuelve por DoH
       (hecho el 2026-11-11).
4. [ ] Construir las tres imágenes y desplegar con `litt-deploy.sh` (§1). El script
       comprueba que `litt-word` esté healthy y que su manifiesto apunte a `WORD_ADDIN_URL`.
5. [ ] Caddy: bloque `word.litt.asteroitt.com` con el procedimiento de §5; ningún dominio
       ajeno cambia en el `diff`.
6. [ ] Verificar desde fuera:
       ```bash
       curl -s https://word.litt.asteroitt.com/health                      # {"ok":true}
       curl -s https://word.litt.asteroitt.com/manifest.xml | grep -c 'word.litt.asteroitt.com'   # > 0
       curl -s https://word.litt.asteroitt.com/manifest.xml | grep -c localhost                   # 0
       curl -s https://word.litt.asteroitt.com/api/health                  # {"ok":true,"commit":"<SHA>"}
       curl -s -o /dev/null -w '%{http_code}\n' https://word.litt.asteroitt.com/taskpane.html     # 200
       ```
7. [ ] Prueba con Iván: instalación manual (sideload) en Word en la web con ese
       `manifest.xml` (`word-addin-install.md` §Instalación manual), inicio de sesión,
       una pregunta en el chat con respuesta en streaming y el enlace **Código fuente** de
       Ajustes → `https://github.com/IvanJS17/litt/tree/<SHA>`.
8. [ ] Entregar `word-addin-install.md` al administrador de Microsoft 365 del primer
       despacho.

En los deploys siguientes basta el paso 4. Si cambia el manifiesto (nueva `<Version>`),
el administrador lo actualiza desde «Aplicaciones integradas» (ver la guía).

## Decisiones y pendientes conocidos

- **Drive (Google): NO activado** — la publicación a Drive no tiene conector
  real todavía. Verificado en este mismo PR: no existen enlaces visibles hacia
  las páginas de Drive (solo accesibles por URL manual) y el backend responde
  `drivePublicationUnavailable` de forma fail-closed. El workstream del conector
  real (self-serve) reescribirá esas páginas cuando se apruebe.
- **Código de los enlaces de correo**: `compose.yaml` fija
  `GOTRUE_MAILER_OTP_LENGTH=10`, el máximo de GoTrue v2.189.0 (el default es 6).
  La vigencia (`GOTRUE_MAILER_OTP_EXP`, 24 h por default) no cambia: las
  invitaciones se abren horas después. Los enlaces enviados antes del cambio
  siguen sirviendo hasta que venzan; basta recrear `auth`
  (`docker compose up -d auth`).
- **Correo del sistema (SMTP)**: lo envía GoTrue desde `LiTT
  <no-reply@asteroitt.com>`, por el puerto 587 de
  `svgs440.serverneubox.com.mx`, el nombre del servidor Neubox, que es para el
  que vale su certificado. No se usa `mail.asteroitt.com`, porque pasa por el
  proxy de Cloudflare y el SMTP no lo atraviesa. El 465 de Neubox dejó de
  responder el 2026-11-09 y desde entonces el correo sale por el 587
  (`GOTRUE_SMTP_PORT=587`, que también es el default de `compose.yaml`).
  Cómo se cifra el 587: GoTrue v2.189.0 envía con `gopkg.in/gomail.v2`
  (`internal/mailer/mailmeclient/mailmeclient.go` llama a
  `gomail.NewDialer(host, port, user, pass)`; `go.mod` fija
  `gopkg.in/gomail.v2 v2.0.0-20160411212932-81ebce5c23df`). En ese commit,
  `smtp.go` de [go-gomail/gomail](https://github.com/go-gomail/gomail/blob/81ebce5c23dfd25c6c67194b37d3dd3f338c98b1/smtp.go)
  fija `SSL: port == 465` en `NewDialer`; con `SSL` en falso, `Dial` abre la
  conexión sin cifrar y, si el servidor anuncia la extensión `STARTTLS`, llama a
  `StartTLS`. Es decir, en el 587 hay STARTTLS cuando el servidor lo ofrece; si
  no lo ofreciera, gomail seguiría sin cifrar. El enlace de invitación apunta a
  `https://litt.asteroitt.com/auth/v1/verify` (§5) y regresa a la app.
  **Recuperación de contraseña, confirmación de registro y cambio de correo**:
  los enlaces de estos tres correos no pasan por `/auth/v1/verify` (PKCE exige
  el mismo navegador que inició el flujo); apuntan a
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<tipo>&next=<pantalla>`
  (`GOTRUE_SITE_URL` = `PUBLIC_URL`) con `type=recovery` → `/reset-password`,
  `type=signup` → `/onboarding/profile` y `type=email_change` →
  `/settings?emailChange=processed`. La página `/auth/confirm` no gasta el
  token al cargar (los escáneres de correo abren los enlaces): lo verifica el
  backend (`POST /api/auth/verify-otp`, solo esos tres tipos) cuando la persona
  pulsa el botón, y deja la sesión en cookie, así que funciona en cualquier
  navegador. El cambio de correo conserva la doble confirmación de GoTrue
  (`GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED`, activo por defecto): llega un
  correo a cada dirección con su propio `token_hash`; el primer enlace solo
  registra su mitad (la página lo avisa) y el cambio se aplica con el segundo.
  El correo `invite` sigue con `{{ .ConfirmationURL }}` (flujo implícito, no
  PKCE). **Tras desplegar `litt-web`, `litt-auth` recarga las
  plantillas solo**: GoTrue v2.189.0 las guarda en caché y las vuelve a leer
  al pasar `TemplateMaxAge` (10 minutos); durante esa ventana puede seguir
  enviando las anteriores. Reiniciar `litt-auth` (`$C restart auth`) lo hace
  inmediato; probar los correos después de la recarga o del reinicio. El
  backend no tiene credenciales de correo: al invitar a un correo sin cuenta
  pide a GoTrue (`inviteUserByEmail`) que envíe la invitación; quien ya tiene
  cuenta ve su invitación dentro de la app.
- **Correos de GoTrue en español**: las plantillas (`invite`, `confirmation`,
  `recovery`, `email_change`, `reauthentication`) están en `frontend/public/email-templates/` y GoTrue las lee de
  `http://litt-web:3000/email-templates/` por la red interna; los asuntos van en
  `GOTRUE_MAILER_SUBJECTS_*`. Si `litt-web` no responde, GoTrue no puede enviar.
- **Signup abierto con confirmación de correo** (`GOTRUE_MAILER_AUTOCONFIRM=false`):
  una cuenta nueva no entra hasta confirmar su correo. Cerrar el signup
  (`DISABLE_SIGNUP=true`) cuando todo el equipo tenga cuenta.
- **Beta por invitación** (`PLATFORM_ADMIN_EMAILS`, correos separados por
  comas): con valor, el registro exige invitación (de despacho o de plataforma)
  o ser administrador, `POST /auth/oauth` se cierra y solo los administradores
  o quien tenga una invitación de plataforma crean despacho; vacío = abierto.
  En ese modo el registro no crea la cuenta con la contraseña que escribe quien
  llama: GoTrue manda el enlace de invitación al correo y la contraseña se
  define desde ese enlace (igual que con las invitaciones), y «reenviar
  invitación» vuelve a mandar ese correo. El backend (un solo proceso)
  recuerda en memoria las direcciones a las que ya mandó ese correo y las que
  está atendiendo: otra petición de registro para la misma dirección, simultánea
  o posterior, venga de la dirección de red que venga, no manda otro correo
  hasta pasados 10 minutos (el enlace ya enviado sigue valiendo). Reiniciar el
  backend borra esa memoria. La respuesta al registro anónimo es siempre la
  misma (201, mismo cuerpo, sin cookies), esté o no invitada, sea
  administradora o ya tenga cuenta la dirección: el servidor responde primero
  y solo después revisa la dirección y, si procede, pide a GoTrue el correo de
  invitación; quien recibe el correo es la única que lo sabe.
  **Una sola vez tras desplegar este cambio, solo en despliegues por invitación**
  (no en uno con registro abierto, donde una cuenta sin confirmar con contraseña
  es lo normal para quien aún no abre su correo; por eso no es una migración y
  LiTT no escribe en el esquema de GoTrue): las cuentas que nunca se
  confirmaron dejan de tener contraseña, así que la única entrada es un enlace
  enviado al correo. Contar y limpiar:

  ```bash
  cd /srv/litt; C="docker compose --env-file .env -f deploy/prod/compose.yaml"
  $C exec -T db psql -U supabase_admin -d postgres -tAc "select count(*) from auth.users where email_confirmed_at is null and encrypted_password <> ''"
  $C exec -T db psql -U supabase_admin -d postgres -tAc "update auth.users set encrypted_password = '' where email_confirmed_at is null and encrypted_password <> ''"
  ```

  Repetirlo no hace daño (la segunda vez actualiza 0 filas) y no toca cuentas
  confirmadas. Quien ya tenía un enlace viejo lo abre y entra sin contraseña
  (la fija desde «Recuperar contraseña» o con una invitación nueva).
- **Login con Google**: deshabilitado (requiere credenciales de sistema).
- **Documentos en R2** (`litt-docs`): el respaldo NO los incluye (política de
  borrado definitivo sin retención oculta); R2 es el almacén durable.
- **Solo Cloudflare R2 por ahora**: documentos y respaldos, en buckets y con
  tokens separados (§7 para el destino futuro).
- **Esquema y upgrades de la base**: un solo mecanismo, el de upstream. El
  servicio `db-init` carga `backend/schema.sql` solo si la base está vacía (el
  esquema registra en `public.schema_migrations` todas las migraciones que ya
  contiene) y en cada arranque corre `backend/scripts/migrate.sh up`, que
  aplica cada migración pendiente una sola vez, en orden y con candado. Un
  upgrade es: árbol del release nuevo + imágenes nuevas + `$C up db-init` antes
  de `$C up -d`. Una base con esquema pero sin ledger hace que `db-init` falle
  pidiendo un `baseline`; no se repite nada a ciegas. Procedimiento general:
  [`../../docs/deployment.md`](../../docs/deployment.md) §Database setup. La
  serie antigua `*_recovery_*` y su orden manual ya no existen.
- **Colas de trabajo**: sin Redis. El backend usa la cola en PostgreSQL y corre
  los workers en un hilo propio (`WORKERS_MODE` por defecto).
- **Telemetría**: ninguna. El árbol no incluye SDK de Sentry ni variables de
  telemetría de terceros.
- **Egreso de `auth`**: GoTrue está en la red `egress` solo para el SMTP
  saliente; el resto del stack, salvo el backend, sigue en la red interna.
