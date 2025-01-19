.PHONY: clean build link restart all

# Variables
N8N_PATH=~/Library/pnpm/global/5/node_modules/n8n
PROJECT_PATH=/Users/felixvemmer/Developer/n8n-nodes-vercel-ai-sdk

clean:
	@echo "🧹 Cleaning up..."
	rm -rf dist
	rm -rf node_modules
	rm -rf .turbo
	rm -rf .build
	rm -rf .pnpm-store
	pnpm store prune

build:
	@echo "🏗️  Building project..."
	pnpm install
	pnpm build

unlink:
	@echo "🔓 Unlinking from n8n..."
	cd $(N8N_PATH) && pnpm unlink n8n-nodes-vercel-ai-sdk || true

link:
	@echo "🔗 Linking to n8n..."
	pnpm link --global
	cd $(N8N_PATH) && pnpm link --global n8n-nodes-vercel-ai-sdk

restart:
	@echo "🔄 Restarting n8n..."
	export N8N_LOG_LEVEL=debug && \
	export N8N_CUSTOM_EXTENSIONS="$(PROJECT_PATH)" && \
	n8n start

# Main command to run everything
all: clean build unlink link restart

# Helper command for development
dev: build unlink link restart 