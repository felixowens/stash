# Clip feed browser checks

Requires Node 20+, the UI dependencies, and ffmpeg. Start the populated local
instance, then run the suite:

```sh
./scripts/dev-instance.sh up --ui
cd ui/v2.5
npm exec playwright install chromium
npm run test:clip-feed
```

The config reads the dev instance's URL. `STASH_CLIP_FEED_URL` can override it
with another local development instance.

The tests use generated H.264/AAC clips with a test tone and HTTP byte-range
responses for seeking. Feed queries and clip
mutations are intercepted; configuration comes from the dev instance with the
rating mode fixed to decimal. Desktop and touch projects both run in Chromium.
They verify real video playback and media-element state, not audible output on
an iPhone or Safari autoplay policy. The original 5-10 clip audio symptom still
needs a physical-device check.

The suite covers 100 clip changes across pagination, stable player identity,
sound activation in the input handler, blocked playback, stale rejections,
media-error retry, looping, retained library controls, activity tracking,
background pause/resume, player cleanup on exit, and viewport changes. Failures retain a browser trace;
the controls test also attaches a screenshot. Artifacts are in `test-results/`.
