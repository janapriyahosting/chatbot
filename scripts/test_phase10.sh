#!/usr/bin/env bash
# Phase 10: extended form types (date, radio, checkbox, file) + visitor upload.
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:8800}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@janapriyaupscale.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@12345}"

json() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

TOKEN=$(curl -fsS -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | json "['access_token']")
AH=(-H "authorization: Bearer $TOKEN")

SITE_ID=$(curl -fsS -X POST "$BASE/sites" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"P10\",\"domain\":\"p10-$(date +%s).example.com\"}" | json "['id']")
BOT=$(curl -fsS -X POST "$BASE/bots" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"P10\",\"channel\":\"web\",\"site_id\":\"$SITE_ID\"}")
BOT_ID=$(echo "$BOT" | json "['id']")
PUB=$(echo "$BOT" | json "['public_key']")

FLOW=$(curl -fsS -X POST "$BASE/bots/$BOT_ID/flows" "${AH[@]}" -H 'content-type: application/json' -d '{
  "name":"all types",
  "definition":{
    "start_node":"s",
    "nodes":[
      {"id":"s","type":"start"},
      {"id":"f","type":"form","config":{"fields":[
        {"name":"dob","type":"date","label":"DOB"},
        {"name":"pref","type":"radio","label":"Pref","options":[{"label":"A","value":"a"},{"label":"B","value":"b"}]},
        {"name":"agreed","type":"checkbox","label":"Agreed"},
        {"name":"doc","type":"file","label":"Doc","required":false}
      ]}},
      {"id":"t","type":"text","config":{"body":"Thanks {{answers.form.pref}}."}},
      {"id":"e","type":"end"}
    ],
    "edges":[{"source":"s","target":"f"},{"source":"f","target":"t"},{"source":"t","target":"e"}]
  }
}')
FLOW_ID=$(echo "$FLOW" | json "['id']")
curl -fsS -X POST "$BASE/bots/$BOT_ID/flows/$FLOW_ID/publish" "${AH[@]}" > /dev/null

echo "==> validation: bad radio, bad date, invalid checkbox -> 422"
R=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' -d "{\"bot_key\":\"$PUB\"}")
CONV=$(echo "$R" | json "['conversation_id']")
CODE=$(curl -s -o /tmp/p10err -w "%{http_code}" -X POST "$BASE/widget/reply" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV\",\"payload\":{\"values\":{\"dob\":\"nope\",\"pref\":\"z\",\"agreed\":\"maybe\",\"doc\":\"\"}}}")
[ "$CODE" = "422" ] || { echo "FAIL: expected 422, got $CODE"; exit 1; }
ERRS=$(python3 -c "import json; d=json.load(open('/tmp/p10err')); print(' '.join(sorted(d['detail']['field_errors'].keys())))")
echo "  errors: $ERRS"
echo "$ERRS" | grep -q "agreed" || { echo "FAIL: checkbox validation missing"; exit 1; }
echo "$ERRS" | grep -q "dob" || { echo "FAIL: date validation missing"; exit 1; }
echo "$ERRS" | grep -q "pref" || { echo "FAIL: radio validation missing"; exit 1; }

echo
echo "==> valid submission"
R=$(curl -fsS -X POST "$BASE/widget/reply" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV\",\"payload\":{\"values\":{\"dob\":\"1990-05-15\",\"pref\":\"a\",\"agreed\":\"true\",\"doc\":\"\"}}}")
BODY=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print([o['config'].get('body') for o in d['outputs'] if o['kind']=='text'][0])")
echo "  templated: $BODY"
echo "$BODY" | grep -q "Thanks a" || { echo "FAIL: pref not templated"; exit 1; }

echo
echo "==> visitor upload -> then submit a flow with file field"
R=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' -d "{\"bot_key\":\"$PUB\"}")
CONV2=$(echo "$R" | json "['conversation_id']")
tmp=$(mktemp --suffix=.png)
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xdc\xccY\xe7\x00\x00\x00\x00IEND\xaeB`\x82' > "$tmp"
UP_URL=$(curl -fsS -X POST "$BASE/widget/upload?conversation_id=$CONV2" -F "file=@$tmp;type=image/png" | json "['url']")
echo "  uploaded: $UP_URL"
[[ "$UP_URL" == /static/uploads/* ]] || { echo "FAIL: bad url"; exit 1; }
curl -fsS -X POST "$BASE/widget/reply" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV2\",\"payload\":{\"values\":{\"dob\":\"1990-05-15\",\"pref\":\"b\",\"agreed\":\"true\",\"doc\":\"$UP_URL\"}}}" > /dev/null
echo "  file field accepted ✓"

echo "==> visitor upload rejected for unknown conversation"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/widget/upload?conversation_id=00000000-0000-0000-0000-000000000000" -F "file=@$tmp;type=image/png")
[ "$CODE" = "404" ] || { echo "FAIL: expected 404, got $CODE"; exit 1; }

echo
echo "ALL PASSED"
