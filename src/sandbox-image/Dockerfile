ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG TARGETARCH
ARG NODE_VERSION
ARG XLSX_VERSION
ARG DOCLING_VERSION
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 DOCLING_ARTIFACTS_PATH=/opt/lios/docling-models \
    PIP_NO_INDEX=1 PIP_DISABLE_PIP_VERSION_CHECK=1 HOME=/tmp XDG_CACHE_HOME=/tmp/.cache
COPY node.tar.gz /tmp/node.tar.gz
COPY xlsx.tgz /tmp/xlsx.tgz
COPY docling-models.tar /tmp/docling-models.tar
COPY docling-models.manifest.json /opt/lios/docling-models.manifest.json
COPY requirements.lock.txt /tmp/requirements.lock.txt
COPY wheelhouse /tmp/wheelhouse
COPY opencv-headless.lock.txt /tmp/opencv-headless.lock.txt
COPY smoke.py /opt/lios/sandbox-smoke.py
COPY smoke-xlsx.cjs /opt/lios/smoke-xlsx.cjs
COPY browser-inputs /tmp/browser-inputs
COPY source-lock.json /opt/lios/browser-source-lock.json
COPY install-browser.py /opt/lios/install-browser.py
RUN --network=none set -eu; \
    case "$TARGETARCH" in arm64|amd64) ;; *) echo "Unsupported sandbox TARGETARCH: $TARGETARCH" >&2; exit 1;; esac; \
    mkdir -p /opt/lios/node_modules/xlsx /opt/lios/docling-models /opt/node; \
    tar -xzf /tmp/node.tar.gz -C /opt/node --strip-components=1; \
    tar -xzf /tmp/xlsx.tgz -C /opt/lios/node_modules/xlsx --strip-components=1; \
    tar -xf /tmp/docling-models.tar -C /opt/lios/docling-models; \
    python /opt/lios/install-browser.py; \
    python -m pip install --no-index --no-cache-dir --only-binary=:all: \
      --find-links=/tmp/wheelhouse --require-hashes -r /tmp/requirements.lock.txt; \
    python -m pip install --no-index --no-cache-dir --no-deps --force-reinstall --only-binary=:all: \
      --find-links=/tmp/wheelhouse --require-hashes -r /tmp/opencv-headless.lock.txt; \
    python -c 'import cv2; assert cv2.__version__'; \
    test "$(/opt/node/bin/node --version)" = "v${NODE_VERSION}"; \
    test "$(/opt/node/bin/node -p 'require("/opt/lios/node_modules/xlsx/package.json").version')" = "${XLSX_VERSION}"; \
    python -c 'import importlib.metadata; assert importlib.metadata.version("docling") == "'"${DOCLING_VERSION}"'"; import docling.document_converter'; \
    ln -s /opt/node/bin/node /usr/bin/node; \
    ln -s /usr/local/bin/python3 /usr/bin/python3; \
    rm -rf /tmp/node.tar.gz /tmp/xlsx.tgz /tmp/docling-models.tar /tmp/requirements.lock.txt /tmp/opencv-headless.lock.txt /tmp/wheelhouse /tmp/browser-inputs; \
    rm /opt/lios/install-browser.py
WORKDIR /tmp
USER 10001:10001
