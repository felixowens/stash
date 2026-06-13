---
name: verify-ui
description: Verify a UI or behavior change by driving the populated dev instance in a real browser — screenshot it and confirm a clean console — before calling the change done. Use after any frontend change.
---

# verify-ui

The prime directive (CLAUDE.md): **a UI change is not done until you've seen it work in a real browser with a clean console.** Compiles ≠ done. This skill is that loop, run the same way every time.

## 1. Make sure a populated instance is up

```
./scripts/dev-instance.sh status      # is it up?
./scripts/dev-instance.sh up          # if not — builds, boots, seeds (~80 performers, 25 studios, 40 tags)
./scripts/dev-instance.sh url         # the base URL (http://localhost:99xx)
```

- Iterating on UI code? `up --ui` also starts the **vite hot-reload** UI so edits show on refresh without a rebuild.
- After a **backend** change: `./scripts/dev-instance.sh restart` (rebuild + reseed) first, or the binary is stale.

## 2. Open the page(s) your change touched

Drive the **chrome-devtools** MCP:

- `new_page` to `<url>/<path>` (or `navigate_page` if a page is already open).
- Populated routes: `/performers`, `/studios`, `/tags`, `/stats`. *(`/scenes`, `/images`, `/galleries`, `/groups` are empty — the seed has no media files.)*
- **Always also open the specific page your change affects** — a performer detail page, an edit panel, a modal — not just the list.

## 3. Actually look

`take_screenshot` and inspect it: is the change present, correct, and not visually broken (layout, overflow, spacing, contrast)? Don't infer from the diff — look at the pixels.

## 4. Assert a clean console

`list_console_messages` — there must be **no errors and no new warnings**. A red console means not-done even if the screenshot looks fine. If a message is pre-existing/unrelated noise, say so explicitly rather than ignoring it silently.

## 5. Verdict

**Looks right AND console clean → done.** Otherwise fix and repeat from step 2.

---

- Suspect a server-side error? Tail the backend log in parallel: `./scripts/dev-instance.sh logs -f`.
- The seed RNG is fixed, so content is stable run-to-run — screenshots are comparable across iterations.
- Need a specific state to verify against (empty library, a performer with N images, an edge-case name)? Extend `scripts/dev-seed.py` — it's plain stdlib Python.
