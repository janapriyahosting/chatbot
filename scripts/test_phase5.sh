#!/usr/bin/env bash
# Phase 5: form -> otp node -> verify via jpus -> Lead.phone_verified=true.
# Uses OTP_DEV_BYPASS=true so the fixed code "123456" is accepted without SMS.
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:8800}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@janapriyaupscale.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@12345}"

json() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

TOKEN=$(curl -fsS -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | json "['access_token']")
AH=(-H "authorization: Bearer $TOKEN")

SITE=$(curl -fsS -X POST "$BASE/sites" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"P5\",\"domain\":\"p5-$(date +%s).example.com\"}")
SITE_ID=$(echo "$SITE" | json "['id']")
BOT=$(curl -fsS -X POST "$BASE/bots" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"P5 Bot\",\"channel\":\"web\",\"site_id\":\"$SITE_ID\"}")
BOT_ID=$(echo "$BOT" | json "['id']")
PUB=$(echo "$BOT" | json "['public_key']")

FLOW=$(curl -fsS -X POST "$BASE/bots/$BOT_ID/flows" "${AH[@]}" -H 'content-type: application/json' -d '{
  "name":"otp demo",
  "definition":{
    "start_node":"s",
    "nodes":[
      {"id":"s","type":"start"},
      {"id":"f","type":"form","config":{"fields":[{"name":"name"},{"name":"phone"}]}},
      {"id":"o","type":"otp","config":{"phone_field":"phone"}},
      {"id":"t","type":"text","config":{"body":"Thanks, verified!"}},
      {"id":"e","type":"end"}
    ],
    "edges":[
      {"source":"s","target":"f"},
      {"source":"f","target":"o"},
      {"source":"o","target":"t"},
      {"source":"t","target":"e"}
    ]
  }
}')
FLOW_ID=$(echo "$FLOW" | json "['id']")
curl -fsS -X POST "$BASE/bots/$BOT_ID/flows/$FLOW_ID/publish" "${AH[@]}" > /dev/null

echo "==> boot session (expect form)"
RES=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' \
  -d "{\"bot_key\":\"$PUB\"}")
CONV=$(echo "$RES" | json "['conversation_id']")
AW=$(echo "$RES" | json "['awaiting']['type']")
[ "$AW" = "form" ] || { echo "FAIL: expected form, got $AW"; exit 1; }

echo "==> submit form with phone 9876543210"
RES=$(curl -fsS -X POST "$BASE/widget/reply" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV\",\"payload\":{\"values\":{\"name\":\"Test\",\"phone\":\"9876543210\"}}}")
AW=$(echo "$RES" | json "['awaiting']['type']")
[ "$AW" = "otp" ] || { echo "FAIL: expected awaiting otp, got $AW"; exit 1; }
HAS_OTP_INPUT=$(echo "$RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(any(o['kind']=='otp' for o in d['outputs']))")
[ "$HAS_OTP_INPUT" = "True" ] || { echo "FAIL: no otp output"; exit 1; }
echo "form submitted, OTP input presented"

echo "==> wrong OTP: 000000 (should stay awaiting, attempt 1/3)"
RES=$(curl -fsS -X POST "$BASE/widget/reply" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV\",\"payload\":{\"value\":\"000000\"}}")
AW=$(echo "$RES" | json "['awaiting']['type']")
[ "$AW" = "otp" ] || { echo "FAIL: wrong OTP should keep us awaiting otp, got $AW"; exit 1; }
ERR_MSG=$(echo "$RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print([o['config']['body'] for o in d['outputs'] if 'Incorrect' in str(o.get('config',{}).get('body',''))][0])")
echo "got retry msg: $ERR_MSG"

echo "==> correct OTP: 123456"
RES=$(curl -fsS -X POST "$BASE/widget/reply" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV\",\"payload\":{\"value\":\"123456\"}}")
ENDED=$(echo "$RES" | json "['ended']")
[ "$ENDED" = "True" ] || { echo "FAIL: expected ended after OTP verify, got ended=$ENDED"; exit 1; }
THANKS=$(echo "$RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(any('verified' in (o['config'].get('body') or '').lower() or 'Thanks' in (o['config'].get('body') or '') for o in d['outputs']))")
[ "$THANKS" = "True" ] || { echo "FAIL: expected a thanks/verified message"; exit 1; }

echo "==> DB: lead.phone_verified should be true"
V=$(docker exec jpus_postgres psql -U chatbot_user -d janapriya_db -tA -c \
  "SELECT phone_verified FROM chatbot.lead WHERE conversation_id='$CONV';")
[ "$V" = "t" ] || { echo "FAIL: lead.phone_verified=$V"; exit 1; }

echo
echo "==> max-attempts path: fresh session, 3 wrong OTPs -> flow advances anyway"
RES=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' \
  -d "{\"bot_key\":\"$PUB\"}")
CONV2=$(echo "$RES" | json "['conversation_id']")
curl -fsS -X POST "$BASE/widget/reply" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV2\",\"payload\":{\"values\":{\"name\":\"X\",\"phone\":\"9876543210\"}}}" > /dev/null
for i in 1 2; do
  curl -fsS -X POST "$BASE/widget/reply" -H 'content-type: application/json' \
    -d "{\"conversation_id\":\"$CONV2\",\"payload\":{\"value\":\"000000\"}}" > /dev/null
done
FINAL=$(curl -fsS -X POST "$BASE/widget/reply" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV2\",\"payload\":{\"value\":\"000000\"}}")
ENDED=$(echo "$FINAL" | json "['ended']")
[ "$ENDED" = "True" ] || { echo "FAIL: expected ended after 3 wrong OTPs, got $ENDED"; exit 1; }
V2=$(docker exec jpus_postgres psql -U chatbot_user -d janapriya_db -tA -c \
  "SELECT phone_verified FROM chatbot.lead WHERE conversation_id='$CONV2';")
[ "$V2" = "f" ] || { echo "FAIL: max-attempts lead should have phone_verified=false, got $V2"; exit 1; }

echo
echo "ALL PASSED"
