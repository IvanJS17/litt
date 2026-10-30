# Build from the repository root: `docker build -f frontend/Dockerfile .`
# (docker-compose.yml does the same). The image needs the frontend plus the
# one sibling directory production code reaches through a tsconfig `paths`
# alias: `@mike/contracts` -> /packages/contracts. Nothing else. `next build`
# type-checks tsconfig.build.json, which leaves test files -- and their
# imports of shared fixtures and add-in sources -- out of the image.
#
# A new outside dependency needs a COPY here and a tsconfig alias that
# resolves to the same path; frontend/src/__tests__/architecture.test.ts
# checks that the two agree. No CI workflow builds this image: building it
# from the repository root at the deployment gate (deploy/prod/README.md) is
# the check that catches a missing COPY.
#
# LiTT: two stages. The build stage has the full dependency tree; the runtime
# stage keeps only Next's standalone output (the traced server files), its
# static assets and `public/`, so the image fits the shared production host.
FROM node:22-slim AS build

WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
COPY packages/contracts /packages/contracts

# AGPL-3.0 §13: the full SHA of the published commit this image is built
# from. next.config.ts inlines it into the "Código fuente" link and fails the
# build without it (.git is outside the build context, so there is no fallback).
ARG GIT_SHA=
ENV NEXT_OUTPUT=standalone
RUN npm run build

FROM node:22-slim
ARG GIT_SHA=
LABEL org.opencontainers.image.revision=$GIT_SHA
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
