"""Secrets/config access: environment variables, then .streamlit/secrets.toml (parsed directly so it
works under FastAPI too), then Streamlit secrets."""
import os
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
_SECRETS_FILE = Path(__file__).resolve().parent.parent / ".streamlit" / "secrets.toml"
_file_secrets = None


def _load_file_secrets() -> dict:
    global _file_secrets
    if _file_secrets is None:
        _file_secrets = {}
        try:
            for line in _SECRETS_FILE.read_text(encoding="utf-8").splitlines():
                m = re.match(r'^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["\'](.*?)["\']\s*(#.*)?$', line)
                if m:
                    _file_secrets[m.group(1)] = m.group(2)
        except Exception:
            pass
    return _file_secrets


def get_secret(name: str, default=None):
    if os.environ.get(name):
        return os.environ[name]
    file_val = _load_file_secrets().get(name)
    if file_val:
        return file_val
    try:
        import sys

        if "streamlit" in sys.modules:
            import streamlit as st

            if name in st.secrets:
                return st.secrets[name]
    except Exception:
        pass
    return default


def now_ist() -> datetime:
    return datetime.now(IST)


def now_iso() -> str:
    return now_ist().strftime("%Y-%m-%d %H:%M:%S IST")
