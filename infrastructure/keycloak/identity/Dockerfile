# syntax=docker/dockerfile:1.7
# React/shadcn login screens packaged as an IMBC theme; password processing remains native.
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends maven openjdk-17-jdk-headless ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /theme
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN --mount=type=cache,target=/root/.m2 npm run build:theme

FROM quay.io/keycloak/keycloak:26.4
COPY --from=build --chown=keycloak:keycloak /theme/dist_keycloak/imbc-theme.jar /opt/keycloak/providers/imbc-theme.jar
