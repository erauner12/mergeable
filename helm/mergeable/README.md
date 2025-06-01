# mergeable

![Version: 0.0.1](https://img.shields.io/badge/Version-0.0.1-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 0.0.1](https://img.shields.io/badge/AppVersion-0.0.1-informational?style=flat-square)

A Helm chart for Mergeable, a better inbox for GitHub pull requests.

## Installation

If you built the chart from this fork, install with:
`helm install mergeable oci://ghcr.io/erauner12/helm/mergeable --version 0.0.<run-id>`

### Quick local iteration

```bash
# Build & push a multi-arch image tagged with <commit>-<timestamp>
make image-web

# …or build & automatically bump the HelmRelease to roll the dev cluster
make image-web-bump
```

ℹ️  The first run creates a `multiarch` buildx builder; after that builds are incremental & fast.

### Building & publishing a local Docker image (multi-arch)

```bash
# One-liner (creates/uses a buildx builder, builds the web bundle,
# publishes linux/amd64 + linux/arm64 layers, and tags with current git SHA):
make image-web       # result: ghcr.io/erauner12/mergeable:<sha>

# Custom tag or platforms:
make image-web TAG=my-test PLATFORMS=linux/amd64
```

> **Why buildx + two platforms?**
> Our homelab runs **amd64** nodes, while laptops are often **arm64**.
> Publishing a multi-arch manifest guarantees that any node can pull the image and prevents the `no match for platform in manifest` error.
>
> *Note: The very first `make image-web` run might take a few seconds longer as it sets up the BuildKit builder.*

### Cleanup tip

If at some point you *only* want `arm64` (say, for quick laptop testing) you can override:

```bash
make image-web PLATFORMS=linux/arm64 TAG=arm64-only
```

…but the default should remain the safe multi-arch combo.

## Maintainers

| Name  | Email | Url |
| ----- | ----- | --- |
| pvcnt |       |     |

## Values

| Key                                | Type   | Default                     | Description |
| ---------------------------------- | ------ | --------------------------- | ----------- |
| affinity                           | object | `{}`                        |             |
| env                                | object | `{}`                        |             |
| fullnameOverride                   | string | `""`                        |             |
| image.pullPolicy                   | string | `"Always"`                  |             |
| image.repository                   | string | `"ghcr.io/erauner12/mergeable"` |             |
| image.tag                          | string | `"latest"`                  |             |
| imagePullSecrets                   | list   | `[]`                        |             |
| ingress.annotations                | object | `{}`                        |             |
| ingress.className                  | string | `""`                        |             |
| ingress.enabled                    | bool   | `false`                     |             |
| ingress.hosts[0].host              | string | `"chart-example.local"`     |             |
| ingress.hosts[0].paths[0].path     | string | `"/"`                       |             |
| ingress.hosts[0].paths[0].pathType | string | `"ImplementationSpecific"`  |             |
| ingress.tls                        | list   | `[]`                        |             |
| nameOverride                       | string | `""`                        |             |
| nodeSelector                       | object | `{}`                        |             |
| podAnnotations                     | object | `{}`                        |             |
| podLabels                          | object | `{}`                        |             |
| podSecurityContext                 | object | `{}`                        |             |
| replicaCount                       | int    | `1`                         |             |
| resources                          | object | `{}`                        |             |
| securityContext                    | object | `{}`                        |             |
| service.port                       | int    | `80`                        |             |
| service.type                       | string | `"ClusterIP"`               |             |
| serviceAccount.annotations         | object | `{}`                        |             |
| serviceAccount.automount           | bool   | `true`                      |             |
| serviceAccount.create              | bool   | `true`                      |             |
| serviceAccount.name                | string | `""`                        |             |
| tolerations                        | list   | `[]`                        |             |
| volumeMounts                       | list   | `[]`                        |             |
| volumes                            | list   | `[]`                        |             |