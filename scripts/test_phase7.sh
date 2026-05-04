#!/usr/bin/env bash
# Phase 7: form validation, condition rules, API bearer auth, AI node, handoff AI fallback, persona.
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:8800}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@janapriyaupscale.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@12345}"

json() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

TOKEN=$(curl -fsS -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | json "['access_token']")
AH=(-H "authorization: Bearer $TOKEN")

SITE_ID=$(curl -fsS -X POST "$BASE/sites" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"P7\",\"domain\":\"p7-$(date +%s).example.com\"}" | json "['id']")

BOT=$(curl -fsS -X POST "$BASE/bots" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"P7 Bot\",\"channel\":\"web\",\"site_id\":\"$SITE_ID\"}")
BOT_ID=$(echo "$BOT" | json "['id']")
PUB=$(echo "$BOT" | json "['public_key']")

echo "==> set persona via PATCH"
PATCHED=$(curl -fsS -X PATCH "$BASE/bots/$BOT_ID" "${AH[@]}" -H 'content-type: application/json' \
  -d '{"persona_name":"Asha","persona_avatar":"https://example.com/asha.png"}')
PNAME=$(echo "$PATCHED" | json "['persona_name']")
[ "$PNAME" = "Asha" ] || { echo "FAIL: persona not saved, got $PNAME"; exit 1; }

echo "==> 1) form field types + validation"
FLOW=$(curl -fsS -X POST "$BASE/bots/$BOT_ID/flows" "${AH[@]}" -H 'content-type: application/json' -d '{
  "name":"typed form",
  "definition":{
    "start_node":"s",
    "nodes":[
      {"id":"s","type":"start"},
      {"id":"f","type":"form","config":{"fields":[
        {"name":"email","type":"email","label":"Email"},
        {"name":"phone","type":"tel","label":"Phone"},
        {"name":"age","type":"number","label":"Age","min":18,"max":100},
        {"name":"plan","type":"select","label":"Plan","options":[{"label":"A","value":"a"},{"label":"B","value":"b"}]}
      ]}},
      {"id":"t","type":"text","config":{"body":"Got it."}},
      {"id":"e","type":"end"}
    ],
    "edges":[{"source":"s","target":"f"},{"source":"f","target":"t"},{"source":"t","target":"e"}]
  }
}')
FLOW_ID=$(echo "$FLOW" | json "['id']")
curl -fsS -X POST "$BASE/bots/$BOT_ID/flows/$FLOW_ID/publish" "${AH[@]}" > /dev/null

RES=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' -d "{\"bot_key\":\"$PUB\"}")
CONV=$(echo "$RES" | json "['conversation_id']")

echo "  bad email/phone/age/plan -> 422 with field_errors"
STATUS=$(curl -s -o /tmp/p7err -w "%{http_code}" -X POST "$BASE/widget/reply" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV\",\"payload\":{\"values\":{\"email\":\"nope\",\"phone\":\"123\",\"age\":\"12\",\"plan\":\"c\"}}}")
[ "$STATUS" = "422" ] || { echo "FAIL: expected 422, got $STATUS"; cat /tmp/p7err; exit 1; }
ERRS=$(python3 -c "import json; d=json.load(open('/tmp/p7err')); print(' '.join(sorted(d['detail']['field_errors'].keys())))")
echo "    field errors: $ERRS"
[ "$ERRS" = "age email phone plan" ] || { echo "FAIL: expected all 4 fields to fail, got: $ERRS"; exit 1; }

echo "  good values -> 200"
R=$(curl -fsS -X POST "$BASE/widget/reply" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV\",\"payload\":{\"values\":{\"email\":\"a@b.com\",\"phone\":\"9876543210\",\"age\":\"25\",\"plan\":\"a\"}}}")
echo "    ended=$(echo "$R" | json "['ended']")"

echo
echo "==> 2) condition rules (UI-style) -> expression"
FLOW=$(curl -fsS -X POST "$BASE/bots/$BOT_ID/flows" "${AH[@]}" -H 'content-type: application/json' -d '{
  "name":"rules cond",
  "definition":{
    "start_node":"s",
    "nodes":[
      {"id":"s","type":"start"},
      {"id":"f","type":"form","config":{"fields":[{"name":"age","type":"number"}]}},
      {"id":"c","type":"condition","config":{"logic":"and","rules":[
        {"left":"answers.form.age","op":">=","right":"18"}
      ]}},
      {"id":"ok","type":"text","config":{"body":"Proceed."}},
      {"id":"no","type":"text","config":{"body":"Blocked."}},
      {"id":"e","type":"end"}
    ],
    "edges":[
      {"source":"s","target":"f"},{"source":"f","target":"c"},
      {"source":"c","target":"ok","condition":"true"},
      {"source":"c","target":"no","condition":"false"},
      {"source":"ok","target":"e"},{"source":"no","target":"e"}
    ]
  }
}')
FID=$(echo "$FLOW" | json "['id']")
curl -fsS -X POST "$BASE/bots/$BOT_ID/flows/$FID/publish" "${AH[@]}" > /dev/null
RES=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' -d "{\"bot_key\":\"$PUB\"}")
C=$(echo "$RES" | json "['conversation_id']")
BODY=$(curl -fsS -X POST "$BASE/widget/reply" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$C\",\"payload\":{\"values\":{\"age\":\"30\"}}}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(' '.join(o['config'].get('body','') for o in d['outputs']))")
echo "  age 30 -> $BODY"
echo "$BODY" | grep -q "Proceed" || { echo "FAIL: rules true branch"; exit 1; }

