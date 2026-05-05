"""Flow state machine.

advance() runs nodes until it hits an input-awaiting node (buttons/form/input)
or an end/terminal. It returns the list of rendered outputs for the widget
and the new `awaiting` descriptor (if any).
"""
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.runtime.conditions import evaluate as eval_condition
from app.runtime.conditions import rules_to_expression
from app.runtime.template import render

OUTPUT_TYPES = {"text", "image", "video", "carousel", "document"}
INPUT_TYPES = {"buttons", "form", "input", "list", "otp", "schedule"}
TERMINAL_TYPES = {"end"}


@dataclass
class NodeResult:
    outputs: list[dict] = field(default_factory=list)
    awaits_input: bool = False
    next_node: str | None = None
    ends: bool = False


@dataclass
class AdvanceResult:
    outputs: list[dict]
    awaiting: dict | None
    ended: bool


def _index(definition: dict) -> tuple[dict[str, dict], dict[str, list[dict]]]:
    nodes = {n["id"]: n for n in definition["nodes"]}
    edges: dict[str, list[dict]] = {}
    for e in definition["edges"]:
        edges.setdefault(e["source"], []).append(e)
    return nodes, edges


def _pick_next(node_id: str, edges: dict[str, list[dict]], reply_value: str | None) -> str | None:
    out = edges.get(node_id, [])
    if not out:
        return None
    if reply_value is not None:
        for e in out:
            if e.get("condition") == reply_value:
                return e["target"]
    # default: first unconditional edge, else first edge
    for e in out:
        if not e.get("condition"):
            return e["target"]
    return out[0]["target"]


async def _run_node(node: dict, ctx: dict[str, Any]) -> NodeResult:
    t = node["type"]
    cfg = render(node.get("config", {}) or {}, ctx)

    if t == "start":
        return NodeResult()

    if t == "end":
        return NodeResult(ends=True)

    if t in OUTPUT_TYPES:
        return NodeResult(outputs=[{"kind": t, "config": cfg}])

    if t == "buttons":
        return NodeResult(outputs=[{"kind": "buttons", "config": cfg}], awaits_input=True)

    if t == "form":
        return NodeResult(outputs=[{"kind": "form", "config": cfg}], awaits_input=True)

    if t == "input":
        outputs: list[dict] = []
        prompt = cfg.get("prompt") or ""
        if prompt:
            outputs.append({"kind": "text", "config": {"body": prompt}})
        outputs.append({"kind": "input", "config": cfg})
        return NodeResult(outputs=outputs, awaits_input=True)

    if t == "schedule":
        # Site-visit scheduling: emits a prompt text + a schedule widget output.
        outs: list[dict] = []
        title = (cfg.get("title") or cfg.get("prompt") or "").strip()
        if title:
            outs.append({"kind": "text", "config": {"body": title}})
        outs.append({"kind": "schedule", "config": cfg})
        return NodeResult(outputs=outs, awaits_input=True)

    if t == "otp":
        # Surface to the caller that this node needs an OTP send. The widget
        # API layer performs the jpus call (side effect) and clears the flag.
        phone_field = cfg.get("phone_field") or "phone"
        phone = (ctx.get("answers", {}).get("form", {}) or {}).get(phone_field) or ctx.get("answers", {}).get(phone_field)
        if not ctx.get("otp_sent_for") or ctx.get("otp_sent_for") != phone:
            ctx["pending_otp_send"] = {"phone": phone, "phone_field": phone_field}
        outputs = []
        label = cfg.get("body") or f"We'll send an OTP to {phone or 'your phone'}. Please enter it below."
        outputs.append({"kind": "text", "config": {"body": label}})
        outputs.append({"kind": "otp", "config": {"phone": phone, "length": 6}})
        return NodeResult(outputs=outputs, awaits_input=True)

    if t == "handoff":
        # Signal to the caller that this conversation should leave the flow
        # and enter queued/assigned/ai state. The widget API layer reads
        # context["pending_handoff"] to trigger assignment.
        ctx["pending_handoff"] = {
            "ai_fallback": bool(cfg.get("ai_fallback")),
            "ai_system_prompt": cfg.get("ai_system_prompt") or "",
            "unavailable_message": cfg.get("unavailable_message") or "",
        }
        intro = (cfg.get("body") or "Connecting you to our team…").strip()
        outputs = [{"kind": "text", "config": {"body": intro}}] if intro else []
        return NodeResult(outputs=outputs, ends=True)

    if t == "ai":
        # Switch the conversation to AI mode; free chat thereafter in /widget/message.
        ctx["pending_ai_takeover"] = {
            "system_prompt": cfg.get("system_prompt") or "You are a helpful customer support assistant.",
        }
        intro = cfg.get("body") or ""
        outputs: list[dict] = []
        if intro:
            outputs.append({"kind": "text", "config": {"body": intro}})
        return NodeResult(outputs=outputs, ends=True)

    if t == "condition":
        # Prefer the user-friendly rule list; fall back to raw expression.
        expr = ""
        if cfg.get("rules"):
            expr = rules_to_expression(cfg.get("rules") or [], cfg.get("logic") or "and")
        expr = expr or cfg.get("expression") or ""
        truthy = eval_condition(expr, ctx) if expr else False
        ctx.setdefault("answers", {})[node["id"]] = truthy
        return NodeResult(next_node=None, outputs=[], ends=False, awaits_input=False), "true" if truthy else "false"

    if t == "api":
        url = cfg.get("url")
        method = (cfg.get("method") or "POST").upper()
        headers = dict(cfg.get("headers") or {})
        body = cfg.get("body")
        body_type = (cfg.get("body_type") or "json").lower()
        save_as = cfg.get("save_as") or "api_response"

        # Apply auth per-node
        auth = cfg.get("auth") or {}
        atype = (auth.get("type") or "none").lower()
        if atype == "bearer" and auth.get("token"):
            headers["Authorization"] = f"Bearer {auth['token']}"
        elif atype == "api_key" and auth.get("header") and auth.get("value"):
            headers[auth["header"]] = auth["value"]

        # Choose how the body is serialised. `form` sends
        # application/x-www-form-urlencoded — required by OAuth password grant
        # and many legacy APIs. Default stays `json` for backward compat.
        request_kwargs: dict[str, Any] = {"method": method, "url": url, "headers": headers}
        if body:
            if body_type == "form":
                request_kwargs["data"] = body
            else:
                request_kwargs["json"] = body

        status = 0
        ok = False
        resp_headers: dict[str, str] = {}
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.request(**request_kwargs)
                status = r.status_code
                ok = r.is_success
                resp_headers = dict(r.headers)
                try:
                    parsed = r.json()
                except Exception:
                    parsed = r.text
        except Exception as e:
            parsed = {"error": str(e)}

        # Keep the response body flat at api.<save_as> for backward compat
        # (so existing flows reading api.foo.<field> keep working) and add
        # metadata under reserved underscore keys: _status, _ok, _headers.
        if isinstance(parsed, dict):
            value = dict(parsed)
        else:
            value = {"value": parsed}
        value["_status"] = status
        value["_ok"] = ok
        value["_headers"] = resp_headers

        ctx.setdefault("api", {})[save_as] = value
        return NodeResult()

    # Pass-through stubs (wired in later phases): input, list, ai
    return NodeResult()


