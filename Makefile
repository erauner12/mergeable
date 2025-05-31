# ------------------------------------------------------------------------------
# Image parameters (override with "make TAG=foo PLATFORMS=linux/amd64,linux/arm64")
# ------------------------------------------------------------------------------
IMAGE      ?= ghcr.io/erauner12/mergeable
# → commit-hash - timestamp keeps tags unique yet recognisable
# Snapshot once at the very beginning of the make run
TIMESTAMP  := $(shell date +%Y%m%d%H%M%S)
COMMIT     := $(shell git rev-parse --short HEAD)
TAG        ?= $(COMMIT)-$(TIMESTAMP)
PLATFORMS  ?= linux/amd64,linux/arm64

# One-time builder (idempotent: creates it only if it doesn't exist)
.PHONY: buildx-setup
buildx-setup:
	@docker buildx inspect multiarch >/dev/null 2>&1 || \
	docker buildx create --name multiarch --use
	@docker buildx inspect --bootstrap >/dev/null

# Build the web bundle and produce / push a multi-arch image
.PHONY: image-web
image-web: buildx-setup
	pnpm --filter web build                       # creates dist/client
	docker buildx build \
	--platform $(PLATFORMS) \
	-f apps/web/Dockerfile \
	-t $(IMAGE):$(TAG) \
	--push \
	apps/web
	@echo "✅ pushed $(IMAGE):$(TAG)"

# Optional shortcut that also bumps your Helm values file (if you keep it checked-in)
.PHONY: image-web-bump
image-web-bump: image-web
	sed -i '' -E 's|(^[[:space:]]*tag: ).*|\1"$(TAG)"|' helm/mergeable/values.yaml
	@echo "🔄  Helm values updated to $(TAG)"

###############################################################################
#  ⛰  Local "CI-like" checks
###############################################################################
# Run the exact same quick gates that the GitHub workflow executes:
#   • type-check all packages
#   • lint all packages
#   • run vitest (with coverage) for all packages
#
.PHONY: ci-check
ci-check:
	pnpm typecheck
	pnpm lint
	pnpm coverage        # ⇒ fails the target if any test fails

# Convenience wrappers
.PHONY: typecheck lint test
typecheck: ;	pnpm typecheck
lint:      ;	pnpm lint
test:      ;	pnpm coverage            # keeps the single source of truth

###############################################################################
#  🚢  Helm / Kubernetes helpers
###############################################################################
K8S_NS        ?= development
HELM_RELEASE  ?= mergeable
HELM_CHART    ?= ./helm/mergeable
HELM_VALUES   ?= helm/mergeable/values.yaml

# Upgrade (or install) the chart in the target cluster/namespace.
#   make helm-up             → helm upgrade --install …
.PHONY: helm-up
helm-up:
	helm upgrade --install \
	$(HELM_RELEASE) $(HELM_CHART) \
	--namespace $(K8S_NS) \
	--create-namespace \
	-f $(HELM_VALUES)

# Uninstall the release entirely.
.PHONY: helm-down
helm-down:
	helm uninstall $(HELM_RELEASE) -n $(K8S_NS)

# Force a rollout restart for the Deployment (useful when you just changed
# ConfigMaps/Secrets that don’t bump the image tag).
.PHONY: helm-rollout
helm-rollout:
	kubectl rollout restart deploy/$(HELM_RELEASE) -n $(K8S_NS)

###############################################################################
#  🌀  Quick "GitOps OFF / ON" toggles for Mergeable
###############################################################################
FLUX_NS        ?= flux-system          # where your Flux controllers live
FLUX_KUSTOM    ?= cluster-apps-mergeable

.PHONY: flux-suspend flux-resume
flux-suspend:
	@echo "⏸️  Suspending Flux reconciliation for $(FLUX_KUSTOM)…"
	flux suspend kustomization $(FLUX_KUSTOM) -n $(FLUX_NS)
	# HelmRelease may not exist yet; ignore errors
	-flux suspend helmrelease $(HELM_RELEASE) -n $(K8S_NS)

flux-resume:
	@echo "▶️  Resuming Flux reconciliation for $(FLUX_KUSTOM)…"
	flux resume kustomization $(FLUX_KUSTOM) -n $(FLUX_NS)
	# Same: ignore if HR is absent
	-flux resume helmrelease $(HELM_RELEASE) -n $(K8S_NS)

# One-shot helper: pause GitOps, deploy from local chart, stay paused
.PHONY: iter-start
iter-start: flux-suspend helm-up

# Finish the iteration: delete ad-hoc release, resume GitOps
.PHONY: iter-stop
iter-stop: helm-down flux-resume

# Patch the dev HelmRelease with TAG=<tag> (defaults to the one just built)
.PHONY: helm-patch
helm-patch:
	@: ${TAG:?TAG must be provided (e.g. make helm-patch TAG=mytag)}
	flux suspend kustomization $(FLUX_KUSTOM) -n $(FLUX_NS)
	kubectl -n $(K8S_NS) patch helmrelease $(HELM_RELEASE) --type merge \
	-p='{"spec":{"values":{"image":{"tag":"$(TAG)"}}}}'
	flux reconcile helmrelease $(HELM_RELEASE) -n $(K8S_NS) --with-source
	flux resume kustomization $(FLUX_KUSTOM) -n $(FLUX_NS)
	@echo "🚀  Dev cluster now running image: $(TAG)"
