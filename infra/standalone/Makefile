# Convenience targets for local dev + common ops. Run from repo root.

COMPOSE_LOCAL = docker compose -f infra/standalone/docker-compose.local.yml
COMPOSE_PROD  = docker compose -f infra/standalone/docker-compose.yml

# ---------- Local dev ----------

.PHONY: dev
dev: ## Start local data services + run API + worker on host
	$(COMPOSE_LOCAL) up -d
	@echo "Postgres:  localhost:5432  (user: platform, pass: platform, db: platform_dev)"
	@echo "Redis:     localhost:6379  (pass: local-redis-password)"
	@echo "MinIO:     localhost:9000 S3 API / localhost:9001 console (minio-local / minio-local-password)"
	@echo ""
	@echo "Now run API + worker on the host:"
	@echo "  npm --workspace=apps/api    run dev"
	@echo "  npm --workspace=apps/worker run dev"

.PHONY: dev-with-obs
dev-with-obs: ## Also start Prometheus + Grafana for metric debugging
	$(COMPOSE_LOCAL) --profile observability up -d

.PHONY: down
down: ## Stop local data services (volumes preserved)
	$(COMPOSE_LOCAL) down

.PHONY: reset
reset: ## Stop + wipe local data (destructive — DBs lost)
	$(COMPOSE_LOCAL) down -v

.PHONY: psql
psql: ## Open psql shell to local Postgres
	$(COMPOSE_LOCAL) exec postgres psql -U platform -d platform_dev

.PHONY: redis-cli
redis-cli: ## Open redis-cli to local Redis
	$(COMPOSE_LOCAL) exec redis redis-cli -a local-redis-password

# ---------- Prod ops (run ON the VPS, not locally) ----------

.PHONY: prod-up
prod-up: ## Start data services on prod/staging VPS
	$(COMPOSE_PROD) --env-file /opt/platform/env/.env up -d

.PHONY: prod-logs
prod-logs: ## Tail data service logs on VPS
	$(COMPOSE_PROD) logs -f --tail=100

.PHONY: backup
backup: ## Run a one-off backup (prod VPS only)
	bash infra/standalone/scripts/backup.sh

.PHONY: restore-drill
restore-drill: ## Monthly restore drill — fetches latest backup + restores to a scratch DB
	bash infra/standalone/scripts/restore.sh --drill

# ---------- Help ----------

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
