# Starting point for a USER-OWNED deployment pack (GM-24): the user builds and
# runs this image on infrastructure they control. It is not a LiOS-operated
# service; LiOS runs no customer runtime servers.
FROM python:3.12.10-slim-bookworm

ARG NODE_VERSION=22.16.0
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       xz-utils \
       build-essential \
       tini \
       gfortran \
       libopenblas-dev \
    && DETECTED_ARCH="${TARGETARCH:-$(dpkg --print-architecture)}" \
    && case "${DETECTED_ARCH}" in \
         amd64) NODE_ARCH="x64" ;; \
         arm64|aarch64) NODE_ARCH="arm64" ;; \
         *) echo "Unsupported Docker architecture: ${DETECTED_ARCH}" >&2; exit 1 ;; \
       esac \
    && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
    && tar -xJf "node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -C /usr/local --strip-components=1 \
    && rm "node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --include=dev

COPY python-service/requirements.txt ./python-service/requirements.txt
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r python-service/requirements.txt

COPY . .
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build

RUN groupadd --gid 10001 lios \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin lios \
    && install -d -m 0700 -o lios -g lios /data/lios

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000
ENV LIOS_DATA_ROOT=/data/lios
ENV HOME=/data/lios/.home
ENV LIOS_EXECUTION_ISOLATION=strict
USER 10001:10001
VOLUME /data/lios
EXPOSE 10000

# User-owned Home: mount a named volume at /data/lios and terminate TLS in the user's reverse
# proxy (TRUST_PROXY=1 only if the container port is reachable exclusively from that proxy).
# The first owner is enrolled via the one-time token or LIOS_OWNER_PASSWORD_FILE; no default
# account, password-in-env or vendor runtime server.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.cjs"]