echo
echo "==> 3) API bearer auth — the node should add Authorization: Bearer ..."
# Use httpbin.org/bearer which echoes auth result
FLOW=$(curl -fsS -X POST "$BASE/bots/$BOT_ID/flows" "${AH[@]}" -H 'content-type: application/json' -d '{
  "name":"api bearer",
  "definition":{
    "start_node":"s",
    "nodes":[
      {"id":"s","type":"start"},
      {"id":"api","type":"api","config":{
        "method":"GET","url":"https://httpbin.org/bearer",
        "auth":{"type":"bearer","token":"testtoken123"},
        "save_as":"out"
      }},
      {"id":"t","type":"text","config":{"body":"Auth: {{api.out.authenticated}}"}},
      {"id":"e","type":"end"}
    ],
    "edges":[{"source":"s","target":"api"},{"source":"api","target":"t"},{"source":"t","target":"e"}]
  }
}')
FID=$(echo "$FLOW" | json "['id']")
curl -fsS -X POST "$BASE/bots/$BOT_ID/flows/$FID/publish" "${AH[@]}" > /dev/null
R=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' -d "{\"bot_key\":\"$PUB\"}")
TEXT=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(' '.join(o['config'].get('body','') for o in d['outputs'] if o['kind']=='text'))")
echo "  templated text: $TEXT"
echo "$TEXT" | grep -q "Auth: True" || { echo "FAIL: bearer auth not applied ($TEXT)"; exit 1; }

echo
echo "==> 4) AI node — free chat; visitor msg -> AI replies via /widget/poll"
FLOW=$(curl -fsS -X POST "$BASE/bots/$BOT_ID/flows" "${AH[@]}" -H 'content-type: application/json' -d '{
  "name":"ai direct",
  "definition":{
    "start_node":"s",
    "nodes":[
      {"id":"s","type":"start"},
      {"id":"ai","type":"ai","config":{"body":"Hi, I am Asha. Ask me.","system_prompt":"Reply in exactly 3 words."}}
    ],
    "edges":[{"source":"s","target":"ai"}]
  }
}')
FID=$(echo "$FLOW" | json "['id']")
curl -fsS -X POST "$BASE/bots/$BOT_ID/flows/$FID/publish" "${AH[@]}" > /dev/null
R=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' -d "{\"bot_key\":\"$PUB\"}")
C=$(echo "$R" | json "['conversation_id']")
STATUS=$(echo "$R" | json "['status']")
[ "$STATUS" = "ai" ] || { echo "FAIL: expected status=ai, got $STATUS"; exit 1; }
PERSONA=$(echo "$R" | json "['persona']['name']")
[ "$PERSONA" = "Asha" ] || { echo "FAIL: persona not in response ($PERSONA)"; exit 1; }

curl -fsS -X POST "$BASE/widget/message" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$C\",\"text\":\"what colour is grass?\"}" > /dev/null
POLL=$(curl -fsS -X POST "$BASE/widget/poll" -H 'content-type: application/json' -d "{\"conversation_id\":\"$C\"}")
AI_MSGS=$(echo "$POLL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sum(1 for m in d['messages'] if m['sender']=='bot' and m['body']))")
echo "  bot (AI) messages in poll: $AI_MSGS"
[ "$AI_MSGS" -ge 2 ] || { echo "FAIL: expected intro + ai reply, got $AI_MSGS"; exit 1; }

echo
echo "==> 5) handoff AI fallback (no agents available)"
# Disable any available agents so assignment fails
docker exec jpus_postgres psql -U chatbot_user -d janapriya_db -c \
  "UPDATE chatbot.\"user\" SET is_available=false WHERE role='agent'" > /dev/null
docker exec jpus_postgres psql -U chatbot_user -d janapriya_db -c \
  "UPDATE chatbot.bot SET auto_assign=true WHERE id='$BOT_ID'" > /dev/null

FLOW=$(curl -fsS -X POST "$BASE/bots/$BOT_ID/flows" "${AH[@]}" -H 'content-type: application/json' -d '{
  "name":"handoff to ai",
  "definition":{
    "start_node":"s",
    "nodes":[
      {"id":"s","type":"start"},
      {"id":"h","type":"handoff","config":{"body":"Let me check…","ai_fallback":true,"ai_system_prompt":"Reply briefly in 5 words."}}
    ],
    "edges":[{"source":"s","target":"h"}]
  }
}')
FID=$(echo "$FLOW" | json "['id']")
curl -fsS -X POST "$BASE/bots/$BOT_ID/flows/$FID/publish" "${AH[@]}" > /dev/null
R=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' -d "{\"bot_key\":\"$PUB\"}")
STATUS=$(echo "$R" | json "['status']")
[ "$STATUS" = "ai" ] || { echo "FAIL: expected ai fallback, got $STATUS"; exit 1; }
C=$(echo "$R" | json "['conversation_id']")
curl -fsS -X POST "$BASE/widget/message" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$C\",\"text\":\"hello there\"}" > /dev/null
POLL=$(curl -fsS -X POST "$BASE/widget/poll" -H 'content-type: application/json' -d "{\"conversation_id\":\"$C\"}")
BOT_N=$(echo "$POLL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sum(1 for m in d['messages'] if m['sender']=='bot' and m['body']))")
[ "$BOT_N" -ge 1 ] || { echo "FAIL: no AI reply in fallback path"; exit 1; }

echo
echo "ALL PASSED"
