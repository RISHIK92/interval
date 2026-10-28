"""VM mode (ADR-0011): secrets from Secrets Manager into a RAM-only env file."""

import os
import stat
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "deploy" / "bin" / "write-env.sh"
SECRETS = {
    "interval/prod/postgres": "pgSecret123",
    "interval/prod/better-auth": "authSecret456",
    "interval/prod/openrouter": "orKey789",
    "interval/prod/voyage": "voyageKey000",
}


def fake_aws(
    tmp: Path, fail_on: str | None = None, overrides: dict[str, str] | None = None
) -> Path:
    values = {**SECRETS, **(overrides or {})}
    cases = "\n".join(
        f"    \"{name}\") printf '%s\\n' '{value}' ;;" for name, value in values.items()
    )
    script = tmp / "aws"
    script.write_text(
        f"""#!/bin/sh
# Fake: aws secretsmanager get-secret-value --secret-id NAME --query SecretString ...
while [ "$#" -gt 0 ]; do
  [ "$1" = "--secret-id" ] && name="$2"
  shift
done
[ "$name" = "{fail_on or ""}" ] && {{ echo "AccessDenied" >&2; exit 254; }}
case "$name" in
{cases}
    *) echo "unknown $name" >&2; exit 1 ;;
esac
""",
        encoding="utf-8",
    )
    script.chmod(0o755)
    return script


def run(
    tmp: Path, aws: Path, etc: Path | None = None, http_port: str | None = None
) -> subprocess.CompletedProcess[str]:
    if etc is None:
        # Files in S3 by default: the stack's bucket name, as the runbook says to write.
        etc = tmp / "etc"
        etc.mkdir(exist_ok=True)
        if not (etc / "files-backend").exists():
            (etc / "private-content-bucket").write_text("prod-bucket-1\n", "utf-8")
    env = {
        "PATH": os.environ["PATH"],
        "AWS_CLI": str(aws),
        "ENV_DIR": str(tmp / "out"),
        "INTERVAL_ETC": str(etc),
    }
    if http_port is not None:
        env["HTTP_PORT"] = http_port
    return subprocess.run(
        [str(SCRIPT)], env=env, capture_output=True, text=True, check=False
    )


def parse(path: Path) -> dict[str, str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return dict(
        line.split("=", 1) for line in lines if line and not line.startswith("#")
    )


def test_writes_three_env_files_each_with_only_its_keys_and_mode_600(
    tmp_path: Path,
) -> None:
    result = run(tmp_path, fake_aws(tmp_path))
    assert result.returncode == 0, result.stderr
    out = tmp_path / "out"
    for name in ("app.env", "postgres.env", "caddy.env"):
        assert stat.S_IMODE((out / name).stat().st_mode) == 0o600
    assert parse(out / "app.env") == {
        "NODE_ENV": "production",
        "DATABASE_URL": "postgres://interval:pgSecret123@postgres:5432/interval?sslmode=disable",
        "ALLOWED_DB_HOSTS": "postgres",
        "QUEUE_TRANSPORT": "bullmq",
        "VALKEY_URL": "redis://valkey:6379",
        "AWS_REGION": "ap-south-1",
        "PRIVATE_CONTENT_BUCKET": "prod-bucket-1",
        "BETTER_AUTH_SECRET": "authSecret456",
        "BETTER_AUTH_URL": "http://localhost",
        "MAIL_TRANSPORT": "log",
        "EVENTS_TRANSPORT": "file",
        "EVENTS_DIR": "/tmp/interval-events",
        "OPENROUTER_API_KEY": "orKey789",
        "VOYAGE_API_KEY": "voyageKey000",
    }
    assert parse(out / "postgres.env") == {"POSTGRES_PASSWORD": "pgSecret123"}
    assert parse(out / "caddy.env") == {"SITE_ADDRESS": ":80"}
    assert sorted(p.name for p in out.iterdir()) == [
        "app.env",
        "caddy.env",
        "postgres.env",
    ]


def test_site_address_and_local_s3_come_from_etc(tmp_path: Path) -> None:
    etc = tmp_path / "etc"
    etc.mkdir()
    (etc / "site-address").write_text("interval.example.com\n", encoding="utf-8")
    (etc / "files-backend").write_text("local-s3\n", encoding="utf-8")
    assert run(tmp_path, fake_aws(tmp_path), etc).returncode == 0
    out = tmp_path / "out"
    assert parse(out / "caddy.env")["SITE_ADDRESS"] == "interval.example.com"
    assert parse(out / "app.env")["BETTER_AUTH_URL"] == "https://interval.example.com"
    assert parse(out / "app.env")["S3_ENDPOINT"] == "http://seaweedfs:8333"
    assert parse(out / "app.env")["PRIVATE_CONTENT_BUCKET"] == "interval-private"
    # Mail is logged only without a domain; a public site needs a real transport.
    assert "MAIL_TRANSPORT" not in parse(out / "app.env")
    # DB-5: the VM sends events to its Firehose stream (infra/src/prod-stack.ts).
    app = parse(out / "app.env")
    assert app["EVENTS_TRANSPORT"] == "firehose"
    assert app["EVENTS_STREAM"] == "interval-prod-events"
    assert app["AWS_REGION"] == "ap-south-1"
    assert "EVENTS_DIR" not in app


def test_without_a_domain_better_auth_uses_the_local_port(tmp_path: Path) -> None:
    # The local smoke run (ADR-0013) serves on HTTP_PORT; Better Auth refuses browser
    # requests from any other origin.
    assert run(tmp_path, fake_aws(tmp_path), http_port="8080").returncode == 0
    assert parse(tmp_path / "out" / "app.env")["BETTER_AUTH_URL"] == (
        "http://localhost:8080"
    )


@pytest.mark.parametrize("failing", sorted(SECRETS))
def test_a_failed_fetch_writes_nothing(tmp_path: Path, failing: str) -> None:
    result = run(tmp_path, fake_aws(tmp_path, fail_on=failing))
    assert result.returncode != 0
    out = tmp_path / "out"
    assert not out.exists() or list(out.iterdir()) == []


@pytest.mark.parametrize(
    "value", ["ab$HOMEcd", "abc #def", "has space", "p@ss/word", "", "None"]
)
def test_a_secret_that_would_corrupt_the_env_file_or_url_is_refused(
    tmp_path: Path, value: str
) -> None:
    aws = fake_aws(tmp_path, overrides={"interval/prod/openrouter": value})
    result = run(tmp_path, aws)
    assert result.returncode != 0
    assert "interval/prod/openrouter" in result.stderr
    out = tmp_path / "out"
    assert not out.exists() or list(out.iterdir()) == []


# P2-W11-S01: with files in S3, the bucket's name must be written first.
def test_files_in_s3_need_the_bucket_name(tmp_path: Path) -> None:
    etc = tmp_path / "etc"
    etc.mkdir()
    result = run(tmp_path, fake_aws(tmp_path), etc)
    assert result.returncode != 0
    assert "private-content-bucket" in result.stderr
    out = tmp_path / "out"
    assert not out.exists() or list(out.iterdir()) == []
