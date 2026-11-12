# syntax=docker/dockerfile:1.7
# Web UI: статическая сборка Vite (спецификация 11.1), nginx без root на :3000 — адрес web:3000 прежний.
ARG NODE_VERSION=26
ARG PNPM_VERSION=10.28.0
# USER 101 ниже — пользователь этого образа; другому базовому образу может понадобиться другой uid.
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.29-alpine

FROM node:${NODE_VERSION}-alpine AS build
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION} && pnpm config set store-dir /pnpm-store
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter @imbc/web...
COPY tsconfig.base.json turbo.json ./
COPY packages/contracts packages/contracts
COPY apps/web apps/web
# Кабинеты ролей — прототип интерфейса (GEN-08, NFR-15). Vite читает флаг при сборке; без "true"
# в dist нет ни меню, ни маршрутов, ни кода прототипа. Объявлен здесь, чтобы не сбивать кэш установки.
ARG VITE_PROTOTYPE_CABINETS=false
ENV VITE_PROTOTYPE_CABINETS=${VITE_PROTOTYPE_CABINETS}
RUN pnpm --filter @imbc/contracts build && pnpm --filter @imbc/web build

FROM ${NGINX_IMAGE} AS runtime
# Страницы базового образа (index.html, 50x.html) убираются: в образе только сборка Vite.
# Каталог принадлежит root, поэтому удаление — от root, затем прежний пользователь образа (101, без root).
USER root
RUN rm -rf /usr/share/nginx/html/*
USER 101
COPY infrastructure/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 3000
