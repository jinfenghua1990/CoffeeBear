"""SPA 静态回退的路径边界回归测试（纯函数，无需数据库/网络）。

背景：`_resolve_static` 的入参直接来自 URL。uvicorn 会把 %2e%2e%2f 解码成 ../，
若不做目录包含校验，可用 /..%2f..%2f.env 读取 frontend/out 之外的任意文件。
"""
from pathlib import Path

from app import main as app_main


def _prepare(tmp_path: Path) -> Path:
    out = tmp_path / "frontend" / "out"
    (out / "_next").mkdir(parents=True)
    (out / "index.html").write_text("<html>INDEX</html>", encoding="utf-8")
    (out / "products").mkdir()
    (out / "products" / "index.html").write_text("<html>PRODUCTS</html>", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("SECRET", encoding="utf-8")
    (tmp_path / ".env").write_text("APP_SECRET_KEY=leaked", encoding="utf-8")
    return out


def test_resolve_static_rejects_traversal(tmp_path, monkeypatch):
    out = _prepare(tmp_path)
    monkeypatch.setattr(app_main, "_FRONTEND_OUT", str(out))

    for evil in (
        "../secret.txt",
        "../../secret.txt",
        "../.env",
        "products/../../secret.txt",
        "/etc/passwd",
        "C:\\Windows\\win.ini",
    ):
        assert app_main._resolve_static(evil) is None, f"越界路径未被拒绝: {evil}"


def test_resolve_static_keeps_normal_routes(tmp_path, monkeypatch):
    out = _prepare(tmp_path)
    monkeypatch.setattr(app_main, "_FRONTEND_OUT", str(out))

    assert Path(app_main._resolve_static("")).name == "index.html"
    for route in ("products", "products/", "products/index.html"):
        resolved = app_main._resolve_static(route)
        assert resolved is not None, route
        assert Path(resolved).name == "index.html", route
