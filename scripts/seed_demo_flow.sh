#!/usr/bin/env bash
# Create a realistic demo flow and print the bot public_key for the widget.
set -euo pipefail
BASE="${BASE:-http://127.0.0.1:8800}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@janapriyaupscale.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@12345}"

json() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }

TOKEN=$(curl -fsS -X POST "$BASE/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | json "['access_token']")
AUTH_H=(-H "authorization: Bearer $TOKEN")

DOMAIN="demo-$(date +%s).example.com"

SITE_ID=$(curl -fsS -X POST "$BASE/sites" "${AUTH_H[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"Demo Site\",\"domain\":\"$DOMAIN\"}" | json "['id']")

BOT=$(curl -fsS -X POST "$BASE/bots" "${AUTH_H[@]}" -H 'content-type: application/json' \
  -d "{\"name\":\"Homepage Bot\",\"channel\":\"web\",\"site_id\":\"$SITE_ID\"}")
BOT_ID=$(echo "$BOT" | json "['id']")
PUBLIC_KEY=$(echo "$BOT" | json "['public_key']")

curl -fsS -X POST "$BASE/bots/$BOT_ID/flows" "${AUTH_H[@]}" -H 'content-type: application/json' -d '{
  "name":"Demo lead flow",
  "definition":{
    "start_node":"start",
    "nodes":[
      {"id":"start","type":"start"},
      {"id":"greet","type":"text","config":{"body":"Hi! 👋 Welcome to Janapriya Upscale."}},
      {"id":"banner","type":"image","config":{"url":"https://picsum.photos/seed/ju/400/220","caption":"Our latest project"}},
      {"id":"pick","type":"buttons","config":{"body":"What are you here for?","options":[
        {"label":"Buy a home","value":"buy"},
        {"label":"Investor enquiry","value":"invest"},
        {"label":"Just browsing","value":"browse"}
      ]}},
      {"id":"carousel_buy","type":"carousel","config":{"cards":[
        {"title":"2BHK · Kompally","subtitle":"Starts at ₹65L","image":"https://picsum.photos/seed/k2/220/140"},
        {"title":"3BHK · Tellapur","subtitle":"Starts at ₹1.1Cr","image":"https://picsum.photos/seed/t3/220/140"},
        {"title":"Plot · Maheshwaram","subtitle":"From ₹40L","image":"https://picsum.photos/seed/mh/220/140"}
      ]}},
      {"id":"form","type":"form","config":{"intro":"Leave your details, we will call you:","fields":[
        {"name":"name","label":"Full name"},
        {"name":"phone","label":"Phone"},
        {"name":"email","label":"Email (optional)"}
      ]}},
      {"id":"ping","type":"api","config":{
        "url":"https://httpbin.org/post","method":"POST",
        "body":{"hook":"lead_captured","name":"{{answers.form.name}}","phone":"{{answers.form.phone}}"},
        "save_as":"crm_ack"
      }},
      {"id":"thanks","type":"text","config":{"body":"Thanks {{answers.form.name}}! Our team will reach out shortly."}},
      {"id":"end","type":"end"}
    ],
    "edges":[
      {"source":"start","target":"greet"},
      {"source":"greet","target":"banner"},
      {"source":"banner","target":"pick"},
      {"source":"pick","target":"carousel_buy","condition":"buy"},
      {"source":"pick","target":"form","condition":"invest"},
      {"source":"pick","target":"form","condition":"browse"},
      {"source":"carousel_buy","target":"form"},
      {"source":"form","target":"ping"},
      {"source":"ping","target":"thanks"},
      {"source":"thanks","target":"end"}
    ]
  }
}' > /dev/null

# Publish so the runtime serves it preferentially
FLOW_ID=$(curl -fsS "$BASE/bots/$BOT_ID/flows" "${AUTH_H[@]}" | json "[0]['id']")
curl -fsS -X POST "$BASE/bots/$BOT_ID/flows/$FLOW_ID/publish" "${AUTH_H[@]}" > /dev/null

echo "bot_id=$BOT_ID"
echo "public_key=$PUBLIC_KEY"
echo
echo "Embed in any HTML page:"
echo '  <script src="'"$BASE"'/static/widget.js" data-bot-id="'"$PUBLIC_KEY"'" data-api="'"$BASE"'"></script>'
echo
echo "Or open the demo page:"
echo "  $BASE/static/demo.html?utm_source=test&utm_campaign=phase2"
echo "  (edit /home/ChatBot/projects/chatbot/public/demo.html: replace __BOT_KEY__ with $PUBLIC_KEY)"
