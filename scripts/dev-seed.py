#!/usr/bin/env python3
"""Seed a running Stash dev instance with realistic data over the GraphQL API.

Why the API and not a direct DB insert: the old scripts/test_db_generator no
longer compiles (upstream moved the pkg/file types), and seeding through the
real API can never drift from the schema. It also exercises the actual
mutations — including the fork's performer `images` collection — so the seed
doubles as a smoke test of the write path.

Scenarios let you boot into a *specific* state to verify against:

    default      ~80 performers / 25 studios / 40 tags, 1-3 images each (the norm)
    minimal      a handful of each — fast boot for a quick visual check
    empty        nothing — verify empty-state UI / a clean library
    multi-image  fewer performers, but 2-4 images each — exercise the collection
    faces        like multi-image, but real photos from assets/face/ (gitignored)
                 with ratings skewed high — to judge the holographic foil card
                 on actual headshots
    edge         gnarly names (unicode, emoji, very long, quotes, XSS probe) to
                 catch rendering/escaping bugs

When real videos are present in assets/scenes/ (gitignored), every scenario
except empty/edge points a library at them, scans them into real playable
scenes, and assigns studios/performers/tags — so the instance has genuine
video to drive the scene player and the clips feature.

Usage:
    dev-seed.py --url http://localhost:PORT [--scenario NAME]
                [--performers N] [--studios N] [--tags N] [--dry-run]

Explicit --performers/--studios/--tags override the scenario's counts.
Reads name word-lists from scripts/test_db_generator/*.txt. Stdlib only.
"""
import argparse
import base64
import json
import os
import random
import re
import struct
import sys
import time
import urllib.request
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
WORDS = os.path.join(HERE, "test_db_generator")
ASSETS = os.path.join(os.path.dirname(HERE), "assets")
GENDERS = ["FEMALE", "MALE", "NON_BINARY", "TRANSGENDER_FEMALE"]
COUNTRIES = ["US", "GB", "DE", "FR", "JP", "BR", "CA", "AU", "SE", "CZ"]

# scenario -> default counts + knobs. images is the (min, max) per performer.
SCENARIOS = {
    "default":     {"performers": 80, "studios": 25, "tags": 40, "scenes": True},
    "minimal":     {"performers": 6,  "studios": 3,  "tags": 5,  "scenes": True},
    "empty":       {"performers": 0,  "studios": 0,  "tags": 0},
    "multi-image": {"performers": 24, "studios": 6,  "tags": 12, "images": (2, 4),
                    "scenes": True},
    "faces":       {"performers": 24, "studios": 6,  "tags": 12, "images": (2, 4),
                    "real_faces": True, "rating_range": (60, 100), "scenes": True},
    "edge":        {"performers": 0,  "studios": 4,  "tags": 6,  "edge": True},
}

# Names engineered to break naive rendering/escaping. If any of these visibly
# corrupts the UI (or the XSS probe executes), that's the bug the scenario exists
# to surface.
EDGE_NAMES = [
    "Zoë Ñoño-Łódź",
    "李娜 Lǐ Nà",
    "O'Brien-Müller",
    "A Very Long Performer Name That Should Overflow The Card Layout For Sure",
    "𝕬𝖊𝖘𝖙𝖍𝖊𝖙𝖎𝖈 Unicode",
    "emoji 🎬🔥 name",
    "<script>alert('xss')</script>",
    "Ünïcödé Tëst",
    'quote " and \\ backslash',
    "trailing spaces   ",
]


def gql(url, query, variables=None):
    payload = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        url.rstrip("/") + "/graphql",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.load(resp)
    if body.get("errors"):
        raise RuntimeError(json.dumps(body["errors"], indent=2))
    return body["data"]


