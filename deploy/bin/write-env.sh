#!/usr/bin/env bash
# VM mode (ADR-0011): turns Secrets Manager values into env files for compose, one per
# need: app.env (web, jobs, migrate), postgres.env, caddy.env. The files live in /run
# (tmpfs). Docker itself keeps each container's environment in its root-only state on
# the encrypted root disk, so never paste `docker inspect` or `compose config` output.
# Writes nothing if any read or check fails.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

AWS_CLI="${AWS_CLI:-aws}"
ENV_DIR="${ENV_DIR:-/run/interval}"
REGION="${AWS_REGION:-ap-south-1}"

secret() {
  local value
  value="$("$AWS_CLI" secretsmanager get-secret-value --region "$REGION" --secret-id "$1" \
    --query SecretString --output text)"
  # Values go into env files and a URL unquoted: compose rewrites `$`, ` #` and newlines,
  # and a password must not need URL-encoding. Generated values always match.
  if [ -z "$value" ] || [ "$value" = "None" ] || ! [[ "$value" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "secret $1 is empty or has characters other than A-Z a-z 0-9 _ -" >&2
    return 1
  fi
  printf '%s' "$value"
}

postgres_password="$(secret interval/prod/postgres)"
better_auth="$(secret interval/prod/better-auth)"
openrouter="$(secret interval/prod/openrouter)"
voyage="$(secret interval/prod/voyage)"

site_address="$(read_setting site-address)"
site_address="${site_address:-:80}"
s3_endpoint=""
if files_on_vm; then s3_endpoint="http://seaweedfs:8333"; fi

umask 077
mkdir -p "$ENV_DIR"
tmp="$(mktemp -d "$ENV_DIR/.write-env.XXXXXX")"
trap 'rm -r "$tmp"' EXIT

cat > "$tmp/app.env" <<ENV
NODE_ENV=production
DATABASE_URL=postgres://interval:${postgres_password}@postgres:5432/interval?sslmode=disable
ALLOWED_DB_HOSTS=postgres
REDIS_URL=redis://redis:6379
SQS_ENDPOINT=http://elasticmq:9324
S3_ENDPOINT=${s3_endpoint}
BETTER_AUTH_SECRET=${better_auth}
OPENROUTER_API_KEY=${openrouter}
VOYAGE_API_KEY=${voyage}
ENV
printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password" > "$tmp/postgres.env"
printf 'SITE_ADDRESS=%s\n' "$site_address" > "$tmp/caddy.env"

# Rename into place only after all three are written.
for f in app.env postgres.env caddy.env; do
  chmod 600 "$tmp/$f"
  mv "$tmp/$f" "$ENV_DIR/$f"
done
