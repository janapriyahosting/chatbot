"""Flow-definition validation.

Hard errors → caller returns 422.
Warnings → non-blocking; surfaced in the editor so authors see dead branches.
"""
import re
from typing import Any

# A real URL: absolute http(s) link, or an absolute path served by nginx
# (typically /static/uploads/<id>.ext). Bare slugs like "MyBrochure" are not
# acceptable — they get resolved relative to the page hosting the widget,
# which causes the document bubble to navigate to whatever happens to live
# at that path on the parent site (e.g. the bot's test page) instead of the
# intended file.
_URL_LIKE_RE = re.compile(r"^(?:https?://|/)")


def validate_flow(definition: dict) -> tuple[list[str], list[str]]:
    """Returns (errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []

    nodes = definition.get("nodes") or []
    edges = definition.get("edges") or []
    start = definition.get("start_node")

    node_ids = {n["id"] for n in nodes}

    if not nodes:
        errors.append("flow has no nodes")
    if not start:
        errors.append("start_node is required")
    elif start not in node_ids:
        errors.append(f"start_node {start!r} not in nodes")

    for e in edges:
        if e.get("source") not in node_ids:
            errors.append(f"edge source {e.get('source')!r} does not exist")
        if e.get("target") not in node_ids:
            errors.append(f"edge target {e.get('target')!r} does not exist")

    if errors:
        return errors, warnings

    # Reachability from start
    out_edges: dict[str, list[dict]] = {}
    for e in edges:
        out_edges.setdefault(e["source"], []).append(e)
    reached: set[str] = set()
    stack = [start]
    while stack:
        cur = stack.pop()
        if cur in reached:
            continue
        reached.add(cur)
        for e in out_edges.get(cur, []):
            stack.append(e["target"])
    for n in nodes:
        if n["id"] not in reached:
            warnings.append(f"node {n['id']!r} ({n['type']}) is unreachable from start")

    # Condition nodes should have both true/false edges
    for n in nodes:
        if n["type"] != "condition":
            continue
        labels = {str(e.get("condition") or "").lower() for e in out_edges.get(n["id"], [])}
        missing = {"true", "false"} - labels
        if missing:
            warnings.append(
                f"condition node {n['id']!r} missing outgoing edge(s) labelled: {sorted(missing)}"
            )
        cfg = n.get("config") or {}
        if not cfg.get("expression") and not cfg.get("rules"):
            warnings.append(f"condition node {n['id']!r} has no rules/expression set")

    # Input nodes need a `field` (where to save the answer)
    for n in nodes:
        if n["type"] != "input":
            continue
        if not (n.get("config") or {}).get("field"):
            warnings.append(f"input node {n['id']!r} has no `field` (variable name) set")

    # Button nodes: at least one edge should match a button value, OR there should be a fallback unconditional edge
    for n in nodes:
        if n["type"] not in ("buttons", "image_buttons"):
            continue
        cfg = n.get("config") or {}
        values = {str(o.get("value")) for o in (cfg.get("options") or [])}
        edge_labels = {str(e.get("condition") or "") for e in out_edges.get(n["id"], [])}
        has_fallback = "" in edge_labels or any(e.get("condition") is None for e in out_edges.get(n["id"], []))
        if not has_fallback and not (values & edge_labels):
            warnings.append(
                f"{n['type']} node {n['id']!r}: no edge matches any button value, and no fallback edge exists"
            )

    # Document node: cfg.url must be a real URL or absolute path. A bare
    # string like "NilevalleyBrochure" gets resolved relative to the page
    # hosting the widget, which silently breaks the download bubble.
    for n in nodes:
        if n.get("type") != "document":
            continue
        cfg = n.get("config") or {}
        url = (cfg.get("url") or "").strip()
        if not url:
            errors.append(f"document node {n['id']!r} is missing a url — upload a file or paste a link")
        elif not _URL_LIKE_RE.match(url):
            errors.append(
                f"document node {n['id']!r} has an invalid url {url!r} — must start with "
                "'/', 'http://', or 'https://'. Use the Upload document button or paste a full URL."
            )

    # Terminal expectation: at least one path should reach an end node, otherwise the flow never resolves
    has_end_reachable = any((n["type"] == "end" and n["id"] in reached) for n in nodes)
    if not has_end_reachable:
        warnings.append("no `end` node is reachable from start — flow may run forever")

    return errors, warnings


def require_valid(definition: dict) -> list[str]:
    """Raise-like: returns warnings; use when you want the errors as a list to 422 on."""
    errors, warnings = validate_flow(definition)
    if errors:
        raise ValueError("; ".join(errors))
    return warnings
