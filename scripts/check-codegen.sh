#!/usr/bin/env bash
#
# check-codegen.sh — fail if the checked-in generated GraphQL code is stale.
#
# The schema in graphql/schema/** drives TWO generators:
#   • backend gqlgen  -> internal/api/generated_exec.go, generated_models.go
#   • UI gql-gen      -> ui/v2.5/src/core/generated-graphql.ts
# Forgetting `make generate` after a schema edit is the #1 thing that breaks the
# build. This runs both generators and fails if the result differs from what's
# committed — i.e. the generated files were out of date with the schema.
#
# Exit 0: up to date.  Exit 1: was stale (now regenerated in your working tree —
# review and stage the changes). Usable from a pre-commit hook, CI, or by hand.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

GENERATED=(
  internal/api/generated_exec.go
  internal/api/generated_models.go
  ui/v2.5/src/core/generated-graphql.ts
)

echo "regenerating (gqlgen backend + UI gql-gen)…" >&2
make generate >&2

if git diff --quiet --exit-code -- "${GENERATED[@]}"; then
  echo "✓ codegen is up to date with the schema" >&2
  exit 0
fi

echo >&2
echo "✗ generated code was STALE — regeneration changed:" >&2
git diff --name-only -- "${GENERATED[@]}" | sed 's/^/    /' >&2
echo >&2
echo "  Fixed in your working tree. Review and stage the files above, then" >&2
echo "  rebuild. (This is the codegen step CLAUDE.md warns about.)" >&2
exit 1
