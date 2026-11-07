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
| `auth-edge.conf` | Borde público de GoTrue: solo `GET /auth/v1/verify` (enlaces de los correos) |
| `Caddyfile.litt` | Bloques de `litt.asteroitt.com` y `word.litt.asteroitt.com` para el Caddy compartido (marcadores `# BEGIN/END litt`) |
| `.env.example` | Contrato de variables (copiar a `/srv/litt/.env`, 600) |
| `supabase-jwt.py` | Generador de las llaves JWT `anon` / `service_role` |
| `litt-backup.sh` | Respaldo diario (pg_dump + restic en R2; sin documentos, por diseño) |
| `litt-restic.env.example` | Nombres de las variables de `/etc/litt-restic.env` (sin valores) |
| `litt-deploy.sh` | Deploy de un release en el VPS: marcador, espacio, carga verificada, árbol, salud y retención (§1) |
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
- [ ] Registro DNS `A word.litt` → la misma IP, sin proxy de Cloudflare (§9).
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
BYTES=$(( $(docker image inspect --format '{{.Size}}' "litt-backend:$SHA") \
        + $(docker image inspect --format '{{.Size}}' "litt-frontend:$SHA") \
        + $(docker image inspect --format '{{.Size}}' "litt-word:$SHA") ))
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
   `BYTES` es la suma de los tamaños de las tres imágenes, una cota conservadora porque
   comparten capas. Si no alcanza, retira primero las imágenes `litt-*` que no son la
   viva y, si aún no alcanza, aborta sin cargar nada.
3. Carga las imágenes y compara sus IDs con los de la máquina de build.
4. Reemplaza el árbol del release. Lo extrae aparte y lo sincroniza con `rsync`, de modo
   que el árbol nunca queda vacío mientras corren los contenedores, que montan archivos
   de él. Conserva `.env` y `backups/`, y fija `LITT_SOURCE_COMMIT` y `RELEASE_SHA`.
5. `up -d --remove-orphans` (corre `db-init`, que aplica migraciones pendientes) y espera
   a que todo servicio de larga vida esté corriendo, healthy si tiene healthcheck (`rest`
   no tiene), a que `/health` reporte el SHA y a que `litt-word` sirva un `manifest.xml`
   cuyo panel apunta a `WORD_ADDIN_URL` del `.env` (una imagen construida con otra URL
   pública aborta el deploy). Sin `WORD_ADDIN_URL` en el `.env`, el script aborta antes
   de cargar nada.
6. Solo entonces aplica la retención: imagen viva + 1 anterior, retirando el resto por tag
   explícito. Nunca usa `docker system/image/volume/builder prune`.

**Rollback:** la imagen anterior sigue cargada en el VPS. Para volver a ella se corre el
mismo procedimiento con el SHA anterior: las imágenes se vuelven a mandar por stdin, ya sea
reconstruyéndolas en la máquina de build desde ese commit o con `docker save` de las que
están en el VPS, y el árbol sale de `git archive` de ese commit.

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
a `litt-auth:8000` (`auth-edge`). Esa es la ruta de los enlaces que llegan por
correo para confirmar la cuenta, recuperar la contraseña, aceptar una
invitación o cambiar el correo. `auth-edge` responde 404 a cualquier otra ruta,
así que la red del Caddy compartido no alcanza el signup, el token, la API
admin ni PostgREST.

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
`https://litt.asteroitt.com/auth/v1/verify…` que, al abrirlo, regresa a la app
con la cuenta confirmada. Si no llega, revisar `$C logs auth` (sin imprimir el
`.env`). Después, dar de alta la llave de IA (Ajustes) y subir un documento de
prueba. Comprobar también «Olvidé mi contraseña» con la misma cuenta.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://litt.asteroitt.com/auth/v1/signup   # 404 (auth-edge solo expone /verify)
```

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

**Caddy.** `Caddyfile.litt` trae el bloque `word.litt.asteroitt.com` →
`litt-word:3200` dentro de los mismos marcadores `# BEGIN litt` / `# END litt`. Se
aplica con el procedimiento de §5: respaldo, `probe` de **todos** los dominios antes,
editar solo entre los marcadores, `caddy validate`, `caddy reload`, `probe` después y
`diff`. Si cambió un dominio ajeno, restaurar el respaldo y recargar. `word.litt`
aparece en el `probe` de después (el de antes no lo conoce), lo esperado es `200`.

### Checklist de la primera publicación

1. [ ] Este PR revisado y en `main`; el SHA de `main` es el que se construye (§1).
2. [ ] En `/srv/litt/.env` (sin imprimirlo): agregar `WORD_ADDIN_URL=https://word.litt.asteroitt.com`
       y `AUTH_HANDOFF_ENCRYPTION_SECRET=<openssl rand -hex 32>`. Comprobar con
       `grep -c '^WORD_ADDIN_URL=\|^AUTH_HANDOFF_ENCRYPTION_SECRET=' /srv/litt/.env` → `2`.
3. [ ] DNS `A word.litt` → `78.47.184.224`, sin proxy; resuelve por DoH.
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
- **Correo del sistema (SMTP)**: lo envía GoTrue desde `LiTT
  <no-reply@asteroitt.com>`, con SSL implícito en el puerto 465 de
  `svgs440.serverneubox.com.mx`, el nombre del servidor Neubox, que es para el
  que vale su certificado. No se usa `mail.asteroitt.com`, porque pasa por el
  proxy de Cloudflare y el SMTP no lo atraviesa. Fuente del 465: GoTrue v2.189.0
  envía con `gopkg.in/gomail.v2` (`internal/mailer/mailmeclient`), cuyo
  `NewDialer` activa TLS implícito cuando el puerto es 465. Los enlaces apuntan a
  `https://litt.asteroitt.com/auth/v1/verify` (§5) y regresan a la app. El
  backend no envía correo propio: las invitaciones a organizaciones se ven
  dentro de la app.
- **Signup abierto con confirmación de correo** (`GOTRUE_MAILER_AUTOCONFIRM=false`):
  una cuenta nueva no entra hasta confirmar su correo. Cerrar el signup
  (`DISABLE_SIGNUP=true`) cuando todo el equipo tenga cuenta.
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
