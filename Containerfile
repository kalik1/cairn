# Cairn Headlamp plugin image: ghcr.io/kalik1/cairn-headlamp-plugin:<version>
#
# A tiny image that only carries the built plugin at
#   /plugins/cairn-headlamp-plugin/{main.js,package.json}
# Headlamp's pod copies it into its plugins directory with an initContainer
# (see distribution/headlamp-values.yaml). The same image also works as an
# image volume.
#
# Build context: the repository root.
#   podman build -f Containerfile --build-arg PLUGIN_VERSION=0.1.1 \
#     -t ghcr.io/kalik1/cairn-headlamp-plugin:0.1.1 .
#
# The JavaScript is architecture independent: it is built once on the build
# platform; only the tiny runtime base differs per architecture.

ARG NODE_IMAGE=docker.io/library/node:22-alpine
ARG BASE_IMAGE=docker.io/library/busybox:1.37-musl

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /src
COPY plugin/package.json plugin/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY plugin/tsconfig.json ./
COPY plugin/scripts ./scripts
COPY plugin/src ./src
RUN npm run build \
 && mkdir -p /out/cairn-headlamp-plugin \
 && cp dist/main.js package.json /out/cairn-headlamp-plugin/ \
 && test -s /out/cairn-headlamp-plugin/main.js

FROM ${BASE_IMAGE}
ARG PLUGIN_VERSION=dev
LABEL org.opencontainers.image.title="Cairn Headlamp plugin" \
      org.opencontainers.image.description="Ceph storage console for Rook clusters, as a Headlamp plugin, copied into Headlamp's plugins directory by an initContainer" \
      org.opencontainers.image.source="https://github.com/kalik1/cairn" \
      org.opencontainers.image.licenses="GPL-3.0-only" \
      org.opencontainers.image.version="${PLUGIN_VERSION}" \
      io.cairn.headlamp-plugin.path="/plugins/cairn-headlamp-plugin"
COPY --from=build /out/cairn-headlamp-plugin/ /plugins/cairn-headlamp-plugin/
# Headlamp's uid/gid in its own image and chart (securityContext 100:101).
USER 100:101
CMD ["sh", "-c", "cp -R /plugins/cairn-headlamp-plugin/. /cairn-plugin/"]
