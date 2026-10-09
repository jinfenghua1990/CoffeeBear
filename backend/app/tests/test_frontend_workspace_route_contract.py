from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_coffeebear_frontend_has_no_foreign_workspace_contract():
    route_table = source("frontend/src/lib/workspace/route-table.tsx")
    navigation = source("frontend/src/lib/navigation.ts")
    finance_page = source("frontend/src/app/finance/page.tsx")

    assert not (ROOT / "frontend/src/app/foreign-trade").exists()
    assert "/foreign-trade" not in route_table
    assert "/foreign-trade" not in navigation
    assert "isForeignTradeFinanceRoute" not in route_table
    assert "isForeignTradeFinanceRoute" not in navigation
    assert 'business_scope: "domestic"' in finance_page
    assert 'business_scope: "foreign_trade"' not in finance_page
    assert "国际物流" not in finance_page
    assert "进口 VAT" not in finance_page


def test_jackyun_receiving_legacy_page_only_targets_canonical_panel():
    legacy = source("frontend/src/app/supply-chain/receiving/jackyun/page.tsx")
    receiving = source("frontend/src/app/supply-chain/receiving/page.tsx")
    route_table = source("frontend/src/lib/workspace/route-table.tsx")

    assert 'syncWorkspaceUrl("/supply-chain/receiving?panel=jackyun", "replace")' in legacy
    assert "JackyunPanel" not in legacy
    assert 'searchParams.get("panel") === "jackyun"' in receiving
    assert '"/supply-chain/receiving/jackyun": "/supply-chain/receiving?panel=jackyun"' in route_table
