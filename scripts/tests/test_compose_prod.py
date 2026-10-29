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
LONG_RUNNING = {"postgres", "valkey", "seaweedfs", "web", "caddy", "worker"}
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
        # HOME: the docker CLI finds its compose plugin under ~/.docker/cli-plugins.
        env={
            "ENV_DIR": str(env_dir),
            "PATH": os.environ["PATH"],
            "HOME": os.environ["HOME"],
        },
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
    # Older compose versions omit a false value; true is always printed.
    assert data[0].get("bind", {}).get("create_host_path", False) is False


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
    assert depends["valkey"]["condition"] == "service_healthy"
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
    for name in ("web", "jobs", "worker", "migrate"):
        assert markers(name) == {"app"}
    for name in ("valkey", "seaweedfs"):
        assert markers(name) == set()


def test_the_worker_image_carries_the_seed_file() -> None:
    # load-sources reads workers/jobs/seeds/sources.yaml relative to the working
    # directory, which is /app in the image (P1-W2-S01).
    dockerfile = (ROOT / "workers" / "jobs" / "Dockerfile").read_text(encoding="utf-8")
    assert "COPY workers/jobs/seeds workers/jobs/seeds" in dockerfile
    assert "WORKDIR /app" in dockerfile


# ADR-0014: BullMQ queues live in Valkey, so its data must survive a restart and a
# replaced VM: AOF every second, on the retained data volume, never auto-created.
def test_valkey_keeps_queue_data_on_the_retained_volume(config: dict[str, Any]) -> None:
    valkey = services(config)["valkey"]
    assert valkey["command"] == [
        "valkey-server",
        "--appendonly",
        "yes",
        "--appendfsync",
        "everysec",
    ]
    [volume] = valkey["volumes"]
    assert volume["type"] == "bind"
    assert volume["source"] == "/var/lib/interval/pgdata/valkey"
    assert volume["target"] == "/data"
    assert volume.get("bind", {}).get("create_host_path", False) is False


def test_elasticmq_and_redis_are_gone(config: dict[str, Any]) -> None:
    assert not {"elasticmq", "redis"} & set(services(config))


# W2-S02b: the pipeline consumer runs always, after migrations, on healthy data
# services, and is restarted when its heartbeat goes stale.
def test_the_worker_consumes_after_migrations(config: dict[str, Any]) -> None:
    worker = services(config)["worker"]
    assert worker["command"] == ["consume"]
    depends = worker["depends_on"]
    assert depends["migrate"]["condition"] == "service_completed_successfully"
    assert depends["postgres"]["condition"] == "service_healthy"
    assert depends["valkey"]["condition"] == "service_healthy"
    assert "/tmp/interval-consumer-alive" in " ".join(worker["healthcheck"]["test"])


# ING-3 (P1-W2-S03): on the VM a systemd timer plays EventBridge Scheduler's part.
SYSTEMD = ROOT / "deploy" / "systemd"


def test_a_systemd_timer_runs_poll_due_every_five_minutes() -> None:
    timer = (SYSTEMD / "interval-poll.timer").read_text()
    service = (SYSTEMD / "interval-poll.service").read_text()
    assert "OnUnitActiveSec=5min" in timer
    assert "OnBootSec=" in timer
    assert re.search(r"^ExecStart=.*stack\.sh run poll-due$", service, re.MULTILINE)
    # Only while the stack is up, and never starting a stack stopped on purpose.
    assert "Requisite=interval.service" in service
    assert re.search(r"^TimeoutStartSec=", service, re.MULTILINE)


def test_deploy_installs_and_starts_the_poll_timer() -> None:
    deploy = (ROOT / "deploy" / "bin" / "deploy.sh").read_text()
    assert "interval-poll.timer" in deploy
    assert re.search(r"systemctl enable --now interval-poll\.timer", deploy)
    assert "systemctl start interval.service" in deploy


def test_one_off_jobs_run_in_the_jobs_image_unless_a_deploy_is_running() -> None:
    stack = (ROOT / "deploy" / "bin" / "stack.sh").read_text()
    run_branch = stack.split("run)", 1)[1]
    assert "flock -n 9" in run_branch
    assert 'compose --profile jobs run --rm --no-deps jobs "$@"' in run_branch


# Q-P1-17 (P1-W4-S04): hourly feed recomputes, as EventBridge Scheduler does in AWS.
def test_a_systemd_timer_runs_recompute_due_hourly() -> None:
    timer = (SYSTEMD / "interval-recompute.timer").read_text()
    service = (SYSTEMD / "interval-recompute.service").read_text()
    assert "OnUnitActiveSec=1h" in timer
    assert "OnBootSec=" in timer
    assert re.search(
        r"^ExecStart=.*stack\.sh run recompute-due$", service, re.MULTILINE
    )
    assert "Requisite=interval.service" in service
    assert re.search(r"^TimeoutStartSec=", service, re.MULTILINE)
    deploy = (ROOT / "deploy" / "bin" / "deploy.sh").read_text()
    assert re.search(r"systemctl enable --now interval-recompute\.timer", deploy)


