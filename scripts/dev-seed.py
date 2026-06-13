#!/usr/bin/env python3
"""Seed a running Stash dev instance with realistic data over the GraphQL API.

Why the API and not a direct DB insert: the old scripts/test_db_generator no
longer compiles (upstream moved the pkg/file types), and seeding through the
real API can never drift from the schema. It also exercises the actual
mutations — including the fork's performer `images` collection — so the seed
doubles as a smoke test of the write path.

Usage:
    dev-seed.py --url http://localhost:PORT [--performers 80] [--studios 25] [--tags 40]

Reads name word-lists from scripts/test_db_generator/*.txt. Stdlib only.
"""
import argparse
import base64
import json
import os
import random
import struct
import sys
import urllib.request
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
WORDS = os.path.join(HERE, "test_db_generator")
GENDERS = ["FEMALE", "MALE", "NON_BINARY", "TRANSGENDER_FEMALE"]
COUNTRIES = ["US", "GB", "DE", "FR", "JP", "BR", "CA", "AU", "SE", "CZ"]


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--performers", type=int, default=80)
    ap.add_argument("--studios", type=int, default=25)
    ap.add_argument("--tags", type=int, default=40)
    ap.add_argument("--seed", type=int, default=1234, help="RNG seed for reproducibility")
    args = ap.parse_args()
    rng = random.Random(args.seed)

    female = load_words("female.txt", ["Ava", "Mia", "Zoe"])
    male = load_words("male.txt", ["Max", "Leo", "Sam"])
    surname = load_words("surname.txt", ["Stone", "Vale", "Cross"])
    studio_words = load_words("studio.txt", ["Apex", "Lumen", "Vertex"])

    # Tags
    tag_pool = load_words("scene.txt", ["solo", "duo", "outdoor", "vintage"])
    tag_ids = []
    seen = set()
    for _ in range(args.tags):
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
    for _ in range(args.studios):
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

    # Performers — with the fork's multi-image `images` collection
    made = 0
    for n in range(args.performers):
        gender = rng.choices(GENDERS, weights=[70, 18, 6, 6])[0]
        first = rng.choice(female if gender.startswith("FEMALE") or "FEMALE" in gender else male)
        name = f"{first} {rng.choice(surname)}"
        n_imgs = rng.randint(1, 3)
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
            "rating100": rng.choice([None, rng.randint(30, 100)]),
            "favorite": rng.random() < 0.25,
            "tag_ids": rng.sample(tag_ids, k=min(len(tag_ids), rng.randint(0, 4))) if tag_ids else [],
            "images": images,
        }
        i = {k: v for k, v in i.items() if v is not None}
        try:
            gql(
                args.url,
                "mutation($i: PerformerCreateInput!){ performerCreate(input:$i){ id } }",
                {"i": i},
            )
            made += 1
        except RuntimeError as exc:
            print(f"  performer '{name}' failed: {exc}", file=sys.stderr)
            raise
    print(f"  performers: {made} (with 1-3 images each)")

    # Boot clean: suppress the first-run release-notes modal so an agent opening
    # the instance lands straight on real content.
    gql(args.url, "mutation{ configureUI(input:{ lastNoteSeen: 99999999 }) }")


if __name__ == "__main__":
    main()
