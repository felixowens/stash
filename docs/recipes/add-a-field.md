# Recipe: add a field end-to-end

How to add a new resolver-backed field to an entity, through every layer, the
way it actually works in this repo. Worked example: **`Performer.image_collection_count`**
— the size of the performer's headshot collection — surfaced as a card badge and
a sortable "Photos" column. (Commit it in one go; see the real diff in git log.)

> **First: is it really a new field?** Root-cause the existing behaviour before
> adding anything. `image_collection_count` exists *because* `image_count` already
> meant something else (stock: library images a performer appears in). Two
> similarly-named tables — `performer_images` (the headshot collection) vs
> `performers_images` (the stock join) — made it look like a bug when it wasn't.
> Confirm semantics with a live GraphQL query (`dev-instance.sh gql '{...}'`)
> before writing code.

The flow, top to bottom. A pure-display field stops after step 6; add the sort
(step 7) and UI (step 8) only if you need them.

## 1. Schema — the contract

Add the field to `graphql/schema/types/<entity>.graphql`. The `# Resolver`
comment marks it as resolver-backed (not auto-bound to the Go model struct):

```graphql
image_count: Int! # Resolver
# Size of the headshot collection (performer_images), distinct from
# image_count (library images the performer appears in).
image_collection_count: Int! # Resolver
```

## 2. Regenerate — the #1 build breaker

The schema drives **two** generators (Go backend + UI types):

```sh
make generate                 # both. ALWAYS run after a schema edit.
./scripts/check-codegen.sh    # verifies nothing is stale (use in CI / pre-commit)
```

Skip this and the backend won't build or the UI types won't match the API.
(Editing a `.graphql` file also fires the hook in `scripts/hooks/post-edit-guard.py`.)

## 3. Persistence — the store method

Add the read to `pkg/sqlite/<entity>.go`. For a small collection, counting the
existing tested read path is fine (the *sort* uses a real SQL COUNT — step 7):

```go
// GetImageCount returns the number of images in the performer's headshot
// collection (performer_images). Backs the image_collection_count field.
func (qb *PerformerStore) GetImageCount(ctx context.Context, performerID int) (int, error) {
	checksums, err := qb.GetImageChecksums(ctx, performerID)
	if err != nil {
		return 0, err
	}
	return len(checksums), nil
}
```

## 4. Interface + mocks — the easy-to-miss compile break

Declare the method on the reader interface in `pkg/models/repository_<entity>.go`:

```go
// GetImageCount returns the number of images in the performer's headshot
// collection (performer_images). Backs the image_collection_count field.
GetImageCount(ctx context.Context, performerID int) (int, error)
```

**Changing the interface breaks the generated mocks** — the build will fail with
`*PerformerStore does not implement ... (missing method GetImageCount)`. Fix with
`make generate-test-mocks` (runs mockery via `go run`, regenerates everything), or
hand-add the method to `pkg/models/mocks/<Entity>ReaderWriter.go` mirroring a
sibling (cheaper, no version churn).

## 5. Resolver — GraphQL ↔ service

Add the method to `internal/api/resolver_model_<entity>.go`, mirroring the
sibling counts (`SceneCount`, etc.):

```go
func (r *performerResolver) ImageCollectionCount(ctx context.Context, obj *models.Performer) (ret int, err error) {
	if err := r.withReadTxn(ctx, func(ctx context.Context) error {
		ret, err = r.repository.Performer.GetImageCount(ctx, obj.ID)
		return err
	}); err != nil {
		return 0, err
	}
	return ret, nil
}
```

`go build ./...` should now pass. Quick contract check against a running instance:
`./scripts/dev-instance.sh gql '{ findPerformers(filter:{per_page:1}){ performers { image_collection_count } } }'`

## 6. (optional) Make it sortable

In `pkg/sqlite/<entity>.go`, two edits:

1. Add the sort key to the allow-list (`performerSortOptions` — the CVE-2024-32231
   guard rejects anything not listed):
   ```go
   "image_collection_count",
   ```
2. Add a case to `getPerformerSort`, using `getCountSort` (emits
   `ORDER BY (SELECT COUNT(*) FROM <joinTable> WHERE ... = performers.id)`):
   ```go
   case "image_collection_count":
       sortQuery += getCountSort(performerTable, performerImagesTable, performerIDColumn, direction)
   ```
   Note `performerImagesTable` (the headshot table) — not `performersImagesTable`.

## 7. UI — fragment, then components

1. Add the field to the fragment in `ui/v2.5/graphql/data/<entity>.graphql`:
   ```graphql
   image_count
   image_collection_count
   gallery_count
   ```
2. **Regenerate UI types** so the fragment type and query include it:
   ```sh
   make generate-ui
   ```
   Until you do, `performer.image_collection_count` won't typecheck.
3. Use it. Card badge (`PerformerCard.tsx`) — shown only when there's an actual
   collection; list column + sort option mirror the existing `image_count` ones
   (`PerformerListTable.tsx`, `models/list-filter/performers.ts`).
4. Add an i18n label in `ui/v2.5/src/locales/en-GB.json` (a missing key logs a
   console error, which fails verification):
   ```json
   "image_collection_count": "Photos",
   ```
5. Typecheck: `cd ui/v2.5 && pnpm exec tsc --noEmit`.

## 8. Verify by running it — not "it compiles"

```sh
./scripts/dev-instance.sh restart --ui --scenario multi-image
```

Then drive chrome-devtools (or `/verify-ui`): open the list + a detail page,
screenshot and actually look, sort by the new field, and confirm
`list_console_messages` is clean. Compiles ≠ done.

---

**Files this example touched:** `graphql/schema/types/performer.graphql` ·
`internal/api/resolver_model_performer.go` · `pkg/sqlite/performer.go` ·
`pkg/models/repository_performer.go` · `pkg/models/mocks/PerformerReaderWriter.go` ·
generated (`internal/api/generated_*.go`, `ui/.../generated-graphql.ts`) ·
`ui/v2.5/graphql/data/performer.graphql` · `PerformerCard.tsx` ·
`PerformerListTable.tsx` · `models/list-filter/performers.ts` · `en-GB.json`.
