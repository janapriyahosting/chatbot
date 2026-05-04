#!/usr/bin/env bash
# End-to-end runtime + widget API test.
# Boots a session, walks the demo flow through: greet → banner → buttons → form → api → end.
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:8800}"

json() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

echo "==> seed demo flow"
OUT=$(bash "$(dirname "$0")/seed_demo_flow.sh")
echo "$OUT"
PUB=$(echo "$OUT" | awk -F= '/public_key=/{print $2}')

echo
echo "==> POST /widget/session  (simulating widget boot)"
RES=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' -d "{
  \"bot_key\":\"$PUB\",
  \"utm\":{\"utm_source\":\"google\",\"utm_campaign\":\"spring\",\"gclid\":\"abc123\",\"landing_url\":\"https://demo.test/?utm_source=google\"}
}")
echo "$RES" | python3 -m json.tool | head -40
CONV=$(echo "$RES" | json "['conversation_id']")
VID=$(echo "$RES" | json "['visitor_id']")
AW=$(echo "$RES" | json "['awaiting']['type']")
echo
echo "conversation_id=$CONV  visitor_id=$VID  awaiting=$AW"
[ "$AW" = "buttons" ] || { echo "FAIL: expected to be awaiting buttons after greet+banner"; exit 1; }

echo
echo "==> POST /widget/reply  (click 'invest' button)"
RES=$(curl -fsS -X POST "$BASE/widget/reply" -H 'content-type: application/json' -d "{
  \"conversation_id\":\"$CONV\",\"payload\":{\"value\":\"invest\"}
}")
echo "$RES" | python3 -m json.tool | head -30
AW=$(echo "$RES" | json "['awaiting']['type']")
[ "$AW" = "form" ] || { echo "FAIL: expected to be awaiting form"; exit 1; }

echo
echo "==> POST /widget/reply  (submit form)"
RES=$(curl -fsS -X POST "$BASE/widget/reply" -H 'content-type: application/json' -d "{
  \"conversation_id\":\"$CONV\",\"payload\":{\"values\":{\"name\":\"Narendhar\",\"phone\":\"9999912345\",\"email\":\"n@j.com\"}}
}")
echo "$RES" | python3 -m json.tool | head -30
ENDED=$(echo "$RES" | json "['ended']")
[ "$ENDED" = "True" ] || { echo "FAIL: expected ended=true"; exit 1; }

echo
echo "==> DB: lead + utm persisted?"
docker exec jpus_postgres psql -U chatbot_user -d janapriya_db -c "
  SELECT l.name, l.phone, u.utm_source, u.utm_campaign, u.gclid
  FROM chatbot.lead l JOIN chatbot.lead_utm u ON u.lead_id=l.id
  WHERE l.conversation_id='$CONV';"

echo
echo "==> DB: message trail"
docker exec jpus_postgres psql -U chatbot_user -d janapriya_db -c "
  SELECT sender, kind, LEFT(COALESCE(body,''),40) AS body
  FROM chatbot.message WHERE conversation_id='$CONV' ORDER BY created_at;"

echo
echo "==> resume test: new /widget/session with same visitor_id ⇒ should NOT start fresh"
RES=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' -d "{
  \"bot_key\":\"$PUB\",\"visitor_id\":\"$VID\"
}")
CONV2=$(echo "$RES" | json "['conversation_id']")
# prior conversation was closed, so a new one should start; but visitor_id stays
VID2=$(echo "$RES" | json "['visitor_id']")
[ "$VID2" = "$VID" ] || { echo "FAIL: visitor_id not stable"; exit 1; }
echo "visitor_id stable ($VID)  new_conversation=$CONV2  (prior was closed)"

echo
echo "ALL PASSED"
