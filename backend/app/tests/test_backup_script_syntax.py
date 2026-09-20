from __future__ import annotations

import py_compile
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize(
    "script",
    [
        "scripts/backup.sh",
        "scripts/full-backup.sh",
        "scripts/backup-schedule.sh",
        "scripts/native-start.sh",
        "scripts/restore-check.sh",
    ],
)
def test_backup_shell_scripts_parse(script):
    bash = shutil.which("bash")
    if not bash:
        pytest.skip("bash not installed")
    subprocess.run([bash, "-n", str(ROOT / script)], check=True)


@pytest.mark.parametrize(
    "script",
    [
        "scripts/kodo-cold-upload.py",
        "scripts/r2-backup.py",
        "scripts/r2-restore.py",
    ],
)
def test_backup_python_scripts_compile(script, tmp_path):
    py_compile.compile(str(ROOT / script), cfile=str(tmp_path / (Path(script).name + ".pyc")), doraise=True)
