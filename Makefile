# Короткие команды dev-стенда. Все цели — обёртки над docker compose и pnpm.
COMPOSE := docker compose
DEV := $(COMPOSE) -f compose.yaml -f compose.dev.yaml
INFRA := postgres valkey rustfs buckets keycloak clamav mailpit migrate

.PHONY: help env secrets up down logs ps rebuild reset infra dev check

help:            ## Список команд
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

env:             ## Создать .env из шаблона (если его ещё нет)
	@test -f .env || cp .env.example .env && echo ".env готов"

secrets: env     ## Заменить все change-me в .env случайными значениями
	@for key in $$(grep -oE '^[A-Z_]+=change-me[^ ]*' .env | cut -d= -f1); do \
	  val=$$(openssl rand -hex 24); sed -i.bak "s|^$$key=.*|$$key=$$val|" .env; done; rm -f .env.bak
	@echo "Секреты сгенерированы"

up: env          ## Собрать и поднять весь стенд
	$(COMPOSE) up -d --build

down:            ## Остановить стенд (данные сохраняются)
	$(COMPOSE) down

logs:            ## Логи приложения
	$(COMPOSE) logs -f api worker web

ps:              ## Состояние контейнеров
	$(COMPOSE) ps

rebuild:         ## Пересобрать только приложение
	$(COMPOSE) up -d --build migrate api worker web

reset:           ## Удалить стенд вместе с данными
	$(COMPOSE) down -v

infra: env       ## Только инфраструктура (для pnpm dev на хосте)
	$(DEV) up -d $(INFRA)

dev:             ## Приложения на хосте с hot reload
	pnpm dev

check:           ## Типы, тесты, сборка
	pnpm typecheck && pnpm test && pnpm build
