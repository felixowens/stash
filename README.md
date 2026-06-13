# Stash

A self-hosted web app (Go + React) that organizes and serves a personal media library — scenes, performers, studios, tags, galleries, and images — with metadata scraping, rich filtering, and statistics. This is my personal build, maintained for my homelab.

## Run

The app serves its UI on `http://localhost:9999` by default. On first run it walks you through pointing it at your media directories and scanning them.

Deployment to my homelab (ripley) is handled by the `deploy-stash` workflow: CI builds a native image → GHCR → ansible pin. The runbook lives in the homelab repo (`docs/stash-fork.md`).

## Develop

- **[`CLAUDE.md`](CLAUDE.md)** — start here. Architecture map, the GraphQL-codegen and migration gotchas, and the verify-by-running-it loop.
- **Fast loop:** `./scripts/dev-instance.sh up` spins up a throwaway, *populated* instance to build and verify against (drive it with chrome-devtools). `down` tears it down.
- **[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)** — toolchain prerequisites and the full set of `make` targets.

## License

AGPL-3.0 — see [LICENSE](LICENSE). Built on the Stash codebase.
