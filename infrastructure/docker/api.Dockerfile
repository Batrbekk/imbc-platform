# syntax=docker/dockerfile:1.7
# Образ backend: один артефакт, три роли — api (HTTP), worker (очередь) и migrate (Job).
# Роль выбирается командой запуска, см. compose.yaml (архитектура §6, ADR-02).
ARG NODE_VERSION=26
ARG PNPM_VERSION=10.28.0

FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
# В Node 25+ corepack не входит в поставку — ставим pnpm явно.
RUN npm install -g pnpm@${PNPM_VERSION} && pnpm config set store-dir /pnpm-store
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter @imbc/api...
COPY tsconfig.base.json turbo.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @imbc/contracts build && pnpm --filter @imbc/api build
# Только production-зависимости api и собранный @imbc/contracts.
RUN --mount=type=cache,id=pnpm,target=/pnpm-store \
    pnpm --filter @imbc/api deploy --legacy --prod /out

FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3001 3002
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
