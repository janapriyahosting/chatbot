#!/usr/bin/env bash
# End-to-end: admin creates agent, bot has auto_assign + handoff flow,
# visitor walks to handoff -> auto-assigned, agent messages, visitor polls,
# visitor replies, agent closes.
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:8800}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@janapriyaupscale.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@12345}"
AGENT_EMAIL="agent-$(date +%s)@janapriyaupscale.com"
AGENT_PASSWORD="Agent@12345"

json() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

echo "==> admin login"
ADMIN_TOKEN=$(curl -fsS -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | json "['access_token']")
AH=(-H "authorization: Bearer $ADMIN_TOKEN")

echo "==> create agent user"
AGENT_USER=$(curl -fsS -X POST "$BASE/users" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"email\":\"$AGENT_EMAIL\",\"display_name\":\"Test Agent\",\"role\":\"agent\",\"password\":\"$AGENT_PASSWORD\"}")
AGENT_ID=$(echo "$AGENT_USER" | json "['id']")
echo "agent_id=$AGENT_ID"

echo "==> agent logs in + marks themselves available"
AGENT_TOKEN=$(curl -fsS -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$AGENT_EMAIL\",\"password\":\"$AGENT_PASSWORD\"}" | json "['access_token']")
GH=(-H "authorization: Bearer $AGENT_TOKEN")
curl -fsS -X PATCH "$BASE/users/$AGENT_ID" "${GH[@]}" -H 'content-type: application/json' \
  -d '{"is_available":true}' > /dev/null

echo "==> create site+bot with auto_assign=true"
SITE_ID=$(curl -fsS -X POST "$BASE/sites" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"P4\",\"domain\":\"p4-$(date +%s).example.com\"}" | json "['id']")
BOT=$(curl -fsS -X POST "$BASE/bots" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"P4 Bot\",\"channel\":\"web\",\"site_id\":\"$SITE_ID\"}")
BOT_ID=$(echo "$BOT" | json "['id']")
PUB=$(echo "$BOT" | json "['public_key']")
curl -fsS -X PATCH "$BASE/bots/$BOT_ID" "${AH[@]}" -H 'content-type: application/json' \
  -d '{}' > /dev/null  # noop — show patch works
# Direct SQL UPDATE to set auto_assign=true since PATCH schema only has name/is_active
docker exec jpus_postgres psql -U chatbot_user -d janapriya_db -c \
  "UPDATE chatbot.bot SET auto_assign=true WHERE id='$BOT_ID'" > /dev/null

echo "==> create + publish flow with handoff"
FLOW=$(curl -fsS -X POST "$BASE/bots/$BOT_ID/flows" "${AH[@]}" -H 'content-type: application/json' -d '{
  "name":"handoff demo",
  "definition":{
    "start_node":"s",
    "nodes":[
      {"id":"s","type":"start"},
      {"id":"hi","type":"text","config":{"body":"Hi! Let me connect you."}},
      {"id":"h","type":"handoff","config":{"body":"Connecting you now..."}}
    ],
    "edges":[{"source":"s","target":"hi"},{"source":"hi","target":"h"}]
  }
}')
FLOW_ID=$(echo "$FLOW" | json "['id']")
curl -fsS -X POST "$BASE/bots/$BOT_ID/flows/$FLOW_ID/publish" "${AH[@]}" > /dev/null

echo "==> visitor boots widget -> should auto-assign"
RES=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' \
  -d "{\"bot_key\":\"$PUB\"}")
CONV=$(echo "$RES" | json "['conversation_id']")
STATUS=$(echo "$RES" | json "['status']")
echo "status=$STATUS  conv=$CONV"
[ "$STATUS" = "assigned" ] || { echo "FAIL: expected assigned, got $STATUS"; exit 1; }

echo "==> agent lists mine -> should see conv"
MINE=$(curl -fsS "$BASE/agent/conversations?scope=mine" "${GH[@]}" | json "[0]['id']")
[ "$MINE" = "$CONV" ] || { echo "FAIL: agent does not see conv in mine"; exit 1; }

echo "==> agent sends message"
curl -fsS -X POST "$BASE/agent/conversations/$CONV/message" "${GH[@]}" \
  -H 'content-type: application/json' -d '{"text":"Hi, how can I help?"}' > /dev/null

echo "==> visitor polls -> should receive agent message"
POLL=$(curl -fsS -X POST "$BASE/widget/poll" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV\"}")
echo "$POLL" | python3 -m json.tool | head -30
AGENT_MSG=$(echo "$POLL" | python3 -c "import sys,json; d=json.load(sys.stdin); [print(m['body']) for m in d['messages'] if m['sender']=='agent']")
[ "$AGENT_MSG" = "Hi, how can I help?" ] || { echo "FAIL: poll did not return agent msg"; exit 1; }

echo "==> visitor sends free message"
curl -fsS -X POST "$BASE/widget/message" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV\",\"text\":\"Looking for 2BHK\"}" > /dev/null

echo "==> agent sees visitor message"
DETAIL=$(curl -fsS "$BASE/agent/conversations/$CONV" "${GH[@]}")
VISITOR_MSG=$(echo "$DETAIL" | python3 -c "import sys,json; d=json.load(sys.stdin); [print(m['body']) for m in d['messages'] if m['sender']=='visitor' and m['kind']=='text']")
[ "$VISITOR_MSG" = "Looking for 2BHK" ] || { echo "FAIL: visitor msg not in detail"; exit 1; }

echo "==> agent closes"
curl -fsS -X POST "$BASE/agent/conversations/$CONV/close" "${GH[@]}" > /dev/null

echo "==> final status"
FINAL=$(curl -fsS -X POST "$BASE/widget/poll" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV\"}" | json "['status']")
[ "$FINAL" = "closed" ] || { echo "FAIL: status $FINAL"; exit 1; }

echo
echo "==> manual-assign path: auto_assign=false, handoff queues, supervisor assigns"
docker exec jpus_postgres psql -U chatbot_user -d janapriya_db -c \
  "UPDATE chatbot.bot SET auto_assign=false WHERE id='$BOT_ID'" > /dev/null
RES=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' \
  -d "{\"bot_key\":\"$PUB\"}")
CONV2=$(echo "$RES" | json "['conversation_id']")
STATUS=$(echo "$RES" | json "['status']")
[ "$STATUS" = "queued" ] || { echo "FAIL: expected queued, got $STATUS"; exit 1; }

echo "supervisor sees in queue"
QUEUED=$(curl -fsS "$BASE/agent/conversations?scope=queue" "${AH[@]}" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
[ "$QUEUED" -ge 1 ] || { echo "FAIL: queue empty"; exit 1; }

echo "supervisor assigns to agent $AGENT_ID"
curl -fsS -X POST "$BASE/agent/conversations/$CONV2/assign" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"user_id\":\"$AGENT_ID\"}" > /dev/null

POST_STATUS=$(curl -fsS -X POST "$BASE/widget/poll" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV2\"}" | json "['status']")
[ "$POST_STATUS" = "assigned" ] || { echo "FAIL: expected assigned, got $POST_STATUS"; exit 1; }

echo
echo "ALL PASSED"
