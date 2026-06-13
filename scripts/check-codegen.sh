#!/usr/bin/env bash
#
# check-codegen.sh — fail if the on-disk generated GraphQL code is stale.
#
# The schema in graphql/schema/** drives TWO generators:
#   • backend gqlgen  -> internal/api/generated_exec.go, generated_models.go
#   • UI gql-gen      -> ui/v2.5/src/core/generated-graphql.ts
# Forgetting `make generate` after a schema edit is the #1 thing that breaks the
# build — and `make stash` does NOT regenerate, it compiles whatever's on disk,
# so a stale generated_exec.go means a broken or wrong build.
#
# These generated files are gitignored (CI regenerates them), so `git diff`
# can't detect staleness — we hash them, regenerate, and compare hashes.
#
# Exit 0: up to date.  Exit 1: was stale (now regenerated on disk — rebuild and
# re-test). Usable from a pre-commit hook, CI, or by hand.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

GENERATED=(
  internal/api/generated_exec.go
  internal/api/generated_models.go
  ui/v2.5/src/core/generated-graphql.ts
)

# Hash content, ignoring the UI generator's non-deterministic timestamp header
# (`// Generated on <ts>`) so an unchanged schema doesn't look stale.
hash_one() { if [ -f "$1" ]; then grep -v '^// Generated on ' "$1" | sha256sum | cut -d' ' -f1; else echo MISSING; fi; }

declare -A before
for f in "${GENERATED[@]}"; do before["$f"]="$(hash_one "$f")"; done

echo "regenerating (gqlgen backend + UI gql-gen)…" >&2
make generate >&2

stale=()
for f in "${GENERATED[@]}"; do
  [ "${before[$f]}" != "$(hash_one "$f")" ] && stale+=("$f")
done

if [ "${#stale[@]}" -eq 0 ]; then
  echo "✓ codegen is up to date with the schema" >&2
  exit 0
fi

echo >&2
echo "✗ generated code was STALE — regeneration changed:" >&2
printf '    %s\n' "${stale[@]}" >&2
echo >&2
echo "  Fixed on disk. Rebuild (make stash / dev-instance restart) and re-test." >&2
echo "  (This is the codegen step CLAUDE.md warns about.)" >&2
exit 1