def png_data_url(color, size=240):
    """A valid solid-colour RGB PNG as a base64 data URL — no PIL needed."""
    r, g, b = color
    row = b"\x00" + bytes([r, g, b]) * size
    raw = row * size

    def chunk(typ, data):
        return (
            struct.pack(">I", len(data))
            + typ
            + data
            + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    blob = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    return "data:image/png;base64," + base64.b64encode(blob).decode()


def load_words(name, fallback):
    path = os.path.join(WORDS, name)
    try:
        with open(path, encoding="utf-8", errors="ignore") as fh:
            words = [w.strip() for w in fh if w.strip()]
        return words or fallback
    except OSError:
        return fallback


# Real face photos live in assets/face/ (gitignored) and back the `faces`
# scenario, so the holographic foil card can be judged on actual headshots.
_FACE_MIMES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def face_image_paths():
    """Paths of usable images in assets/face/, sorted. [] if the dir is absent."""
    face_dir = os.path.join(ASSETS, "face")
    try:
        names = sorted(os.listdir(face_dir))
    except OSError:
        return []
    return [
        os.path.join(face_dir, n)
        for n in names
        if os.path.splitext(n)[1].lower() in _FACE_MIMES
    ]


def face_data_url(path):
    """Read one face image and encode it as a base64 data URL."""
    mime = _FACE_MIMES[os.path.splitext(path)[1].lower()]
    with open(path, "rb") as fh:
        return f"data:{mime};base64," + base64.b64encode(fh.read()).decode()


# Real scene videos live in assets/scenes/ (gitignored). When present, the seed
# points a stash library at them and scans them into real, playable scenes, then
# assigns studios/performers/tags — so the dev instance has genuine video to
# drive (the scene player, and the clips feature in particular).
_SCENE_EXTS = {".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi"}
_DATE_RE = re.compile(r"(20\d{2}-\d{2}-\d{2})")
# Pleasant fallback titles for files whose names are just ids/hashes.
_SCENE_TITLES = [
    "Golden Hour", "Backstage", "Afterglow", "Close Up", "Slow Motion",
    "First Take", "Off the Record", "Night Shift", "Daydream", "B-Roll",
]


def scene_file_paths():
    """Paths of video files in assets/scenes/, sorted. [] if the dir is absent."""
    scene_dir = os.path.join(ASSETS, "scenes")
    try:
        names = sorted(os.listdir(scene_dir))
    except OSError:
        return []
    return [
        os.path.join(scene_dir, n)
        for n in names
        if os.path.splitext(n)[1].lower() in _SCENE_EXTS
    ]


def derive_scene_title_date(path):
    """(title|None, date|None) from a video filename. A None title means the
    name was all ids/hashes — the caller should pick a fallback."""
    stem = os.path.splitext(os.path.basename(path))[0]
    m = _DATE_RE.search(stem)
    date = m.group(1) if m else None
    cleaned = stem.replace(date, " ") if date else stem
    cleaned = cleaned.lstrip("@")
    cleaned = re.sub(r"[0-9a-f]{8,}", " ", cleaned, flags=re.I)  # ids / content hashes
    cleaned = re.sub(r"[_\-]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) < 3 or cleaned.isdigit():
        return None, date
    return cleaned.title(), date


def wait_for_job(url, job_id, timeout=300):
    """Poll findJob until it reaches a terminal status. Returns the final status
    string (or 'TIMEOUT'). A job that has left the queue counts as FINISHED."""
    deadline = time.time() + timeout
    next_tick = 0.0
    while time.time() < deadline:
        job = gql(
            url,
            "query($i: FindJobInput!){ findJob(input:$i){ status progress } }",
            {"i": {"id": job_id}},
        ).get("findJob")
        if job is None:
            return "FINISHED"
        if job["status"] in ("FINISHED", "CANCELLED", "FAILED"):
            return job["status"]
        now = time.time()
        if now >= next_tick:
            print(f"    scanning… {int((job.get('progress') or 0) * 100)}%", file=sys.stderr)
            next_tick = now + 5
        time.sleep(0.5)
    return "TIMEOUT"


def seed_scenes(url, rng, studio_ids, performer_ids, tag_ids, rich):
    """Scan assets/scenes/ into real scenes and assign metadata. No-op if empty."""
    paths = scene_file_paths()
    if not paths:
        return []
    scene_dir = os.path.join(ASSETS, "scenes")
    print(f"  scenes:     {len(paths)} videos in assets/scenes/ — scanning…")

    # Point a library at the videos (config.yml ships with stash:[]) and import.
    gql(
        url,
        "mutation($i: ConfigGeneralInput!){ configureGeneral(input:$i){ stashes{ path } } }",
        {"i": {"stashes": [{"path": scene_dir, "excludeVideo": False, "excludeImage": True}]}},
    )
    job_id = gql(
        url,
        "mutation($i: ScanMetadataInput!){ metadataScan(input:$i) }",
        {"i": {
            "paths": [scene_dir],
            "scanGenerateCovers": True,        # scene-card thumbnails
            "scanGenerateSprites": rich,       # scrubber sprite sheet
            "scanGeneratePreviews": rich,      # hover preview video
        }},
    )["metadataScan"]
    status = wait_for_job(url, job_id)
    if status != "FINISHED":
        print(f"  ! scene scan ended {status} — see instance logs", file=sys.stderr)

    scenes = gql(
        url,
        "query{ findScenes(filter:{per_page:-1}){ scenes{ id files{ path duration } } } }",
    )["findScenes"]["scenes"]

    fallback = list(_SCENE_TITLES)
    rng.shuffle(fallback)
    enriched = 0
    for idx, s in enumerate(scenes):
        path = s["files"][0]["path"] if s.get("files") else ""
        title, date = derive_scene_title_date(path) if path else (None, None)
        upd = {
            "id": s["id"],
            "title": title or fallback[idx % len(fallback)],
            "organized": rng.random() < 0.5,
        }
        if date:
            upd["date"] = date
        if rng.random() < 0.85:
            upd["rating100"] = rng.randint(50, 100)
        if studio_ids and rng.random() < 0.8:
            upd["studio_id"] = rng.choice(studio_ids)
        if performer_ids:
            upd["performer_ids"] = rng.sample(
                performer_ids, k=rng.randint(1, min(3, len(performer_ids)))
            )
        if tag_ids:
            k = rng.randint(0, min(4, len(tag_ids)))
            if k:
                upd["tag_ids"] = rng.sample(tag_ids, k)
        try:
            gql(url, "mutation($i: SceneUpdateInput!){ sceneUpdate(input:$i){ id } }", {"i": upd})
            enriched += 1
        except RuntimeError as exc:
            print(f"  scene {s['id']} enrich failed: {exc}", file=sys.stderr)
    print(f"  scenes:     {enriched} imported + enriched"
          + ("" if rich else " (covers only)"))
    return [
        {"id": s["id"], "duration": (s["files"][0]["duration"] if s.get("files") else 0) or 0}
        for s in scenes
    ]


# A few sample clips on the seeded scenes, so /clips and the Scene→Clips panel
# are populated on boot. clipCreate inherits the scene's performers + studio and
# enqueues thumbnail generation; we wait for the job queue to drain so the cards
# have real art rather than the pending placeholder.
_CLIP_TITLES = [
    "Best Bit", "The Reveal", "Highlight", "Intro", "Punchline",
    "The Drop", "Key Moment", "Teaser", "Cold Open", "Outro",
]


def wait_for_queue(url, timeout=180):
    """Block until no job is queued/running (clip thumbnail generation done)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        jobs = gql(url, "query{ jobQueue{ status } }").get("jobQueue") or []
        if not any(j["status"] in ("READY", "RUNNING", "STOPPING") for j in jobs):
            return
        time.sleep(0.5)


def seed_clips(url, rng, scenes, max_clips=3):
    """Create up to max_clips clips spread across the longest seeded scenes."""
    usable = sorted(
        (s for s in scenes if s["duration"] >= 4),
        key=lambda s: s["duration"], reverse=True,
    )
    if not usable:
        return
    titles = list(_CLIP_TITLES)
    rng.shuffle(titles)
    made = 0
    for s in usable:
        if made >= max_clips:
            break
        dur = s["duration"]
        length = min(rng.uniform(3, 6), dur - 0.5)        # 3-6s, but fits the scene
        start = round(rng.uniform(0, max(0.0, dur - length - 0.5)), 1)
        inp = {
            "scene_id": s["id"],
            "start_seconds": start,
            "end_seconds": round(start + length, 1),
            "title": titles[made % len(titles)],
        }
        if rng.random() < 0.7:
            inp["rating100"] = rng.randint(60, 100)
        try:
            gql(url, "mutation($i: ClipCreateInput!){ clipCreate(input:$i){ id } }", {"i": inp})
            made += 1
        except RuntimeError as exc:
            print(f"  clip on scene {s['id']} failed: {exc}", file=sys.stderr)
    if made:
        print(f"  clips:      {made} created — generating thumbnails…")
        wait_for_queue(url)
        print(f"  clips:      {made} on scenes (thumbnails ready)")


def performer_names(rng, count, edge, female, male, surname):
    """Return a list of (name, gender) specs to create."""
    specs = []
    if edge:
        for name in EDGE_NAMES:
            specs.append((name, rng.choice(GENDERS)))
    for _ in range(count):
        gender = rng.choices(GENDERS, weights=[70, 18, 6, 6])[0]
        first = rng.choice(female if "FEMALE" in gender else male)
        specs.append((f"{first} {rng.choice(surname)}", gender))
    return specs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--scenario", choices=sorted(SCENARIOS), default="default")
    ap.add_argument("--performers", type=int, help="override scenario count")
    ap.add_argument("--studios", type=int, help="override scenario count")
    ap.add_argument("--tags", type=int, help="override scenario count")
    ap.add_argument("--dry-run", action="store_true",
                    help="resolve + preview without touching the API")
    ap.add_argument("--seed", type=int, default=1234, help="RNG seed for reproducibility")
    args = ap.parse_args()
    rng = random.Random(args.seed)

    sc = SCENARIOS[args.scenario]
    n_perf = args.performers if args.performers is not None else sc["performers"]
    n_studio = args.studios if args.studios is not None else sc["studios"]
    n_tag = args.tags if args.tags is not None else sc["tags"]
    img_lo, img_hi = sc.get("images", (1, 3))
    edge = sc.get("edge", False)
    real_faces = sc.get("real_faces", False)
    rating_lo, rating_hi = sc.get("rating_range", (30, 100))

    female = load_words("female.txt", ["Ava", "Mia", "Zoe"])
    male = load_words("male.txt", ["Max", "Leo", "Sam"])
    surname = load_words("surname.txt", ["Stone", "Vale", "Cross"])
    studio_words = load_words("studio.txt", ["Apex", "Lumen", "Vertex"])
    tag_pool = load_words("scene.txt", ["solo", "duo", "outdoor", "vintage"])

    specs = performer_names(rng, n_perf, edge, female, male, surname)

    print(f"  scenario:   {args.scenario}  (images {img_lo}-{img_hi}/performer)")

    if args.dry_run:
        print(f"  would create: {len(specs)} performers, {n_studio} studios, {n_tag} tags")
        if real_faces:
            print(f"  real faces in assets/face/: {len(face_image_paths())}")
        if sc.get("scenes"):
            sp = scene_file_paths()
            print(f"  scenes from assets/scenes/: {len(sp)}")
            for p in sp:
                t, d = derive_scene_title_date(p)
                print(f"    - {os.path.basename(p)} -> {t or '(fallback title)'}"
                      + (f" [{d}]" if d else ""))
        for name, gender in specs[:8]:
            print(f"    - {name!r} [{gender}]")
        if len(specs) > 8:
            print(f"    … and {len(specs) - 8} more")
        return

    # Tags
    tag_ids = []
    seen = set()
    for _ in range(n_tag):
        name = rng.choice(tag_pool).title()
        if name in seen:
            name = f"{name} {rng.randint(2, 99)}"
        seen.add(name)
        data = gql(
            args.url,
            "mutation($i: TagCreateInput!){ tagCreate(input:$i){ id } }",
            {"i": {"name": name}},
        )
        tag_ids.append(data["tagCreate"]["id"])
    print(f"  tags:       {len(tag_ids)}")

    # Studios
    studio_ids = []
    seen = set()
    for _ in range(n_studio):
        name = " ".join(rng.sample(studio_words, k=min(2, len(studio_words)))).title()
        if name in seen:
            name = f"{name} {rng.randint(2, 99)}"
        seen.add(name)
        i = {"name": name}
        if rng.random() < 0.6:
            i["rating100"] = rng.randint(40, 100)
        data = gql(
            args.url,
            "mutation($i: StudioCreateInput!){ studioCreate(input:$i){ id } }",
            {"i": i},
        )
        studio_ids.append(data["studioCreate"]["id"])
    print(f"  studios:    {len(studio_ids)}")

    # Performers — with the fork's multi-image `images` collection. The `faces`
    # scenario fills that collection with real photos from assets/face/.
    face_paths = face_image_paths() if real_faces else []
    use_faces = real_faces and bool(face_paths)
    if real_faces and not face_paths:
        print("  ! no images in assets/face/ — falling back to colour blocks",
              file=sys.stderr)
    if use_faces:
        print(f"  faces:      {len(face_paths)} real images from assets/face/")

    made = 0
    performer_ids = []
    for name, gender in specs:
        n_imgs = rng.randint(img_lo, img_hi)
        if use_faces:
            images = [
                face_data_url(p)
                for p in rng.sample(face_paths, k=min(n_imgs, len(face_paths)))
            ]
        else:
            images = [
                png_data_url(
                    (rng.randint(40, 230), rng.randint(40, 230), rng.randint(40, 230))
                )
                for _ in range(n_imgs)
            ]
        i = {
            "name": name,
            "gender": gender,
            "country": rng.choice(COUNTRIES),
            "birthdate": f"{rng.randint(1980, 2003)}-{rng.randint(1,12):02d}-{rng.randint(1,28):02d}",
            "rating100": rng.choice([None, rng.randint(rating_lo, rating_hi)]),
            "favorite": rng.random() < 0.25,
            "tag_ids": rng.sample(tag_ids, k=min(len(tag_ids), rng.randint(0, 4))) if tag_ids else [],
            "images": images,
        }
        i = {k: v for k, v in i.items() if v is not None}
        try:
            data = gql(
                args.url,
                "mutation($i: PerformerCreateInput!){ performerCreate(input:$i){ id } }",
                {"i": i},
            )
            performer_ids.append(data["performerCreate"]["id"])
            made += 1
        except RuntimeError as exc:
            print(f"  performer '{name}' failed: {exc}", file=sys.stderr)
            raise
    print(f"  performers: {made} (with {img_lo}-{img_hi} images each)")

    # Real scenes from assets/scenes/ (when present), assigned the studios/
    # performers/tags just created. Best-effort: a scan failure warns but
    # doesn't abort an otherwise-good seed.
    if sc.get("scenes"):
        try:
            seeded = seed_scenes(args.url, rng, studio_ids, performer_ids, tag_ids,
                                 rich=(args.scenario != "minimal"))
            seed_clips(args.url, rng, seeded)
        except RuntimeError as exc:
            print(f"  ! scene seeding failed: {exc}", file=sys.stderr)

    # Boot clean: suppress the first-run release-notes modal so an agent opening
    # the instance lands straight on real content.
    gql(args.url, "mutation{ configureUI(input:{ lastNoteSeen: 99999999 }) }")


if __name__ == "__main__":
    main()
