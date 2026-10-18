CYAN := \033[36m
YELLOW := \033[33m
RESET := \033[0m

PORT ?= 3000
export PORT

all: up tailscale url ## Build, start the server and publish it on your tailnet

up: ## Build and start the server in detached mode
	docker compose up -d --build --wait

tailscale: ## Publish the server over HTTPS/WSS on your tailnet
	@command -v tailscale >/dev/null || { echo "tailscale CLI not found"; exit 1; }
	tailscale serve --bg --https=443 http://127.0.0.1:$(PORT)

untailscale: ## Stop publishing on your tailnet
	tailscale serve --https=443 http://127.0.0.1:$(PORT) off

url: ## Show the tailnet URL (use wss://<host>/ws from clients)
	@tailscale serve status

down: ## Stop and remove the container
	docker compose down

re: down up ## Rebuild and restart the server

build: ## Build the image without starting it
	docker compose build

logs: ## Follow server logs
	docker compose logs -f

shell-%: ## Open a shell in a running container, e.g. make shell-server
	docker compose exec $* sh

destroy: ## Remove this project's container, network and image
	docker compose down --remove-orphans --rmi all

help: ## Show this help message
	@echo "$(YELLOW)Available commands:$(RESET)"
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_%-]+:.*##/ { printf "  $(CYAN)%-15s$(RESET) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

.PHONY: all up tailscale untailscale url down re build logs destroy help shell-%