async def advance(
    definition: dict,
    context: dict[str, Any],
    reply: dict | None = None,
) -> AdvanceResult:
    nodes, edges = _index(definition)
    answers = context.setdefault("answers", {})

    # Apply pending reply to the currently-awaiting node
    reply_value: str | None = None
    advance_past = True  # whether to move past the awaiting node after handling
    if reply and context.get("awaiting"):
        aw = context["awaiting"]
        node = nodes.get(aw["node_id"], {})
        if node.get("type") == "buttons":
            reply_value = str(reply.get("value", ""))
            answers[aw["node_id"]] = reply_value
        elif node.get("type") == "form":
            values = reply.get("values") or {}
            answers.setdefault("form", {}).update(values)
            reply_value = None
        elif node.get("type") == "input":
            # Store under the configured field name so templating / conditions
            # can reference `answers.<field>`.
            cfg_ = node.get("config") or {}
            field_key = cfg_.get("field") or aw["node_id"]
            answers[field_key] = reply.get("value", "")
        elif node.get("type") == "schedule":
            cfg_ = node.get("config") or {}
            field_key = cfg_.get("field") or "site_visit"
            answers[field_key] = reply.get("value", "")
        elif node.get("type") == "otp":
            # OTP verification is a side effect the widget API performs.
            # The engine only sees `otp_verified` in the context after the fact.
            if context.get("otp_verified"):
                context["otp_verified"] = False  # consume
            else:
                # Stay on this node; widget API has already appended a retry
                # message and bumped attempts.
                advance_past = False
                current_id = aw["node_id"]

        if advance_past:
            current_id = _pick_next(aw["node_id"], edges, reply_value)
            context["awaiting"] = None
    else:
        current_id = context.get("current_node_id") or definition["start_node"]

    outputs: list[dict] = []
    ended = False

    # Safety cap to prevent infinite loops on malformed flows
    for _ in range(100):
        if current_id is None:
            break
        node = nodes.get(current_id)
        if node is None:
            break

        raw = await _run_node(node, context)
        # Condition nodes return a tuple (NodeResult, matched_edge_label);
        # other nodes just return a NodeResult.
        if isinstance(raw, tuple):
            result, branch = raw
        else:
            result, branch = raw, None

        if result.outputs:
            outputs.extend(result.outputs)

        if result.ends:
            ended = True
            context["awaiting"] = None
            context["current_node_id"] = None
            break

        if result.awaits_input:
            context["awaiting"] = {
                "node_id": current_id,
                "type": node["type"],
                "config": node.get("config", {}),
            }
            context["current_node_id"] = current_id
            break

        current_id = _pick_next(current_id, edges, branch)
        context["current_node_id"] = current_id
    else:
        # Loop cap exceeded — treat as ended to avoid hanging
        ended = True
        context["awaiting"] = None

    return AdvanceResult(outputs=outputs, awaiting=context.get("awaiting"), ended=ended)
