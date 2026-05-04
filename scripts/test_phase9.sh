#!/usr/bin/env bash
# Phase 9: bot delete (+ cascade), api key lifecycle, analytics, agent-token gating.
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:8800}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@janapriyaupscale.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@12345}"

json() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

TOKEN=$(curl -fsS -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | json "['access_token']")
AH=(-H "authorization: Bearer $TOKEN")

echo "==> 1) create a bot + flow, then DELETE → cascades to flow"
SITE_ID=$(curl -fsS -X POST "$BASE/sites" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"P9\",\"domain\":\"p9-$(date +%s).example.com\"}" | json "['id']")
BOT_ID=$(curl -fsS -X POST "$BASE/bots" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"to delete\",\"channel\":\"web\",\"site_id\":\"$SITE_ID\"}" | json "['id']")
curl -fsS -X POST "$BASE/bots/$BOT_ID/flows" "${AH[@]}" -H 'content-type: application/json' \
  -d '{"name":"n","definition":{"start_node":"s","nodes":[{"id":"s","type":"start"},{"id":"e","type":"end"}],"edges":[{"source":"s","target":"e"}]}}' > /dev/null
FLOW_COUNT_BEFORE=$(docker exec jpus_postgres psql -U chatbot_user -d janapriya_db -tA -c \
  "SELECT count(*) FROM chatbot.flow WHERE bot_id='$BOT_ID'")
[ "$FLOW_COUNT_BEFORE" = "1" ] || { echo "FAIL: expected flow count 1, got $FLOW_COUNT_BEFORE"; exit 1; }

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE/bots/$BOT_ID" "${AH[@]}")
[ "$STATUS" = "204" ] || { echo "FAIL: DELETE returned $STATUS"; exit 1; }
FLOW_COUNT_AFTER=$(docker exec jpus_postgres psql -U chatbot_user -d janapriya_db -tA -c \
  "SELECT count(*) FROM chatbot.flow WHERE bot_id='$BOT_ID'")
[ "$FLOW_COUNT_AFTER" = "0" ] || { echo "FAIL: cascade failed, flow count=$FLOW_COUNT_AFTER"; exit 1; }
echo "  bot + flow gone ✓"

echo
echo "==> 2) deactivate via PATCH is_active=false"
BOT_ID=$(curl -fsS -X POST "$BASE/bots" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"to deactivate\",\"channel\":\"web\"}" | json "['id']")
PATCHED=$(curl -fsS -X PATCH "$BASE/bots/$BOT_ID" "${AH[@]}" -H 'content-type: application/json' \
  -d '{"is_active":false}')
[ "$(echo "$PATCHED" | json "['is_active']")" = "False" ] || { echo "FAIL: not deactivated"; exit 1; }
echo "  deactivate ok ✓"

echo
echo "==> 3) API key lifecycle: create → use → revoke"
KEY_RESP=$(curl -fsS -X POST "$BASE/api-keys" "${AH[@]}" -H 'content-type: application/json' \
  -d '{"name":"smoke test"}')
KEY_ID=$(echo "$KEY_RESP" | json "['id']")
RAW_KEY=$(echo "$KEY_RESP" | json "['key']")
echo "  key created: prefix=$(echo "$KEY_RESP" | json "['prefix']")"

# Should authenticate a protected endpoint
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "X-API-Key: $RAW_KEY" "$BASE/bots")
[ "$STATUS" = "200" ] || { echo "FAIL: X-API-Key auth returned $STATUS"; exit 1; }
echo "  X-API-Key auth works ✓"

# After revoke, the same key should 401
curl -fsS -X POST "$BASE/api-keys/$KEY_ID/revoke" "${AH[@]}" > /dev/null
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "X-API-Key: $RAW_KEY" "$BASE/bots")
[ "$STATUS" = "401" ] || { echo "FAIL: revoked key got $STATUS (expected 401)"; exit 1; }
echo "  revoked key rejected ✓"

echo
echo "==> 4) analytics endpoint (supervisor-gated)"
A=$(curl -fsS "$BASE/analytics" "${AH[@]}")
echo "$A" | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert 'conversations' in d and 'leads' in d and 'top_utm_sources_30d' in d, 'missing keys'
assert isinstance(d['conversations']['total'], int)
print(f\"  convs.total={d['conversations']['total']}  leads.total={d['leads']['total']}  verified_pct={d['leads']['verified_pct']}%\")
"

# Agent should get 403
AGENT_EMAIL="p9-agent-$(date +%s)@janapriyaupscale.com"
curl -fsS -X POST "$BASE/users" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"email\":\"$AGENT_EMAIL\",\"display_name\":\"x\",\"role\":\"agent\",\"password\":\"Agent@12345\"}" > /dev/null
AGENT_TOKEN=$(curl -fsS -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$AGENT_EMAIL\",\"password\":\"Agent@12345\"}" | json "['access_token']")
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "authorization: Bearer $AGENT_TOKEN" "$BASE/analytics")
[ "$STATUS" = "403" ] || { echo "FAIL: agent analytics got $STATUS (expected 403)"; exit 1; }
echo "  agent 403 on analytics ✓"

echo
echo "ALL PASSED"
