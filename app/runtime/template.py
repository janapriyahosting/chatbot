import re
from typing import Any

_TOKEN = re.compile(r"\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}")


def _lookup(path: str, ctx: dict[str, Any]) -> Any:
    cur: Any = ctx
    for part in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def render(value: Any, ctx: dict[str, Any]) -> Any:
    """Substitute `{{path.to.value}}` tokens inside strings.

    Dicts/lists are walked recursively. Non-string scalars pass through.
    """
    if isinstance(value, str):
        def _sub(m: re.Match) -> str:
            v = _lookup(m.group(1), ctx)
            return "" if v is None else str(v)
        return _TOKEN.sub(_sub, value)
    if isinstance(value, dict):
        return {k: render(v, ctx) for k, v in value.items()}
    if isinstance(value, list):
        return [render(v, ctx) for v in value]
    return value
