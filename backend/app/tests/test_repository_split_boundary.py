from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]


def test_removed_foreign_runtime_modules_do_not_return():
    removed = [
        REPO_ROOT / "backend/app/api/v1/foreign_trade.py",
        REPO_ROOT / "backend/app/models/foreign_trade.py",
        REPO_ROOT / "backend/app/services/foreign_trade_service.py",
        REPO_ROOT / "frontend/src/app/foreign-trade/page.tsx",
    ]
    assert [str(path) for path in removed if path.exists()] == []


def test_finance_api_has_no_foreign_scope_contract():
    source = (REPO_ROOT / "backend/app/api/v1/finance.py").read_text(encoding="utf-8")
    assert "foreign_trade" not in source
    assert "foreignEntryCount" not in source
    assert "foreignTotalsByCurrency" not in source


def test_domestic_bootstrap_and_delivery_have_no_foreign_runtime_dependency():
    seed = (REPO_ROOT / "backend/app/seed.py").read_text(encoding="utf-8")
    finance_service = (REPO_ROOT / "backend/app/services/finance_service.py").read_text(encoding="utf-8")
    assert 'business_scopes=["domestic", "foreign_trade"]' not in seed
    assert "finance_closing_service" not in finance_service
    assert "foreign_summary" not in finance_service


def test_frontend_finance_and_navigation_are_domestic_only():
    navigation = (REPO_ROOT / "frontend/src/lib/navigation.ts").read_text(encoding="utf-8")
    monthly_send = (REPO_ROOT / "frontend/src/app/finance/monthly-send/page.tsx").read_text(encoding="utf-8")
    tabs = (REPO_ROOT / "frontend/src/components/workspace/workspace-tabs.tsx").read_text(encoding="utf-8")
    assert 'WorkspaceKey = "domestic";' in navigation
    assert "foreignEntryCount" not in monthly_send
    assert "hasForeignSummary" not in monthly_send
    assert 'activeWorkspace === "foreign"' not in tabs


def test_frontend_workspace_is_domestic_only():
    route_table = (REPO_ROOT / "frontend/src/lib/workspace/route-table.tsx").read_text(encoding="utf-8")
    tab_store = (REPO_ROOT / "frontend/src/lib/workspace/tab-store.tsx").read_text(encoding="utf-8")
    assert 'WorkspaceKey = "domestic";' in route_table
    assert 'WorkspaceKey = "domestic" | "foreign"' not in route_table
    assert 'workspace === "foreign"' not in tab_store
