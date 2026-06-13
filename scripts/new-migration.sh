#!/usr/bin/env bash
#
# new-migration.sh — scaffold the next DB migration AND bump appSchemaVersion in
# one step. The bump is the easy-to-forget half: without it the new .up.sql is
# silently ignored and the DB never migrates (see CLAUDE.md → Migrations).
#
# Usage:
#   scripts/new-migration.sh <snake_case_name> [--go]
#     <snake_case_name>  short description, e.g. scene_color_grade
#     --go               also scaffold an NN_postmigrate.go for data transforms
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$REPO/pkg/sqlite/migrations"
DBGO="$REPO/pkg/sqlite/database.go"

raw="${1:-}"; [ -n "$raw" ] || { echo "usage: $(basename "$0") <snake_case_name> [--go]" >&2; exit 2; }
shift || true
want_go=0
for a in "$@"; do case "$a" in --go) want_go=1 ;; *) echo "unknown flag: $a" >&2; exit 2 ;; esac; done

# normalise to snake_case
name="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | tr ' -' '__' | tr -cd '[:alnum:]_')"
[ -n "$name" ] || { echo "name is empty after sanitising" >&2; exit 2; }

# highest NN across both .sql and .go migration files
last="$(ls "$MIG" | grep -oE '^[0-9]+' | sort -n | tail -1)"
[ -n "$last" ] || { echo "could not determine last migration number" >&2; exit 1; }
next=$((last + 1))

# current appSchemaVersion — should equal $last
cur="$(grep -oE 'appSchemaVersion uint = [0-9]+' "$DBGO" | grep -oE '[0-9]+$')"
if [ "$cur" != "$last" ]; then
  echo "⚠ appSchemaVersion ($cur) != last migration ($last) — they were out of sync." >&2
  echo "  Setting appSchemaVersion to $next to match the new migration." >&2
fi

upsql="$MIG/${next}_${name}.up.sql"
[ -e "$upsql" ] && { echo "already exists: $upsql" >&2; exit 1; }

cat >"$upsql" <<SQL
-- ${next}: ${name//_/ }
-- <describe the schema change; this DDL runs automatically on the next boot>

SQL

# bump the version constant
sed -i "s/appSchemaVersion uint = ${cur}/appSchemaVersion uint = ${next}/" "$DBGO"

made_go=""
if [ "$want_go" -eq 1 ]; then
  gofile="$MIG/${next}_postmigrate.go"
  cat >"$gofile" <<GO
package migrations

import (
	"context"

	"github.com/jmoiron/sqlx"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/stashapp/stash/pkg/sqlite"
)

// post${next} runs after ${next}_${name}.up.sql has been applied. Use it for
// data transforms that are awkward in pure SQL. Delete this file if the .up.sql
// is all you need.
func post${next}(ctx context.Context, db *sqlx.DB) error {
	logger.Infof("Running post-migration for schema version ${next}")

	m := migrator{db: db}
	return m.withTxn(ctx, func(tx *sqlx.Tx) error {
		// TODO: transform data here, e.g.
		//   _, err := tx.Exec("UPDATE …")
		//   return err
		return nil
	})
}

func init() {
	sqlite.RegisterPostMigration(${next}, post${next})
}
GO
  made_go="$gofile"
fi

echo "✓ migration ${next} scaffolded:" >&2
echo "    ${upsql#"$REPO"/}" >&2
[ -n "$made_go" ] && echo "    ${made_go#"$REPO"/}" >&2
echo "    bumped appSchemaVersion ${cur} → ${next} in pkg/sqlite/database.go" >&2
echo >&2
echo "  next: write the DDL, then ./scripts/dev-instance.sh restart to migrate a fresh DB." >&2
