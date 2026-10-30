# LiTT — despliegue de producción (`litt.asteroitt.com`)

Paquete operativo del despliegue al VPS compartido `staging-apps-dev`. Sigue el
patrón de la casa: la app vive en `/srv/litt` con su propio compose (`name: litt`),
**ningún puerto se publica al host**, el borde 80/443 lo sirve el ingress compartido
(`/srv/edge`, contenedor `edge-caddy-1`) con un bloque dedicado, y el respaldo es restic
por app. El VPS es compartido: LiTT cumple las reglas del host (`HOST-RULES.md` del repo
`asteroitt-ops`; copia en `/srv/edge/HOST-RULES.md`): retención de imágenes vivo + 1,
sin `docker system/image/volume prune`, chequeo de espacio antes de construir y
presupuesto de disco declarado (~6 GB: imágenes `litt-*` + Supabase + volúmenes).
Los documentos viven en **Cloudflare R2** (bucket `litt-docs`) y los respaldos
en otro bucket de R2 (`litt-backups`), cada uno con su propio token limitado a
él; no hay object storage local. El correo del sistema sale de
`no-reply@asteroitt.com` por SMTP.

## Piezas

| Archivo | Rol |
|---|---|
| `compose.yaml` | Stack completo (db, auth, rest, db-init, gateway, backend, litt-web) |
| `gateway.conf` | Fachada interna de Supabase (gotrue+postgrest) para el backend |
| `auth-edge.conf` | Borde público de GoTrue: solo `GET /auth/v1/verify` (enlaces de los correos) |
| `Caddyfile.litt` | Bloque del dominio para el Caddy compartido (marcadores `# BEGIN/END litt`) |
| `.env.example` | Contrato de variables (copiar a `/srv/litt/.env`, 600) |
| `supabase-jwt.py` | Generador de las llaves JWT `anon` / `service_role` |
| `litt-backup.sh` | Respaldo diario (pg_dump + restic en R2; sin documentos, por diseño) |
| `litt-restic.env.example` | Nombres de las variables de `/etc/litt-restic.env` (sin valores) |

## Requisitos previos (una vez)

- [ ] Buckets R2 `litt-docs` y `litt-backups` (ya existen), cada uno con su
      token S3 limitado a él; reglas CORS de `litt-docs` para
      `https://litt.asteroitt.com` (PUT/GET de las URLs firmadas).
- [ ] Buzón `no-reply@asteroitt.com` (Neubox) con SPF, DKIM y DMARC (ya
      configurados).
- [ ] Registro DNS `A litt` → `78.47.184.224` (Cloudflare; mismo modo que
      `contextlexmx`).
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
for i in backend frontend; do                                          # revisión == SHA; anotar el Id en el recibo
  docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}} {{.Id}}' "litt-$i:$SHA"
