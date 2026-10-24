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
FROM node:22-slim

WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
COPY packages/contracts /packages/contracts

# AGPL-3.0 §13: the full SHA of the published commit this image is built
# from. next.config.ts inlines it into the "Código fuente" link and fails the
# build without it (.git is outside the build context, so there is no fallback).
ARG GIT_SHA=
LABEL org.opencontainers.image.revision=$GIT_SHA

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
