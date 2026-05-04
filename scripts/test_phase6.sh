#!/usr/bin/env bash
# Phase 6: condition branching, upload round-trip, validation warnings, preview.
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:8800}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@janapriyaupscale.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@12345}"

json() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

TOKEN=$(curl -fsS -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | json "['access_token']")
AH=(-H "authorization: Bearer $TOKEN")

SITE=$(curl -fsS -X POST "$BASE/sites" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"P6\",\"domain\":\"p6-$(date +%s).example.com\"}")
SITE_ID=$(echo "$SITE" | json "['id']")
BOT=$(curl -fsS -X POST "$BASE/bots" "${AH[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"P6 Bot\",\"channel\":\"web\",\"site_id\":\"$SITE_ID\"}")
BOT_ID=$(echo "$BOT" | json "['id']")
PUB=$(echo "$BOT" | json "['public_key']")

echo "==> 1) upload a small image"
tmp=$(mktemp --suffix=.png)
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xdc\xccY\xe7\x00\x00\x00\x00IEND\xaeB`\x82' > "$tmp"
UP=$(curl -fsS -X POST "$BASE/uploads" "${AH[@]}" -F "file=@$tmp;type=image/png")
UP_URL=$(echo "$UP" | json "['url']")
echo "uploaded: $UP_URL"
[[ "$UP_URL" == /static/uploads/* ]] || { echo "FAIL: bad upload URL"; exit 1; }
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$UP_URL")
[ "$STATUS" = "200" ] || { echo "FAIL: uploaded file not served back ($STATUS)"; exit 1; }
echo "served at $UP_URL -> 200"

echo "==> 2) condition flow: age branch"
FLOW=$(curl -fsS -X POST "$BASE/bots/$BOT_ID/flows" "${AH[@]}" -H 'content-type: application/json' -d '{
  "name":"age condition",
  "definition":{
    "start_node":"s",
    "nodes":[
      {"id":"s","type":"start"},
      {"id":"f","type":"form","config":{"fields":[{"name":"age"}]}},
      {"id":"c","type":"condition","config":{"expression":"answers.form.age >= 18"}},
      {"id":"adult","type":"text","config":{"body":"Welcome, you can proceed."}},
      {"id":"minor","type":"text","config":{"body":"Sorry, adults only."}},
      {"id":"e","type":"end"}
    ],
    "edges":[
      {"source":"s","target":"f"},
      {"source":"f","target":"c"},
      {"source":"c","target":"adult","condition":"true"},
      {"source":"c","target":"minor","condition":"false"},
      {"source":"adult","target":"e"},
      {"source":"minor","target":"e"}
    ]
  }
}')
FLOW_ID=$(echo "$FLOW" | json "['id']")
WARNINGS=$(echo "$FLOW" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('warnings',[])))")
echo "create returned warnings=$WARNINGS"
curl -fsS -X POST "$BASE/bots/$BOT_ID/flows/$FLOW_ID/publish" "${AH[@]}" > /dev/null

echo "==> adult path"
R=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' -d "{\"bot_key\":\"$PUB\"}")
CONV=$(echo "$R" | json "['conversation_id']")
R=$(curl -fsS -X POST "$BASE/widget/reply" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV\",\"payload\":{\"values\":{\"age\":\"25\"}}}")
BODY=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(' | '.join(o['config'].get('body','') for o in d['outputs']))")
echo "  adult: $BODY"
echo "$BODY" | grep -q "proceed" || { echo "FAIL: adult branch not taken"; exit 1; }

echo "==> minor path"
R=$(curl -fsS -X POST "$BASE/widget/session" -H 'content-type: application/json' -d "{\"bot_key\":\"$PUB\"}")
CONV=$(echo "$R" | json "['conversation_id']")
R=$(curl -fsS -X POST "$BASE/widget/reply" -H 'content-type: application/json' \
  -d "{\"conversation_id\":\"$CONV\",\"payload\":{\"values\":{\"age\":\"12\"}}}")
BODY=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(' | '.join(o['config'].get('body','') for o in d['outputs']))")
echo "  minor: $BODY"
echo "$BODY" | grep -q "adults only" || { echo "FAIL: minor branch not taken"; exit 1; }

echo "==> 3) validation warnings for broken flow"
BAD=$(curl -s -X POST "$BASE/bots/$BOT_ID/flows" "${AH[@]}" -H 'content-type: application/json' -d '{
  "name":"orphan",
  "definition":{
    "start_node":"s",
    "nodes":[
      {"id":"s","type":"start"},
      {"id":"lonely","type":"text","config":{"body":"unreachable"}},
      {"id":"c","type":"condition","config":{"expression":""}},
      {"id":"e","type":"end"}
    ],
    "edges":[
      {"source":"s","target":"c"}
    ]
  }
}')
echo "$BAD" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ws=d.get('warnings',[])
print('warnings returned:', len(ws))
for w in ws: print(' -', w)
assert any('unreachable' in w for w in ws), 'expected unreachable warning'
assert any('condition' in w for w in ws), 'expected condition warning'
print('warnings-ok')
"

echo "==> 4) preview endpoint (no persistence)"
PREV=$(curl -fsS -X POST "$BASE/bots/$BOT_ID/flows/preview" "${AH[@]}" -H 'content-type: application/json' -d '{
  "definition":{
    "start_node":"s",
    "nodes":[
      {"id":"s","type":"start"},
      {"id":"hi","type":"text","config":{"body":"preview hi"}},
      {"id":"e","type":"end"}
    ],
    "edges":[
      {"source":"s","target":"hi"},
      {"source":"hi","target":"e"}
    ]
  }
}')
echo "$PREV" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d['ended'] is True, 'expected ended'
assert any(o['config'].get('body')=='preview hi' for o in d['outputs']), 'missing text'
print('preview-ok')
"

echo
echo "ALL PASSED"
