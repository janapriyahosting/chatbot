#!/usr/bin/env bash
# End-to-end smoke test for Phase 1.
# Assumes the server is already running on $BASE (default 127.0.0.1:8800).
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:8800}"
DOMAIN="${DOMAIN:-phase1-$(date +%s).example.com}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@janapriyaupscale.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@12345}"

json() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

TOKEN=$(curl -fsS -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | json "['access_token']")
AUTH_H=(-H "authorization: Bearer $TOKEN")

echo "==> /health"
curl -fsS "$BASE/health" && echo

echo "==> create site"
SITE_ID=$(curl -fsS -X POST "$BASE/sites" "${AUTH_H[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"Phase1 Test Site\",\"domain\":\"$DOMAIN\"}" | json "['id']")
echo "site_id=$SITE_ID"

echo "==> create bot"
BOT=$(curl -fsS -X POST "$BASE/bots" "${AUTH_H[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"Phase1 Bot\",\"channel\":\"web\",\"site_id\":\"$SITE_ID\"}")
BOT_ID=$(echo "$BOT" | json "['id']")
PUBLIC_KEY=$(echo "$BOT" | json "['public_key']")
echo "bot_id=$BOT_ID  public_key=$PUBLIC_KEY"

echo "==> create flow (v1)"
FLOW_ID=$(curl -fsS -X POST "$BASE/bots/$BOT_ID/flows" "${AUTH_H[@]}" -H 'content-type: application/json' -d '{
  "name":"Lead capture v1",
  "definition":{
    "start_node":"s",
    "nodes":[
      {"id":"s","type":"start"},
      {"id":"hi","type":"text","config":{"body":"Hello!"}},
      {"id":"f","type":"form","config":{"fields":[{"name":"phone"}]}},
      {"id":"o","type":"otp","config":{"phone_field":"phone"}},
      {"id":"e","type":"end"}
    ],
    "edges":[
      {"source":"s","target":"hi"},
      {"source":"hi","target":"f"},
      {"source":"f","target":"o"},
      {"source":"o","target":"e"}
    ]
  }
}' | json "['id']")
echo "flow_id=$FLOW_ID"

echo "==> patch flow (should bump to v2)"
V2=$(curl -fsS -X PATCH "$BASE/bots/$BOT_ID/flows/$FLOW_ID" "${AUTH_H[@]}" -H 'content-type: application/json' -d '{
  "definition":{"start_node":"s","nodes":[{"id":"s","type":"start"},{"id":"e","type":"end"}],"edges":[{"source":"s","target":"e"}]}
}' | json "['current_version']")
echo "current_version=$V2"
[ "$V2" = "2" ] || { echo "FAIL: expected v2"; exit 1; }

echo "==> validation: bad edge should 422"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/bots/$BOT_ID/flows" "${AUTH_H[@]}" -H 'content-type: application/json' -d '{"name":"bad","definition":{"start_node":"a","nodes":[{"id":"a","type":"start"}],"edges":[{"source":"a","target":"ghost"}]}}')
[ "$code" = "422" ] || { echo "FAIL: expected 422, got $code"; exit 1; }
echo "ok ($code)"

echo "==> duplicate domain should 409"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/sites" "${AUTH_H[@]}" -H 'content-type: application/json' -d "{\"name\":\"dup\",\"domain\":\"$DOMAIN\"}")
[ "$code" = "409" ] || { echo "FAIL: expected 409, got $code"; exit 1; }
echo "ok ($code)"

echo
echo "ALL PASSED"
