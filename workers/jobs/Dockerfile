# Build from the repo root: the worker image for one-off jobs (VM mode, ADR-0011).
FROM ghcr.io/astral-sh/uv:0.13.5 AS uv

FROM python:3.13.17-slim-bookworm
COPY --from=uv /uv /usr/local/bin/uv
# The image's Python only; no uv cache in the layer.
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_CACHE=1 UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
COPY workers/jobs/pyproject.toml workers/jobs/
COPY packages/db/python/pyproject.toml packages/db/python/
# Dependencies first, so a code change does not reinstall them.
RUN uv sync --locked --no-dev --no-install-workspace --package interval-jobs
COPY workers/jobs/src workers/jobs/src
COPY packages/db/python/src packages/db/python/src
RUN uv sync --locked --no-dev --no-editable --package interval-jobs
# Amazon RDS CA bundle (pinned digest) for verify-full TLS in the AWS mode (ADR-0011).
ADD --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /certs/rds-global-bundle.pem
# ADD's --chmod also applies to the directory it creates; make it traversable.
RUN chmod 755 /certs
RUN useradd --system --uid 10001 jobs
USER jobs
ENTRYPOINT ["/app/.venv/bin/python", "-m", "interval_jobs"]
