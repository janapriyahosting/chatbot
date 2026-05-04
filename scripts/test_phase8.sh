#!/usr/bin/env bash
# Phase 8: CSV export, search, markdown renders round-trip through widget message body.
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:8800}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@janapriyaupscale.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@12345}"

json() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

TOKEN=$(curl -fsS -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | json "['access_token']")
AH=(-H "authorization: Bearer $TOKEN")

echo "==> 1) CSV export (no filter)"
CSV_HEAD=$(curl -fsS "$BASE/leads.csv" "${AH[@]}" | head -1)
echo "  header: $CSV_HEAD"
echo "$CSV_HEAD" | grep -q '^created_at,name,phone,email,phone_verified' || { echo "FAIL: unexpected CSV header"; exit 1; }
ROW_COUNT=$(curl -fsS "$BASE/leads.csv" "${AH[@]}" | wc -l)
echo "  total rows (incl header): $ROW_COUNT"

echo
echo "==> 2) JSON leads listing"
LEADS_JSON=$(curl -fsS "$BASE/leads?limit=5" "${AH[@]}")
N=$(echo "$LEADS_JSON" | python3 -c "import sys,json;print(len(json.load(sys.stdin)))")
echo "  leads returned (<=5): $N"

echo
echo "==> 3) conversation search (supervisor gated)"
# Search for the Narendhar lead we know exists from earlier phases
RESULTS=$(curl -fsS "$BASE/agent/search?q=Narendhar" "${AH[@]}")
MATCH=$(echo "$RESULTS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "  matches for 'Narendhar': $MATCH"
[ "$MATCH" -ge 1 ] || { echo "FAIL: expected at least one match for Narendhar"; exit 1; }

echo "  non-supervisor (agent token) should 403"
# Create an agent to confirm gating
AGENT_EMAIL="agent-p8-$(date +%s)@janapriyaupscale.com"
curl -fsS -X POST "$BASE/users" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"email\":\"$AGENT_EMAIL\",\"display_name\":\"P8 agent\",\"role\":\"agent\",\"password\":\"Agent@12345\"}" > /dev/null
AGENT_TOKEN=$(curl -fsS -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$AGENT_EMAIL\",\"password\":\"Agent@12345\"}" | json "['access_token']")
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "authorization: Bearer $AGENT_TOKEN" "$BASE/agent/search?q=x")
[ "$CODE" = "403" ] || { echo "FAIL: agent should be 403 on search, got $CODE"; exit 1; }

echo "  non-supervisor leads download should 403"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "authorization: Bearer $AGENT_TOKEN" "$BASE/leads.csv")
[ "$CODE" = "403" ] || { echo "FAIL: agent should be 403 on leads.csv, got $CODE"; exit 1; }

echo
echo "==> 4) markdown round-trip: save a flow with **bold**, verify it comes back verbatim in /widget/session"
SITE_ID=$(curl -fsS -X POST "$BASE/sites" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"P8\",\"domain\":\"p8-$(date +%s).example.com\"}" | json "['id']")
BOT=$(curl -fsS -X POST "$BASE/bots" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"P8 Bot\",\"channel\":\"web\",\"site_id\":\"$SITE_ID\"}")
BOT_ID=$(echo "$BOT" | json "['id']")
PUB=$(echo "$BOT" | json "['public_key']")
FLOW=$(curl -fsS -X POST "$BASE/bots/$BOT_ID/flows" "${AH[@]}" -H 'content-type: application/json' -d '{
  "name":"md",
  "definition":{
    "start_node":"s",
    "nodes":[
      {"id":"s","type":"start"},
      {"id":"t","type":"text","config":{"body":"Hi! **bold** and [link](https://example.com). 🎉"}},
      {"id":"e","type":"end"}
    ],
    "edges":[{"source":"s","target":"t"},{"source":"t","target":"e"}]
  }
}')
FLOW_ID=$(echo "$FLOW" | json "['id']")
curl -fsS -X POST "$BASE/bots/$BOT_ID/flows/$FLOW_ID/publish" "${AH[@]}" > /dev/null
R=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' -d "{\"bot_key\":\"$PUB\"}")
BODY=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); [print(o['config']['body']) for o in d['outputs'] if o['kind']=='text']")
echo "  round-tripped: $BODY"
echo "$BODY" | grep -q "\*\*bold\*\*" || { echo "FAIL: markdown not preserved"; exit 1; }
echo "$BODY" | grep -q "https://example.com" || { echo "FAIL: link not preserved"; exit 1; }

echo
echo "ALL PASSED"
