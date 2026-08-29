"""load_env — 轻量 .env 加载器(无 python-dotenv 依赖)。"""
import os
from pathlib import Path


def load_dotenv(path: str = "/opt/valuation/.env") -> None:
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        os.environ.setdefault(k, v)


load_dotenv()
