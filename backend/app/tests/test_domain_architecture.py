from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]


def _text(relative: str) -> str:
    return (REPO_ROOT / relative).read_text(encoding="utf-8")


def test_procurement_domain_does_not_write_tax_invoice_state_directly():
    source = _text("backend/app/services/procurement_chain_service.py")
    assert "invoice.match_status =" not in source
    assert "invoice.verified =" not in source
    assert "invoice.payment_method =" not in source
    assert "mark_invoice_linked" not in source


def test_tax_invoice_domain_exposes_canonical_state_mutators():
    source = _text("backend/app/services/tax_invoice_service.py")
    assert "def sync_business_match_status(" in source
    assert "def set_invoice_verified(" in source


def test_procurement_auto_invoice_links_must_store_allocated_amount():
    source = _text("backend/app/services/procurement_chain_service.py")
    assert "allocated_amount=allocated_amount" in source
    assert "TaxInvoiceLink.confirmed.is_(True)" in source


def test_bank_reconciliation_domain_does_not_write_invoice_manual_payment_fact():
    for relative in (
        "backend/app/services/payment_invoice_match_service.py",
        "backend/app/services/payment_invoice_match_helpers.py",
    ):
        source = _text(relative)
        assert "invoice.payment_method =" not in source
        assert "inv.payment_method =" not in source
        assert "_clear_manual_personal_on_bank_evidence" not in source


def test_coffeebear_runtime_is_domestic_only():
    retired_runtime = (
        "backend/app/api/v1/foreign_trade.py",
        "backend/app/models/foreign_trade.py",
        "backend/app/services/foreign_trade_service.py",
        "frontend/src/app/foreign-trade",
    )
    for relative in retired_runtime:
        assert not (REPO_ROOT / relative).exists(), relative

    api_router = _text("backend/app/api/v1/__init__.py")
    models_init = _text("backend/app/models/__init__.py")
    navigation = _text("frontend/src/lib/navigation.ts")
    route_table = _text("frontend/src/lib/workspace/route-table.tsx")
    finance_center = _text("backend/app/services/finance_center_service.py")

    assert "foreign_trade" not in api_router
    assert "foreign_trade" not in models_init
    assert "/foreign-trade" not in navigation
    assert "/foreign-trade" not in route_table

    # 当前写路径必须强制 domestic；foreign_trade 只能作为历史只读审计兼容出现。
    assert 'row.business_scopes = ["domestic"]' in finance_center
    assert 'if business_scope != "domestic":' in finance_center
    assert 'row.business_scope = "domestic"' in finance_center

    # 国内连接器必须继续保留在 CoffeeBear。
    assert "alibaba1688_imports" in api_router
    assert "jackyun_files" in api_router
