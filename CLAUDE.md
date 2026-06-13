# CLAUDE.md

**Stash** — a self-hosted media organizer (Go backend + React/TypeScript UI) that catalogs scenes, performers, studios, tags, galleries, and images. This repository is **your own product**: owned and run by you, deployed to your homelab, and you are its sole maintainer.

## Own it. Don't be timid.

This is **not** a community open-source project you're contributing to. There is no upstream maintainer to please, no PR review to pass, no rebase to keep clean. You own every line.

- **Make breaking changes freely.** Restructure modules, change APIs, rip out code that's in the way. If a change is the right design, make it — don't preserve old behavior "to be safe."
- **Schema migrations are routine, not scary.** Altering the database is a normal part of building a feature here (see [Migrations](#migrations)).
- **Delete cruft.** This codebase carries features and abstractions you don't use. Remove dead weight when it's in your way.
- **Ignore the upstream lineage.** The Go module path is `github.com/stashapp/stash` and some code references "stash" — that's historical (renaming the module = thousands of pointless import edits) and does **not** mean you're a guest. Don't slip into a cautious-contributor mindset just because the code resembles a well-known project. It's yours.
- The one real constraint: this runs in **production** (your homelab, your real library). Boldness ≠ carelessness — don't ship what you haven't **verified running** (next section).

## Prime directive: verify changes by running them

The #1 past failure was shipping UI changes that looked right in the diff but were broken or visually wrong. **A change is not done until you've seen it work in a real browser.**

For any UI or behavior change:
1. `./scripts/dev-instance.sh up` — spins up a populated instance and prints its URL (`http://localhost:99xx`).
2. Drive it with the **chrome-devtools** MCP: `new_page` / `navigate_page` to the relevant page, then `take_screenshot` and actually look.
3. `list_console_messages` (errors + warns) must be **clean**.
4. "Looks right **and** no console errors" = done. *Compiles ≠ done.*

After backend changes: `./scripts/dev-instance.sh restart` (rebuilds + reboots). Tail logs with `./scripts/dev-instance.sh logs -f`.

## The dev instance — `scripts/dev-instance.sh`

One command → a throwaway, **populated** Stash you can drive. No setup wizard (writing a config makes the system "already set up"); a fresh SQLite DB is auto-created, migrated to the current schema, then seeded over the GraphQL API with ~80 performers (with the multi-image collection), 25 studios, and 40 tags.

| Command | Does |
|---|---|
| `up [--ui]` | build, boot on a free port, seed. `--ui` also starts the vite hot-reload UI |
| `down` | stop and remove the instance (state lives in `.dev/`, gitignored) |
| `restart` | rebuild backend + reboot, fresh seed |
| `status` / `url` | where it is |
| `logs [-f]` | backend log |
| `gql '<query>' '[vars-json]'` | POST a GraphQL query to the running instance |

Seeding logic + data live in `scripts/dev-seed.py` (stdlib only). Extend it to construct specific scenarios you need to verify against.

## Architecture — where things live

A change usually flows through these layers, top to bottom:

**Backend (Go)**
- **GraphQL schema** — `graphql/schema/types/*.graphql` (split by domain). The contract.
- **Resolvers** — `internal/api/resolver_{query,mutation,model}_*.go`. Thin; translate GraphQL ↔ services.
- **Domain logic / services** — `pkg/<entity>/` (e.g. `pkg/performer/`, `pkg/scene/`).
- **Persistence** — `pkg/sqlite/<entity>.go` (repos) + `pkg/sqlite/<entity>_filter.go` (querying).
- **Models** — `pkg/models/` (entities, inputs, interfaces).
- **Server / lifecycle** — `internal/api/server.go`, `internal/manager/`.

**Frontend** (`ui/v2.5/`, React + TS, pnpm + vite)
- `src/components/` — pages and components (e.g. `components/Performers/`).
- `src/core/` — GraphQL operations per entity (`performers.ts`, …) + the generated Apollo client `src/core/generated-graphql.ts`.
- `src/hooks/`, `src/models/`, `src/utils/`.

## GraphQL codegen — the #1 thing that breaks the build

The schema drives **two** generators. After editing `graphql/schema/**`:

```
make generate          # regenerates BOTH backend (Go) and UI (src/core/generated-graphql.ts)
```

Forgetting this leaves stale generated types → the backend won't build or the UI types won't match the API. Always regenerate after a schema change, then build. `make generate-backend` / `make generate-ui` do one side.

**Verify it:** `./scripts/check-codegen.sh` regenerates and fails if the committed output was stale — use it before a build or in CI. *(Editing any `.graphql` file also fires a hook reminder — see `scripts/hooks/post-edit-guard.py`.)*

## Migrations

**Fast path:** `./scripts/new-migration.sh <snake_name> [--go]` computes the next `NN`, writes `NN_<name>.up.sql`, **bumps `appSchemaVersion` for you**, and with `--go` drops a compiling `NN_postmigrate.go` stub. Then write your DDL and `./scripts/dev-instance.sh restart`.

By hand (what the script automates):
1. Add `pkg/sqlite/migrations/NN_<name>.up.sql`, where `NN` = next number (highest is currently **86**). Files auto-embed via `//go:embed migrations/*.sql`.
2. **Bump `appSchemaVersion` in `pkg/sqlite/database.go`** (currently `= 86`). *This is the step that's easy to forget* — without it the new file is ignored and the DB silently won't migrate. *(Hand-writing a migration file fires a hook reminder about this.)*
3. For data transforms (not just DDL), add `pkg/sqlite/migrations/NN_postmigrate.go`, registered via `sqlite.RegisterPostMigration(NN, postNN)` — see existing `*_postmigrate.go` / `84_migrate.go` for the pattern (`--go` scaffolds it).

The dev instance builds its DB at the current `appSchemaVersion`, so after adding a migration just `dev-instance.sh restart` to get a DB on the new schema.

## Build / check

- `make stash` — build the backend (embeds the prebuilt UI from `ui/v2.5/build`).
- `make ui` — rebuild the embedded UI. `make pre-ui` — install UI deps (run once).
- `make lint` / `make test` / `make it` (integration) / `make validate` (everything).
- The fast inner loop is the **dev instance**, not full builds.

## Your custom features (extend, don't reinvent)

This build diverges from stock Stash here — know these before touching related code:
- **Performer multi-image collection** — migration 86; schema `Performer.images: [PerformerImage!]!` and `PerformerCreateInput.images`; multi-image edit tray in the UI. *(Known bug: the `image_count` resolver returns 0.)*
- **Stash-box metadata import** — import full metadata from a manual stash-box scene search.
- **Decimal rating input** — idiomatic decimal rating control.
- **Fork version badge** — version indicator in the navbar utility area.

## Deploy (don't worry about it mid-dev)

Shipping to the homelab (ripley) is handled by the **deploy-stash** skill: commit on branch `felix` → CI builds a native image → GHCR → ansible pin → ripley. You don't touch this during feature work; just commit when asked.
