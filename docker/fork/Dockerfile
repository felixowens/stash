# Fork image build (felixowens/stash).
#
# Build stages are copied from docker/build/x86_64/Dockerfile (full
# from-source build of UI + backend). The final stage instead mirrors
# docker/ci/x86_64/Dockerfile — the recipe behind the official
# stashapp/stash Docker Hub image — so this image is a drop-in
# replacement: same python/scraper deps, ffmpeg, vips-heif, tzdata,
# same CMD.
#
# Built by .github/workflows/fork-image.yml, pushed to
# ghcr.io/felixowens/stash.

# Build Frontend
FROM node:24-alpine AS frontend
RUN apk add --no-cache make git
## cache node_modules separately
COPY ./ui/v2.5/package.json ./ui/v2.5/pnpm-lock.yaml /stash/ui/v2.5/
WORKDIR /stash
COPY Makefile /stash/
COPY ./graphql /stash/graphql/
COPY ./ui /stash/ui/
RUN npm install -g pnpm
RUN make pre-ui
RUN make generate-ui
ARG GITHASH
ARG STASH_VERSION
RUN BUILD_DATE=$(date +"%Y-%m-%d %H:%M:%S") make ui-only

# Build Backend
FROM golang:1.24.3-alpine AS backend
RUN apk add --no-cache make alpine-sdk
WORKDIR /stash
COPY ./go* ./*.go Makefile gqlgen.yml .gqlgenc.yml /stash/
COPY ./graphql /stash/graphql/
COPY ./scripts /stash/scripts/
COPY ./pkg /stash/pkg/
COPY ./cmd /stash/cmd/
COPY ./internal /stash/internal/
# needed for generate-login-locale
COPY ./ui /stash/ui/
RUN make generate-backend generate-login-locale
COPY --from=frontend /stash /stash/
ARG GITHASH
ARG STASH_VERSION
RUN make flags-release flags-pie stash

# Final Runnable Image — mirrors docker/ci/x86_64/Dockerfile
FROM alpine:latest AS app
COPY --from=backend /stash/stash /usr/bin/stash

RUN apk add --no-cache ca-certificates python3 py3-requests py3-requests-toolbelt py3-lxml py3-pip ffmpeg tzdata vips vips-tools vips-heif \
    && pip install --break-system-packages mechanicalsoup cloudscraper stashapp-tools
ENV STASH_CONFIG_FILE=/root/.stash/config.yml

LABEL org.opencontainers.image.title="Stash (felixowens fork)" \
    org.opencontainers.image.source="https://github.com/felixowens/stash" \
    org.opencontainers.image.licenses="AGPL-3.0"

EXPOSE 9999
CMD ["stash"]
