# Two stages: the build needs the dev dependencies (TypeScript, test tooling, ~0.5 GB);
# the runtime image keeps only LibreOffice and the production dependencies. Every
# runtime entrypoint (API, worker, sync:workflows, the isolated parsers) runs the
# compiled dist/*.js; tsx is only loaded for *.ts entries in development.
FROM node:22-slim AS build
WORKDIR /app
# .npmrc sets engine-strict: on a stale cached node:22-slim older than the
# engines floor, `npm ci` fails here with "notsup" instead of building an
# image that crashes at boot (MIKE-BACKEND-3R). `docker compose build --pull`
# refreshes the base.
COPY backend/package*.json backend/.npmrc ./
RUN npm ci
COPY backend/ ./
COPY packages/contracts /packages/contracts
# The annex words come from the shared catalog (lib/methodology/messages.ts).
COPY packages/i18n/messages /packages/i18n/messages
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
# libreoffice-convert shells out to soffice for doc conversion (see src/lib/convert.ts).
# The code only converts Word (doc/docx) and presentation (ppt/pptx) files to PDF
# (shouldConvertToPdf; spreadsheets are read in-process), so only the Writer and
# Impress headless components are installed, not the `libreoffice` metapackage
# (Calc, Draw, Math, Base, GUI toolkits).
RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-writer-nogui libreoffice-impress-nogui util-linux \
  && rm -rf /var/lib/apt/lists/*
# Two unprivileged accounts, neither with a login shell. litt-api runs the API,
# its workers and the jobs. litt-reader runs only the processes that open
# uploaded files (the parser and LibreOffice, see src/lib/extraction/isolated.ts):
# a different user cannot read the API's environment or files, and owns nothing
# but its own temporary directory.
RUN groupadd --system --gid 10001 litt-api \
  && useradd --system --uid 10001 --gid litt-api --create-home --home-dir /home/litt-api --shell /usr/sbin/nologin litt-api \
  && groupadd --system --gid 10002 litt-reader \
  && useradd --system --uid 10002 --gid litt-reader --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin litt-reader
WORKDIR /app
COPY --from=build /app ./
COPY --from=build /packages/i18n/messages /packages/i18n/messages
# Starts as root only to drop to litt-api; see the script for the two capabilities it keeps.
COPY backend/docker-entrypoint.sh /usr/local/bin/litt-entrypoint
RUN chmod 0755 /usr/local/bin/litt-entrypoint

# AGPL-3.0 §13: the full SHA of the published commit this image is built from.
# /health reports it, and production refuses to start without it, so the build
# fails here instead of after the deploy.
ARG GIT_SHA=
RUN echo "$GIT_SHA" | grep -Eqx '[0-9a-f]{40}' \
  || { echo "GIT_SHA must be the full 40-character commit SHA (--build-arg GIT_SHA=\$(git rev-parse HEAD))" >&2; exit 1; }
ENV GIT_SHA=$GIT_SHA
LABEL org.opencontainers.image.revision=$GIT_SHA

# --enable-source-maps: every entrypoint in this image (API, worker,
# sync:workflows) reports stack frames as src/*.ts lines, not dist/*.js.
ENV NODE_ENV=production NODE_OPTIONS=--enable-source-maps EXTRACTION_READER_USER=litt-reader
EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/litt-entrypoint"]
# The API itself, not `npm start`: npm would run it behind a shell that ends on the
# stop signal without passing it on, so the API's own shutdown (finish requests,
# close) would never run on `docker stop`.
CMD ["node", "--enable-source-maps", "dist/index.js"]
