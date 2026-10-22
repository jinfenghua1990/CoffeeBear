from __future__ import annotations

import os
import subprocess
from pathlib import Path


def _run_update_q4(tmp_path: Path, *, pull_fail_until: int) -> subprocess.CompletedProcess[str]:
    repo_root = Path(__file__).resolve().parents[3]
    script = repo_root / "deploy" / "update-q4.sh"
    deploy_dir = tmp_path / "deploy"
    deploy_dir.mkdir()
    compose_file = deploy_dir / "docker-compose.yml"
    compose_file.write_text("services: {}\n", encoding="utf-8")
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "business-data.txt").write_text("keep me", encoding="utf-8")
    env_file = deploy_dir / ".env"
    old_image = "ghcr.io/jinfenghua1990/coffeebear:v2026.10.20.221611"
    old_updater = "ghcr.io/jinfenghua1990/coffeebear:updater-v2026.10.20.221611"
    env_file.write_text(
        f"APP_IMAGE={old_image}\n"
        f"UPDATE_AGENT_IMAGE={old_updater}\n"
        f"DATA_DIR_HOST={data_dir}\n",
        encoding="utf-8",
    )

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    pull_count = tmp_path / "pull-count"
    docker_log = tmp_path / "docker.log"
    docker = fake_bin / "docker"
    docker.write_text(
        """#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LOG"
case " $* " in
  *" exec -T postgres "*)
    printf 'fake-postgres-backup'
    exit 0
    ;;
  *" pull api worker beat migrate updater update-job "*)
    count=$(cat "$PULL_COUNT_FILE" 2>/dev/null || echo 0)
    count=$((count + 1))
    printf '%s' "$count" > "$PULL_COUNT_FILE"
    if [ "$count" -le "$PULL_FAIL_UNTIL" ]; then
      echo "unexpected EOF" >&2
      exit 1
    fi
    exit 0
    ;;
  *" exec -T api curl -fsS http://127.0.0.1:8000/healthz "*)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
""",
        encoding="utf-8",
    )
    docker.chmod(0o755)
    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{fake_bin}{os.pathsep}{env.get('PATH', '')}",
            "COFFEEBEAR_DEPLOY_DIR": str(deploy_dir),
            "COFFEEBEAR_COMPOSE_FILE": str(compose_file),
            "COFFEEBEAR_ENV_FILE": str(env_file),
            "COFFEEBEAR_BACKUP_DIR": str(tmp_path / "backups"),
            "COFFEEBEAR_PULL_RETRY_BASE_SECONDS": "0",
            "PULL_COUNT_FILE": str(pull_count),
            "DOCKER_LOG": str(docker_log),
            "PULL_FAIL_UNTIL": str(pull_fail_until),
        }
    )
    return subprocess.run(
        [
            "/bin/sh",
            str(script),
            "ghcr.io/jinfenghua1990/coffeebear:v2026.10.21.234613",
            "ghcr.io/jinfenghua1990/coffeebear:updater-v2026.10.21.234613",
        ],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
        timeout=30,
    )


def test_update_q4_retries_transient_image_pull_failure_before_migration(tmp_path: Path):
    result = _run_update_q4(tmp_path, pull_fail_until=1)

    assert result.returncode == 0, result.stdout
    assert "镜像拉取尝试 1/4" in result.stdout
    assert "镜像拉取尝试 2/4" in result.stdout
    assert (tmp_path / "pull-count").read_text(encoding="utf-8") == "2"
    commands = (tmp_path / "docker.log").read_text(encoding="utf-8").splitlines()
    pull_indices = [i for i, command in enumerate(commands) if " pull api worker beat migrate updater update-job" in command]
    migration_indices = [i for i, command in enumerate(commands) if " run --rm migrate" in command]
    assert len(pull_indices) == 2
    assert migration_indices and migration_indices[0] > pull_indices[-1]
    assert "APP_IMAGE=ghcr.io/jinfenghua1990/coffeebear:v2026.10.21.234613" in (
        tmp_path / "deploy" / ".env"
    ).read_text(encoding="utf-8")


def test_update_q4_restores_config_and_skips_migration_when_pull_retries_exhausted(tmp_path: Path):
    result = _run_update_q4(tmp_path, pull_fail_until=4)

    assert result.returncode == 1, result.stdout
    assert "镜像拉取连续失败 4 次" in result.stdout
    assert (tmp_path / "pull-count").read_text(encoding="utf-8") == "4"
    commands = (tmp_path / "docker.log").read_text(encoding="utf-8").splitlines()
    assert not any(" run --rm migrate" in command for command in commands)
    assert not any(" stop api worker beat" in command for command in commands)
    env_text = (tmp_path / "deploy" / ".env").read_text(encoding="utf-8")
    assert "APP_IMAGE=ghcr.io/jinfenghua1990/coffeebear:v2026.10.20.221611" in env_text
    assert "UPDATE_AGENT_IMAGE=ghcr.io/jinfenghua1990/coffeebear:updater-v2026.10.20.221611" in env_text
