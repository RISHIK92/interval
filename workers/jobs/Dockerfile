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
RUN useradd --system --uid 10001 jobs
USER jobs
ENTRYPOINT ["/app/.venv/bin/python", "-m", "interval_jobs"]
