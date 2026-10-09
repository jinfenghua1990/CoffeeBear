from logging.config import fileConfig
from pathlib import Path
import subprocess

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import settings
from app.models import Base  # noqa: F401  导入全部模型确保 metadata 完整

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# These tables belong to the retired CoffeeBear foreign-trade runtime.  They stay
# in the historical Alembic chain so existing databases can still upgrade
# safely, but they are intentionally no longer part of the runtime ORM.  Ignore
# them during autogenerate/drift checks until the later database cutover removes
# the legacy schema explicitly.
LEGACY_FOREIGN_TRADE_TABLES = {
    "foreign_trade_channels",
    "foreign_trade_dealers",
    "foreign_trade_inventory_reservations",
    "foreign_trade_orders",
    "foreign_trade_product_platforms",
    "foreign_trade_products",
    "foreign_trade_shipments",
    "foreign_trade_sku_mappings",
}


def _include_object(object_, name, type_, reflected, compare_to):  # noqa: ANN001
    if type_ == "table" and name in LEGACY_FOREIGN_TRADE_TABLES:
        return False
    table = getattr(object_, "table", None)
    if table is not None and getattr(table, "name", None) in LEGACY_FOREIGN_TRADE_TABLES:
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
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=_include_object,
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
