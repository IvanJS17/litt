# Build from the repository root: `docker build -f word-addin/Dockerfile .`
# The add-in bundles the UI it shares with the web app (frontend/src/shared,
# reached through webpack aliases, tsconfig paths, and Tailwind @source
# entries), the web app's icons (frontend/public/icons, the @icons alias), and
# the @mike/contracts declarations. Nothing else outside word-addin/ is read.
# No CI workflow builds this image: build it from the repository root at the
# deployment gate (deploy/prod/README.md) so a new outside dependency fails
# there, not after the deploy.
FROM node:22-slim AS build

WORKDIR /app
COPY word-addin/package*.json ./
RUN npm ci
COPY word-addin/ ./
COPY frontend/src/shared /frontend/src/shared
COPY frontend/public/icons /frontend/public/icons
COPY packages/contracts /packages/contracts

ARG REACT_APP_WEB_APP_URL
ARG WORD_ADDIN_PUBLIC_URL
# AGPL-3.0 §13: the full SHA of the published commit this image is built
# from. webpack.config.js bakes it into the "Código fuente" link and fails the
# production build without it.
ARG GIT_SHA=
ENV REACT_APP_API_BASE_URL=/api \
    REACT_APP_WEB_APP_URL=$REACT_APP_WEB_APP_URL \
    WORD_ADDIN_PUBLIC_URL=$WORD_ADDIN_PUBLIC_URL
RUN npm run build

FROM node:22-slim
ARG GIT_SHA=
LABEL org.opencontainers.image.revision=$GIT_SHA
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY word-addin/server.mjs ./server.mjs
ENV NODE_ENV=production PORT=3200
EXPOSE 3200
CMD ["node", "server.mjs"]
