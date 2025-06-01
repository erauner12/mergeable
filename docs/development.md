# Development Workflow

This document outlines the recommended workflow for building, pushing Docker images, and updating HelmRelease for local development or testing.

## Recommended workflow

```bash
# Build and push a multi-arch image + update the dev HelmRelease values
make image-web-bump

# Let your GitOps controller (or `helm upgrade -f`) roll it out,
# or trigger manually (example for a deployment named 'mergeable' in 'development' namespace):
kubectl rollout restart deploy/mergeable -n development
```

### Explanation

1.  **`make image-web-bump`**:
    *   This command first executes the `image-web` target:
        *   It ensures the `docker buildx` multi-arch builder (`multiarch`) is set up.
        *   It builds the `web` application using `pnpm --filter web build`.
        *   It builds a multi-arch Docker image (defaulting to `linux/amd64,linux/arm64`) using the `apps/web/Dockerfile`.
        *   The image is tagged with a combination of the short git commit SHA and a timestamp (e.g., `$(COMMIT)-$(TIMESTAMP)`). This tag is **snapshotted once at the beginning of the `make` invocation** and used consistently for both the image build and the Helm values update. This prevents mismatches from re-evaluating the timestamp. You can still specify a tag explicitly via `make TAG=my-custom-tag image-web`.
        *   The built image is pushed to `ghcr.io/erauner12/mergeable:<generated_tag>`.
    *   After successfully building and pushing the image, `image-web-bump` then updates the `tag` field in `helm/mergeable/values.yaml` to this same, consistent image tag.

2.  **Deployment Rollout**:
    *   Once the `values.yaml` (or your HelmRelease custom resource if you use GitOps with tools like Flux or ArgoCD) is updated with the new image tag, your Kubernetes deployment needs to be updated.
    *   If you are using a GitOps controller, committing and pushing the change to `values.yaml` should trigger an automatic rollout.
    *   For manual rollouts or direct Helm usage, you might use `helm upgrade` with the updated values.
    *   A quick way to force a redeployment if the image tag in the Deployment spec has changed is `kubectl rollout restart deploy/mergeable -n <your-namespace>`.

### Key Benefits of this Workflow

*   **Consistent Tagging**: The Makefile generates a unique tag by snapshotting the commit and timestamp at the start of its execution. This single, consistent tag is used for both the Docker image and the Helm values, ensuring they always match. The `TAG ?= ...` assignment allows for command-line overrides while still defaulting to the snapshotted value.
*   **Multi-Arch Support**: Builds images for multiple architectures (e.g., `amd64` for CI/servers, `arm64` for local Mac development) by default.
*   **Simplified Updates**: The `image-web-bump` target automates the common task of building, pushing, and updating configuration for a new version.
*   **Avoid `ImagePullBackOff`**: By ensuring the image tag in Kubernetes exactly matches a pushed image tag, this workflow helps prevent `ImagePullBackOff` errors due to non-existent tags.

## One-shot local CI run

```bash
# Runs type-check + lint + full test suite (with coverage):
make ci-check
```

## Manual Helm operations

```bash
# Install/upgrade using helm/mergeable/values.yaml
make helm-up

# Uninstall the dev release
make helm-down

# Restart the Deployment (useful after ConfigMap tweaks)
make helm-rollout
```

All targets accept overrides, e.g.:

```bash
make helm-up K8S_NS=staging HELM_RELEASE=mergeable-test
```