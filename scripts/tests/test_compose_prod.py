"""VM mode (ADR-0011): checks on the rendered production compose config."""

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "deploy" / "compose.prod.yml"
LONG_RUNNING = {"postgres", "redis", "elasticmq", "seaweedfs", "web", "caddy"}
SECRET_KEYS = {
    "POSTGRES_PASSWORD",
    "BETTER_AUTH_SECRET",
    "OPENROUTER_API_KEY",
    "VOYAGE_API_KEY",
}


@pytest.fixture(scope="module")
def config(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    env_dir = tmp_path_factory.mktemp("env")
    # Compose inlines env files into `environment`, so each gets a marker key. The
    # dummy files hold no secret keys: any secret key in the output was set inline.
    for name in ("app", "postgres", "caddy"):
        (env_dir / f"{name}.env").write_text(f"MARKER_{name}=1\n", encoding="utf-8")
    result = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            str(COMPOSE),
            "--profile",
            "jobs",
            "--profile",
            "local-s3",
            "config",
            "--format",
            "json",
        ],
        env={"ENV_DIR": str(env_dir), "PATH": os.environ["PATH"]},
        capture_output=True,
        text=True,
        check=True,
        cwd=ROOT,
    )
    parsed: dict[str, Any] = json.loads(result.stdout)
    return parsed


def services(config: dict[str, Any]) -> dict[str, Any]:
    found: dict[str, Any] = config["services"]
    return found


def test_only_caddy_publishes_ports(config: dict[str, Any]) -> None:
    published = {name for name, svc in services(config).items() if svc.get("ports")}
    assert published == {"caddy"}
    targets = {p["target"] for p in services(config)["caddy"]["ports"]}
    assert targets == {80, 443}


@pytest.mark.parametrize(
    ("service", "target", "source"),
    [
        ("postgres", "/var/lib/postgresql/data", "/var/lib/interval/pgdata/data"),
        ("seaweedfs", "/data", "/var/lib/interval/pgdata/files"),
    ],
)
def test_data_lives_on_the_mounted_volume_and_never_on_the_root_disk(
    config: dict[str, Any], service: str, target: str, source: str
) -> None:
    mounts = services(config)[service]["volumes"]
    data = [m for m in mounts if m["target"] == target]
    assert len(data) == 1
    assert data[0]["source"].endswith(source)
    # A missing directory (volume not mounted) must fail the start, not be created.
    assert data[0]["bind"]["create_host_path"] is False


def test_project_name_differs_from_the_dev_stack(config: dict[str, Any]) -> None:
    assert config["name"] == "interval-vm"


def test_every_service_rotates_its_logs(config: dict[str, Any]) -> None:
    for name, svc in services(config).items():
        assert svc.get("logging", {}).get("driver") == "local", name


@pytest.mark.parametrize("name", sorted(LONG_RUNNING))
def test_long_running_services_restart_and_report_health(
    config: dict[str, Any], name: str
) -> None:
    svc = services(config)[name]
    assert svc.get("restart") == "unless-stopped"
    assert svc.get("healthcheck", {}).get("test")


def test_web_waits_for_migrations_and_healthy_data_services(
    config: dict[str, Any],
) -> None:
    depends = services(config)["web"]["depends_on"]
    assert depends["migrate"]["condition"] == "service_completed_successfully"
    assert depends["postgres"]["condition"] == "service_healthy"
    assert depends["redis"]["condition"] == "service_healthy"
    migrate = services(config)["migrate"]
    assert migrate["depends_on"]["postgres"]["condition"] == "service_healthy"
    assert migrate.get("restart", "no") == "no"


def test_every_image_is_pinned_to_an_exact_tag(config: dict[str, Any]) -> None:
    for name, svc in services(config).items():
        image = svc.get("image")
        if image is None or "build" in svc:
            continue
        tag = image.rsplit(":", 1)[-1] if ":" in image.split("/")[-1] else ""
        assert re.match(r"^\d", tag), f"{name}: {image} is not pinned to a version"


def test_one_off_and_optional_services_sit_behind_profiles(
    config: dict[str, Any],
) -> None:
    assert services(config)["jobs"]["profiles"] == ["jobs"]
    assert services(config)["seaweedfs"]["profiles"] == ["local-s3"]


def test_secrets_reach_services_only_through_the_env_file(
    config: dict[str, Any],
) -> None:
    for name, svc in services(config).items():
        env: dict[str, str] = svc.get("environment") or {}
        inline = set(env)
        assert not inline & SECRET_KEYS, f"{name} sets a secret inline"


def test_each_service_gets_only_its_env_file(config: dict[str, Any]) -> None:
    def markers(name: str) -> set[str]:
        env: dict[str, str] = services(config)[name].get("environment") or {}
        return {k.removeprefix("MARKER_") for k in env if k.startswith("MARKER_")}

    assert markers("postgres") == {"postgres"}
    assert markers("caddy") == {"caddy"}
    for name in ("web", "jobs", "migrate"):
        assert markers(name) == {"app"}
    for name in ("redis", "elasticmq", "seaweedfs"):
        assert markers(name) == set()
