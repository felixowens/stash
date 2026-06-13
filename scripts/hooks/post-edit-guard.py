#!/usr/bin/env python3
"""PostToolUse guard — just-in-time reminders for this repo's two silent footguns.

Wired from .claude/settings.json with matcher "Edit|Write|MultiEdit". The matcher
only filters by tool *name*, so we gate on the edited file path here, read from
the hook's stdin JSON (tool_input.file_path). On a match we print an
`additionalContext` note that the model reads after the edit — non-blocking,
always exit 0 so the tool flow is never disrupted.

The two footguns (both called out in CLAUDE.md):
  1. Editing graphql/schema/** without re-running `make generate` (dual codegen).
  2. Adding a migration without bumping appSchemaVersion (file silently ignored).
"""
import json
import sys


def remind(text):
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": text,
            }
        },
        sys.stdout,
    )
    sys.exit(0)


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # never break the tool flow on unexpected input

    path = (data.get("tool_input") or {}).get("file_path") or ""
    if not path:
        sys.exit(0)

    norm = path.replace("\\", "/")
    base = norm.rsplit("/", 1)[-1]

    # 1) GraphQL schema / operations → both generators must be re-run.
    if norm.endswith(".graphql"):
        remind(
            f"You edited a GraphQL file ({base}). The schema drives codegen for BOTH "
            "the Go backend and the UI — run `make generate` before building, or "
            "`./scripts/check-codegen.sh` to verify. Stale generated code is the #1 "
            "build breaker in this repo."
        )

    # 2) Hand-written DB migration → the appSchemaVersion bump is easy to forget.
    if "/pkg/sqlite/migrations/" in norm and norm.endswith(".sql"):
        remind(
            f"You added a migration ({base}). Bump `appSchemaVersion` in "
            "pkg/sqlite/database.go to its number or it's silently ignored and the DB "
            "won't migrate. (`./scripts/new-migration.sh <name>` scaffolds + bumps in "
            "one step.)"
        )

    sys.exit(0)


if __name__ == "__main__":
    main()
