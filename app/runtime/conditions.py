"""Safe condition evaluation for the `condition` node.

Uses simpleeval, which does not allow imports, attribute access to dunders,
or arbitrary function calls. We additionally flatten the ctx into dotted-path
names so flows can write expressions like:

    answers_form_age >= 18
    utm_utm_source == "google"

Admins writing the condition also get to use dotted syntax via a tiny
preprocessor that rewrites `answers.form.age` → `answers_form_age` before eval.
"""
import re
from typing import Any

from simpleeval import InvalidExpression, SimpleEval

_PATH = re.compile(r"\b(answers|utm|api)\.[A-Za-z_][\w.]*")


def _coerce(v: Any) -> Any:
    """Form inputs arrive as strings. Coerce numeric/boolean-ish strings so
    authors can write `answers.form.age >= 18` instead of quoting 18."""
    if isinstance(v, str):
        s = v.strip()
        if s.lower() in ("true", "yes"):
            return True
        if s.lower() in ("false", "no"):
            return False
        try:
            if "." in s:
                return float(s)
            return int(s)
        except (ValueError, TypeError):
            return v
    return v


def _flatten(prefix: str, obj: Any, out: dict) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            _flatten(f"{prefix}_{k}" if prefix else k, v, out)
    else:
        out[prefix] = _coerce(obj)


def _rewrite(expr: str) -> str:
    return _PATH.sub(lambda m: m.group(0).replace(".", "_"), expr)


def rules_to_expression(rules: list[dict], logic: str = "and") -> str:
    """Convert the user-friendly rule list into a simpleeval expression.

    Each rule: {left: "answers.form.age", op: ">=", right: "18", right_is_var: false}
    """
    joiner = " and " if logic.lower() != "or" else " or "

    def _one(r: dict) -> str:
        left = r["left"]
        op = r.get("op", "==")
        right = r.get("right", "")
        if r.get("right_is_var"):
            rhs = str(right)
        elif op in ("exists", "not_exists"):
            return f"({left} is not None and {left} != \"\")" if op == "exists" else f"({left} is None or {left} == \"\")"
        else:
            # Emit as a number literal when it looks numeric so comparisons like
            # `answers.form.age >= 18` work without the author quoting it.
            s = str(right).strip()
            try:
                if "." in s:
                    rhs = repr(float(s))
                else:
                    rhs = repr(int(s))
            except (ValueError, TypeError):
                rhs = '"' + s.replace('"', '\\"') + '"'

        if op == "contains":
            return f'({rhs} in str({left}))'
        if op == "not_contains":
            return f'({rhs} not in str({left}))'
        if op in ("==", "!=", "<", "<=", ">", ">="):
            return f"({left} {op} {rhs})"
        return "False"

    parts = [_one(r) for r in rules if r.get("left")]
    return joiner.join(parts) if parts else "False"


def evaluate(expression: str, context: dict) -> bool:
    names: dict = {}
    _flatten("answers", context.get("answers") or {}, names)
    _flatten("utm", context.get("utm") or {}, names)
    _flatten("api", context.get("api") or {}, names)

    # simpleeval treats missing names as NameError; stub every referenced name
    # with None so "empty" reads become falsy rather than crashing.
    for tok in re.findall(r"[A-Za-z_][\w]*", _rewrite(expression)):
        names.setdefault(tok, None)

    try:
        return bool(SimpleEval(names=names).eval(_rewrite(expression)))
    except (InvalidExpression, SyntaxError, TypeError, ValueError):
        return False
