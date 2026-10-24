# LiTT — despliegue de producción (`litt.asteroitt.com.mx`)

Paquete operativo del despliegue al VPS compartido `staging-apps-dev`. Sigue el
patrón de la casa: la app vive en `/srv/litt` con su propio compose (`name: litt`),
**ningún puerto se publica al host**, el borde 80/443 lo sirve el Caddy compartido
(de `escrituralab`) con un bloque dedicado, y el respaldo es restic por app.
Los documentos viven en **Cloudflare R2** (externo); no hay object storage local.

## Piezas

| Archivo | Rol |
|---|---|
| `compose.yaml` | Stack completo (db, auth, rest, db-init, gateway, backend, frontend) |
| `gateway.conf` | Fachada interna de Supabase (gotrue+postgrest) para el backend |
| `Caddyfile.litt` | Bloque del dominio para el Caddy compartido (marcadores `# BEGIN/END litt`) |
| `.env.example` | Contrato de variables (copiar a `/srv/litt/.env`, 600) |
| `supabase-jwt.py` | Generador de las llaves JWT `anon` / `service_role` |
| `litt-backup.sh` | Respaldo diario (pg_dump + restic; sin documentos, por diseño) |

## Requisitos previos (una vez)

- [ ] Bucket R2 en Cloudflare (`litt-docs`) + credenciales S3 + reglas CORS
      para `https://litt.asteroitt.com.mx` (PUT/GET de las URLs firmadas).
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
# R2: endpoint + access + secret + bucket del bucket dedicado.
```
Nunca imprimir el contenido del `.env`.

## 4. Primer arranque

```bash
cd /srv/litt
C="docker compose --env-file .env -f deploy/prod/compose.yaml"
$C up -d db auth rest gateway        # base + auth (el init de postgres tarda ~2-5 min)
$C up db-init                        # esquema completo + migraciones pendientes (one-shot)
$C up -d                             # backend + frontend
$C ps                                # todo healthy
```

## 5. Caddy compartido (quirúrgico)

```bash
sudo -n cp /srv/escrituralab/deploy/Caddyfile /srv/escrituralab/deploy/Caddyfile.bak-$(date +%F-%H%M)
# Insertar el contenido de deploy/prod/Caddyfile.litt (solo entre sus marcadores).
sudo -n docker exec escrituralab-caddy-1 caddy validate --config /etc/caddy/Caddyfile
sudo -n docker exec escrituralab-caddy-1 caddy reload  --config /etc/caddy/Caddyfile
```

## 6. DNS

Registro `A litt` → `78.47.184.224` en Cloudflare (igual que `contextlexmx`).
Verificar propagación con DoH (`cloudflare-dns.com/dns-query`); el certificado
ACME lo emite Caddy solo cuando el DNS resuelve.

## 7. Respaldo (patrón de la casa)

1. Crear el bucket `litt-backups` en Hetzner Object Storage y la password en la
   máquina de build (600): `/home/ijs/.secrets/restic-litt-password`.
   **Escrutinio (escrow):** esa password debe existir también fuera del VPS —
   sin ella, ni el respaldo ni los secretos cifrados son recuperables.
2. En el VPS: transferir la password por canal seguro e instalarla en
   `/etc/litt-restic-password` (`sudo install -m 600 -o root -g root`; nunca
   imprimirla). Crear `/etc/litt-restic.env` (600 root:root) con
   `RESTIC_REPOSITORY=s3:https://fsn1.your-objectstorage.com/litt-backups`,
   `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` y
   `RESTIC_PASSWORD_FILE=/etc/litt-restic-password`.
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
curl -s -o /dev/null -w '%{http_code}\n' https://litt.asteroitt.com.mx          # 200 (login)
curl -s https://litt.asteroitt.com.mx/api/health                     # {"ok":true,"commit":"<SHA>"}
```
`/api/health` debe mostrar el `LITT_SOURCE_COMMIT` desplegado.

El enlace **Código fuente** no se comprueba con `curl`: `/login` se entrega
como una página que el navegador arma al cargar, así que el HTML que devuelve
`curl` no contiene el enlace. Se comprueba en el navegador:

1. Abrir `https://litt.asteroitt.com.mx/login`.
2. Al pie, el enlace **Código fuente** debe abrir
   `https://github.com/IvanJS17/litt/tree/<SHA>` con el mismo
   `LITT_SOURCE_COMMIT`, y GitHub debe mostrar ese commit (no un 404).
3. Repetir en Ajustes → Acerca de y en el add-in de Word (Ajustes).
Luego: abrir en el navegador, crear la cuenta del owner, dar de alta la llave
de IA (Ajustes) y subir un documento de prueba.

## Decisiones y pendientes conocidos

- **Drive (Google): NO activado** — la publicación a Drive no tiene conector
  real todavía. Verificado en este mismo PR: no existen enlaces visibles hacia
  las páginas de Drive (solo accesibles por URL manual) y el backend responde
  `drivePublicationUnavailable` de forma fail-closed. El workstream del conector
  real (self-serve) reescribirá esas páginas cuando se apruebe.
- **Signup abierto + autoconfirmación** (aún sin SMTP): cerrar
  (`DISABLE_SIGNUP=true`) cuando todo el equipo tenga cuenta. SMTP (correos
  del sistema) pospuesto.
- **Login con Google**: deshabilitado (requiere credenciales de sistema).
- **Documentos en R2**: el respaldo NO los incluye (política de borrado
  definitivo sin retención oculta); R2 es el almacén durable.
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
- **SMTP futuro**: cuando se habilite el correo, el servicio `auth` necesitará
  egreso (añadirlo a la red `egress` del compose); hoy no lo requiere.
