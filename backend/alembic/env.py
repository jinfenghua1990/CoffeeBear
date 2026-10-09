from logging.config import fileConfig
from pathlib import Path
import subprocess

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import settings
from app.models import Base  # noqa: F401  导入全部当前模型确保 metadata 完整

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# CoffeeBear 已退役外贸运行时，但历史 Alembic 链仍会在旧库/全新升级链中创建这些表。
# 它们只作为历史 schema 兼容层保留，不属于当前 ORM authority；因此 drift check 不应
# 把“当前 metadata 不再声明它们”解释成需要生成 DROP TABLE。真正移除这些历史表要走
# 独立的 archive/baseline 迁移，而不是由 alembic check 隐式决定。
_RETIRED_SCHEMA_PREFIXES = ("foreign_trade_",)


def _include_object(obj, name: str | None, type_: str, reflected: bool, compare_to) -> bool:
    if not reflected:
        return True
    table_name = name if type_ == "table" else getattr(getattr(obj, "table", None), "name", "")
    if table_name and table_name.startswith(_RETIRED_SCHEMA_PREFIXES):
        return False
    return True


def _assert_update_guard() -> None:
    root = Path(__file__).resolve().parents[2]
    guard = root / "scripts" / "update-guard.sh"
    if not guard.is_file():
        return
    result = subprocess.run(
        ["bash", str(guard), "check", str(root)],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "系统更新正在执行").strip()
        raise RuntimeError(detail)


def run_migrations_offline() -> None:
    _assert_update_guard()
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        include_object=_include_object,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    _assert_update_guard()
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=_include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
