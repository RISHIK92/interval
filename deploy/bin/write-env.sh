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
  local allowed='^[A-Za-z0-9_-]+$'
  if [ "${2:-}" = "b64" ]; then allowed='^[A-Za-z0-9_+/=-]+$'; fi
  if [ -z "$value" ] || [ "$value" = "None" ] || ! [[ "$value" =~ $allowed ]]; then
    echo "secret $1 is empty or has characters it may not hold" >&2
    return 1
  fi
  printf '%s' "$value"
}

postgres_password="$(secret interval/prod/postgres)"
better_auth="$(secret interval/prod/better-auth)"
openrouter="$(secret interval/prod/openrouter)"
voyage="$(secret interval/prod/voyage)"
# P2-W12-S01 (ADR-0024): the GitHub App, for connecting GitHub from Profile.
github_slug="$(secret interval/prod/github-app-slug)"
github_client_id="$(secret interval/prod/github-app-client-id)"
github_client_secret="$(secret interval/prod/github-app-client-secret)"
# S02: the worker's App id, and its private key as base64 of the PEM (base64's + / =
# are safe in an env file; nothing else beyond the usual characters is accepted).
github_app_id="$(secret interval/prod/github-app-id)"
github_private_key="$(secret interval/prod/github-app-private-key b64)"

site_address="$(read_setting site-address)"
site_address="${site_address:-:80}"
# Better Auth's public origin. The VM serves its domain (docs/runbooks/vm.md); only the
# local smoke run has none, and it serves on HTTP_PORT.
http_port="${HTTP_PORT:-80}"
if [ "$site_address" != ":80" ]; then
  public_url="https://$site_address"
elif [ "$http_port" = "80" ]; then
  public_url="http://localhost"
else
  public_url="http://localhost:$http_port"
fi
# Auth email is logged only on a local site (Q-P1-33); with a domain the web app refuses
# to start until a real transport exists (pre-deploy list).
mail_transport_line=""
if [ "$site_address" = ":80" ]; then mail_transport_line="MAIL_TRANSPORT=log"; fi
# DB-5: events go to the VM's Firehose stream (named in infra/src/prod-stack.ts). The local
# smoke run has no domain and no AWS credentials, so it keeps them in a file instead.
if [ "$site_address" = ":80" ]; then
  events_lines="EVENTS_TRANSPORT=file
EVENTS_DIR=/tmp/interval-events"
else
  events_lines="EVENTS_TRANSPORT=firehose
EVENTS_STREAM=interval-prod-events"
fi
# DB-6, P2-W11-S01: private files (PDF books) in SeaweedFS on the VM, or in the stack's
# S3 bucket, whose name the operator writes from its PrivateContentBucket output.
if files_on_vm; then
  files_lines="PRIVATE_CONTENT_BUCKET=${LOCAL_BUCKET}
S3_ENDPOINT=http://seaweedfs:8333
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local"
else
  bucket="$(read_setting private-content-bucket)"
  if [ -z "$bucket" ]; then
    echo "write the stack's PrivateContentBucket output to $INTERVAL_ETC/private-content-bucket" >&2
    exit 1
  fi
  files_lines="PRIVATE_CONTENT_BUCKET=${bucket}"
fi

umask 077
mkdir -p "$ENV_DIR"
tmp="$(mktemp -d "$ENV_DIR/.write-env.XXXXXX")"
trap 'rm -r "$tmp"' EXIT

cat > "$tmp/app.env" <<ENV
NODE_ENV=production
DATABASE_URL=postgres://interval:${postgres_password}@postgres:5432/interval?sslmode=disable
ALLOWED_DB_HOSTS=postgres
QUEUE_TRANSPORT=bullmq
VALKEY_URL=redis://valkey:6379
AWS_REGION=${REGION}
${files_lines}
OCR_URL=http://ocr:8080
BETTER_AUTH_SECRET=${better_auth}
BETTER_AUTH_URL=${public_url}
${mail_transport_line}
${events_lines}
OPENROUTER_API_KEY=${openrouter}
VOYAGE_API_KEY=${voyage}
GITHUB_APP_SLUG=${github_slug}
GITHUB_APP_CLIENT_ID=${github_client_id}
GITHUB_APP_CLIENT_SECRET=${github_client_secret}
GITHUB_APP_ID=${github_app_id}
GITHUB_APP_PRIVATE_KEY=${github_private_key}
ENV
printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password" > "$tmp/postgres.env"
printf 'SITE_ADDRESS=%s\n' "$site_address" > "$tmp/caddy.env"

# Rename into place only after all three are written.
for f in app.env postgres.env caddy.env; do
  chmod 600 "$tmp/$f"
  mv "$tmp/$f" "$ENV_DIR/$f"
done
