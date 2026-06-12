# Fork runtime image (felixowens/stash).
#
# Thin, runtime-only. The `stash` binary is built NATIVELY on the CI
# runner (static-pie, the same recipe upstream uses for `build-cc-linux`
# / its official release binaries) and staged into this build context by
# .github/workflows/fork-image.yml before `docker build` runs.
#
# This stage mirrors docker/ci/x86_64/Dockerfile — the recipe behind the
# official stashapp/stash Docker Hub image — so the image stays a drop-in
# replacement: same python/scraper deps, ffmpeg, vips-heif, tzdata, CMD.
#
# Build context is `docker/fork` (NOT the repo root): the root
# .dockerignore excludes `stash`/`dist`/`docker`, which would hide the
# staged binary. A scoped context also keeps the upload tiny.
#
# Pushed to ghcr.io/felixowens/stash. Deploy flow: homelab
# docs/stash-fork.md.

FROM alpine:latest AS app
COPY stash /usr/bin/stash

RUN apk add --no-cache ca-certificates python3 py3-requests py3-requests-toolbelt py3-lxml py3-pip ffmpeg tzdata vips vips-tools vips-heif \
    && pip install --break-system-packages mechanicalsoup cloudscraper stashapp-tools
ENV STASH_CONFIG_FILE=/root/.stash/config.yml

ARG GITHASH
ARG STASH_VERSION
LABEL org.opencontainers.image.title="Stash (felixowens fork)" \
    org.opencontainers.image.source="https://github.com/felixowens/stash" \
    org.opencontainers.image.licenses="AGPL-3.0" \
    org.opencontainers.image.revision="${GITHASH}" \
    org.opencontainers.image.version="${STASH_VERSION}"

EXPOSE 9999
CMD ["stash"]
