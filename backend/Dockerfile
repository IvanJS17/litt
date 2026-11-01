# Two stages: the build needs the dev dependencies (TypeScript, test tooling, ~0.5 GB);
# the runtime image keeps only LibreOffice and the production dependencies. Every
# runtime entrypoint (API, worker, sync:workflows, the isolated parsers) runs the
# compiled dist/*.js; tsx is only loaded for *.ts entries in development.
FROM node:22-slim AS build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
COPY packages/contracts /packages/contracts
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
# libreoffice-convert shells out to soffice for doc conversion (see src/lib/convert.ts)
RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice util-linux \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app ./

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
ENV NODE_ENV=production NODE_OPTIONS=--enable-source-maps
EXPOSE 3001
CMD ["npm", "start"]