# ING-6 (P1-W6-S03): the weekly link health check, as EventBridge Scheduler does in AWS.
def test_a_systemd_timer_runs_check_links_due_weekly() -> None:
    timer = (SYSTEMD / "interval-links.timer").read_text()
    service = (SYSTEMD / "interval-links.service").read_text()
    assert "OnCalendar=weekly" in timer
    # A VM that was off at the hour still runs it once it is back.
    assert "Persistent=true" in timer
    assert re.search(
        r"^ExecStart=.*stack\.sh run check-links-due$", service, re.MULTILINE
    )
    assert "Requisite=interval.service" in service
    assert re.search(r"^TimeoutStartSec=", service, re.MULTILINE)
    deploy = (ROOT / "deploy" / "bin" / "deploy.sh").read_text()
    assert "interval-links.timer" in deploy
    assert re.search(r"systemctl enable --now interval-links\.timer", deploy)


# Q-2 (P2-W8-S03): this week's question spot checks, as EventBridge Scheduler does in
# AWS.
def test_a_systemd_timer_runs_spot_check_due_weekly() -> None:
    timer = (SYSTEMD / "interval-spot-checks.timer").read_text()
    service = (SYSTEMD / "interval-spot-checks.service").read_text()
    assert "OnCalendar=weekly" in timer
    assert "Persistent=true" in timer
    assert re.search(
        r"^ExecStart=.*stack\.sh run spot-check-due$", service, re.MULTILINE
    )
    assert "Requisite=interval.service" in service
    deploy = (ROOT / "deploy" / "bin" / "deploy.sh").read_text()
    assert re.search(r"systemctl enable --now interval-spot-checks\.timer", deploy)


# Q-P2-13 (P2-W8-S05): question batches every 30 minutes, as EventBridge Scheduler does
# in AWS.
def test_a_systemd_timer_runs_question_batches_every_half_hour() -> None:
    timer = (SYSTEMD / "interval-question-batches.timer").read_text()
    service = (SYSTEMD / "interval-question-batches.service").read_text()
    assert re.search(r"^OnCalendar=\*:0/30$", timer, re.MULTILINE)
    assert re.search(
        r"^ExecStart=.*stack\.sh run question-batches$", service, re.MULTILINE
    )
    assert "Requisite=interval.service" in service
    deploy = (ROOT / "deploy" / "bin" / "deploy.sh").read_text()
    assert re.search(r"systemctl enable --now interval-question-batches\.timer", deploy)


# Q-3 (P2-W9-S08): the weekly difficulty recalibration, as EventBridge Scheduler does
# in AWS.
def test_a_systemd_timer_runs_recalibrate_difficulty_weekly() -> None:
    timer = (SYSTEMD / "interval-recalibrate.timer").read_text()
    service = (SYSTEMD / "interval-recalibrate.service").read_text()
    # Weekly, three hours after the spot checks, so their logs don't interleave.
    assert re.search(r"^OnCalendar=Mon \*-\*-\* 03:00:00$", timer, re.MULTILINE)
    assert "Persistent=true" in timer
    assert re.search(
        r"^ExecStart=.*stack\.sh run recalibrate-difficulty$", service, re.MULTILINE
    )
    assert "Requisite=interval.service" in service
    deploy = (ROOT / "deploy" / "bin" / "deploy.sh").read_text()
    assert re.search(r"systemctl enable --now interval-recalibrate\.timer", deploy)


# Q-P2-40 (P2-W12-S02): the daily GitHub read, as EventBridge Scheduler does in AWS.
def test_a_systemd_timer_runs_sync_github_due_daily() -> None:
    timer = (SYSTEMD / "interval-github.timer").read_text()
    service = (SYSTEMD / "interval-github.service").read_text()
    assert "OnCalendar=daily" in timer
    assert "Persistent=true" in timer
    assert re.search(
        r"^ExecStart=.*stack\.sh run sync-github-due$", service, re.MULTILINE
    )
    assert "Requisite=interval.service" in service
    deploy = (ROOT / "deploy" / "bin" / "deploy.sh").read_text()
    assert "interval-github.timer" in deploy
    assert re.search(r"systemctl enable --now interval-github\.timer", deploy)


# PER-4 (P2-W12-S03): the weekly technology suggestions, as EventBridge does in AWS.
def test_a_systemd_timer_runs_suggest_technologies_weekly() -> None:
    timer = (SYSTEMD / "interval-technologies.timer").read_text()
    service = (SYSTEMD / "interval-technologies.service").read_text()
    assert "OnCalendar=weekly" in timer
    assert re.search(
        r"^ExecStart=.*stack\.sh run suggest-technologies$", service, re.MULTILINE
    )
    deploy = (ROOT / "deploy" / "bin" / "deploy.sh").read_text()
    assert re.search(r"systemctl enable --now interval-technologies\.timer", deploy)