done
docker save "litt-backend:$SHA"  | gzip > /tmp/litt-backend.tgz
docker save "litt-frontend:$SHA" | gzip > /tmp/litt-frontend.tgz
scp /tmp/litt-*.tgz staging-apps-dev:/tmp/
# En el VPS:
gzip -dc /tmp/litt-backend.tgz  | docker load
gzip -dc /tmp/litt-frontend.tgz | docker load
docker image inspect --format '{{.Id}}' litt-backend:<SHA>   # == ID anotado
docker image inspect --format '{{.Id}}' litt-frontend:<SHA>  # == ID anotado
```

La etiqueta de las imágenes es el SHA completo y queda en `.env` como
`LITT_SOURCE_COMMIT`; `compose.yaml` no arranca sin ella. El contexto de build
es la raíz del repositorio (los Dockerfiles copian `packages/contracts`). El
deploy NO compila en el VPS; la comparación de IDs tras `docker load` ata el
deploy a los bytes construidos y verificados. Si se publica el add-in de Word,
su imagen se construye igual (`docker build -f word-addin/Dockerfile
--build-arg GIT_SHA="$SHA" …`, más las URLs de `docs/word-addin-development.md`)
y su enlace está en Ajustes del panel.

**Sin secretos en lo que se ofrece.** El código ofrecido es el árbol público de
GitHub en ese SHA. Los secretos viven solo en `/srv/litt/.env` (fuera de Git,
§3) y el workflow `Secret scan` ([`.github/workflows/gitleaks.yml`](../../.github/workflows/gitleaks.yml))
escanea con gitleaks todo el historial en cada PR y en cada push a `main`.
Antes de construir, comprobar que su corrida en el commit desplegado está en
verde: `gh run list --repo IvanJS17/litt --workflow gitleaks.yml --commit "$SHA"`.

## 2. Árbol del release (VPS)

```bash
# En la máquina de build (repo litt):
git archive --format=tar.gz -o /tmp/litt.tar.gz <SHA-de-main> && scp /tmp/litt.tar.gz staging-apps-dev:/tmp/
# En el VPS (owner ivan, como /srv/contextlex-mx):
sudo -n mkdir -p /srv/litt && sudo -n chown ivan:ivan /srv/litt
cd /srv/litt && tar -xzf /tmp/litt.tar.gz
```

## 3. Secretos (`/srv/litt/.env`, 600)

```bash
cp deploy/prod/.env.example /srv/litt/.env && chmod 600 /srv/litt/.env
# POSTGRES_PASSWORD, JWT_SECRET, DOWNLOAD_SIGNING_SECRET, USER_API_KEYS_ENCRYPTION_SECRET:
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
| `POSTGRES_PASSWORD`, `JWT_SECRET`, `DOWNLOAD_SIGNING_SECRET`, `USER_API_KEYS_ENCRYPTION_SECRET` | `/srv/litt/.env` | `openssl rand -hex 32` en el VPS |
| `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `/srv/litt/.env` | `supabase-jwt.py` con el `JWT_SECRET` de arriba |
| `RESTIC_REPOSITORY` | `/etc/litt-restic.env` | `s3:` + valor de `LITT_R2_ENDPOINT_URL` + `/litt-backups` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `/etc/litt-restic.env` | BWS `LITT_R2_BACKUPS_*` (token del bucket `litt-backups`) |
| `RESTIC_PASSWORD` | `/etc/litt-restic.env` | BWS `LITT_RESTIC_PASSWORD` |

Los demás valores del `.env` no son secretos y ya vienen en `.env.example`:
el bucket, el host, el puerto y el usuario SMTP y el remitente.

## 4. Primer arranque

```bash
cd /srv/litt
C="docker compose --env-file .env -f deploy/prod/compose.yaml"
$C up -d db auth rest gateway        # base + auth (el init de postgres tarda ~2-5 min)
$C up db-init                        # esquema completo + migraciones pendientes (one-shot)
$C up -d --remove-orphans            # backend + litt-web
$C ps                                # todo healthy
```

## 5. Caddy compartido (quirúrgico)

El bloque manda todo a `litt:3000` (servicio `litt-web`), salvo `/auth/v1/verify`, que va
a `litt-auth:8000` (`auth-edge`). Esa es la ruta de los enlaces que llegan por
correo para confirmar la cuenta, recuperar la contraseña, aceptar una
invitación o cambiar el correo. `auth-edge` responde 404 a cualquier otra ruta,
así que la red del Caddy compartido no alcanza el signup, el token, la API
admin ni PostgREST.

```bash
sudo -n cp /srv/edge/conf/Caddyfile /srv/edge/conf/Caddyfile.bak-$(date -u +%Y%m%dT%H%M%SZ)
# Insertar el contenido de deploy/prod/Caddyfile.litt (solo entre sus marcadores).
sudo -n docker exec edge-caddy-1 caddy validate --config /etc/caddy/Caddyfile
sudo -n docker exec edge-caddy-1 caddy reload   --config /etc/caddy/Caddyfile
```

`/srv/edge/conf/` se monta como directorio, así que editar el archivo en sitio es seguro
(el antiguo bind de archivo suelto dejaba al Caddy leyendo una copia vieja).

**Nombres en la red compartida.** Solo `litt-web` y `auth-edge` entran a la red del
ingress (`escrituralab_default`, nombre heredado; el ingress también está en `edge` y
la migración a `edge` queda pendiente en `HOST-RULES.md`), que comparten otras apps. Compose da a cada servicio
su nombre como alias en todas sus redes, así que esos servicios deben tener nombres
únicos en el host (`frontend`, `backend` y `web` ya son de otras apps) y sus llamadas
internas usan alias propios (`litt-backend`, `litt-gotrue`). Antes de agregar un
servicio a esa red, revisar `docker network inspect escrituralab_default`.

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
4. Cron (root, sin pisar): `30 3 * * * /usr/local/sbin/litt-backup.sh >> /var/log/litt-backup.log 2>&1`
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
