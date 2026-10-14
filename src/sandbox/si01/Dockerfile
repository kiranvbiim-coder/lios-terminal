# syntax=docker/dockerfile:1.7
#
# SI-01 Secure Local Alpha execution image.
# Base images are injected only as immutable named OCI refs pinned by @sha256.
# The build script refuses mutable tags before Docker/Podman is invoked.
ARG NODE_BASE
ARG PYTHON_BASE

FROM ${NODE_BASE} AS lios_node

FROM ${PYTHON_BASE} AS lios_runtime

ARG DOCLING_VERSION=2.129.0

LABEL org.opencontainers.image.title="LiOS SI-01 sandbox runtime" \
      org.opencontainers.image.description="User-owned local execution image for SP-01 isolated document and spreadsheet parsing" \
      com.limuria.lios.si01.node="22.12.0" \
      com.limuria.lios.si01.docling="2.129.0" \
      com.limuria.lios.si01.xlsx="0.20.3"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Reuse the exact Node runtime supplied by the immutable Node base. No curl,
# package repository, or install script is used to obtain Node in this image.
COPY --from=lios_node /usr/local/ /usr/local/

# SheetJS is already a vendored LiOS dependency. Install from that exact archive
# only; do not resolve an alternate version from a public npm registry.
COPY vendor/xlsx-0.20.3.tgz /tmp/lios-xlsx.tgz
RUN mkdir -p /opt/lios \
    && /usr/local/bin/npm install --prefix /opt/lios --omit=dev --ignore-scripts --no-audit --no-fund /tmp/lios-xlsx.tgz \
    && rm -f /tmp/lios-xlsx.tgz \
    && test "$(/usr/local/bin/node --version)" = "v22.12.0" \
    && test "$(/usr/local/bin/node -p 'require("/opt/lios/node_modules/xlsx/package.json").version')" = "0.20.3"

# Docling is a separately approved SI-01 research-docs pack. The direct version
# is fixed here; transitive release wheel/hash closure remains governed by the
# separate SI-01.16 release-lock gate and is not fabricated in this recipe.
RUN /usr/local/bin/python3 -m pip install "docling==${DOCLING_VERSION}" \
    && test "$(/usr/local/bin/python3 -c 'import importlib.metadata as m; print(m.version("docling"))')" = "${DOCLING_VERSION}"

# Match the existing strict sandbox runtime contract exactly. Debian /usr/bin
# paths remain stable even though the official language images install the
# language runtimes under /usr/local/bin.
RUN ln -sf /usr/local/bin/python3 /usr/bin/python3 \
    && ln -sf /usr/local/bin/node /usr/bin/node \
    && test -x /bin/sh \
    && test -x /usr/bin/base64 \
    && test -x /bin/tar \
    && test -x /usr/bin/python3 \
    && test -x /usr/bin/node \
    && test -r /opt/lios/node_modules/xlsx/package.json

# The runtime backend supplies a numeric non-root uid:gid and a tmpfs workspace.
# Keeping the image user numeric avoids creating an additional identity authority.
USER 10001:10001
WORKDIR /tmp
