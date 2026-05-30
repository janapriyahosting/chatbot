# Janapriya Chatbot

FastAPI backend + admin SPA + an embeddable website chat widget.

- `app/` — FastAPI service (API, models, flows, agent console backend)
- `admin/` — admin/agent console SPA (Vite + React), builds to `admin/dist/`
- `public/` — embeddable widget assets (`widget.js`, `widget.css`)
- `alembic/` — database migrations (Postgres, `chatbot` schema)
- `deploy/` — canonical systemd unit + nginx config
- `scripts/` — one-off operational scripts (seed admin, gen VAPID keys, etc.)

The service runs under systemd as **`chatbot-api`** (`uvicorn app.main:app` on `127.0.0.1:8800`, behind nginx).

---

## Source control & deploying changes

This repo lives at `git@github.com:janapriyahosting/chatbot.git` (private, default branch `main`).

**Auth — dedicated SSH deploy key via a host alias.** This server's default key (`~/.ssh/id_ed25519`) is already a deploy key on another repo, and a GitHub key can be a deploy key on only **one** repo. So the chatbot repo uses its **own** key, `~/.ssh/id_ed25519_chatbot`, selected through a `~/.ssh/config` host alias:

```
Host github-chatbot
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_chatbot
    IdentitiesOnly yes
```

The git remote therefore uses the alias, **not** plain `github.com`:

```
origin  git@github-chatbot:janapriyahosting/chatbot.git
```

With that in place, normal `git push` / `git pull` from this repo just work — no token stored.

To add or rotate the deploy key:

1. Show the public key: `awk '{print $1, $2}' ~/.ssh/id_ed25519_chatbot.pub` (the two-field `ssh-ed25519 …` line — **not** the `SHA256:` fingerprint).
2. On GitHub: **repo → Settings → Deploy keys → Add deploy key**, paste that line, and **tick "Allow write access"** (write access can't be toggled later — to change it you delete and re-add the key).
3. Verify: `ssh -T git@github-chatbot` should print *"Hi janapriyahosting/chatbot!"*.

**Secrets are gitignored** — `.env` is never committed (also `.venv/`, `admin/node_modules/`, `admin/dist/`, `public/uploads/`). Keep it that way; rotate any secret that lands in git history.

**Applying a change on the server** (`/home/narendhar/projects/chatbot`):

```bash
git pull

# if Python deps changed:
.venv/bin/pip install -r requirements.txt

# if there are new DB migrations:
.venv/bin/alembic upgrade head        # reads DATABASE_URL from .env via app settings

# if the admin SPA changed (output admin/dist/ is gitignored — built on the server):
cd admin && npm ci && npm run build && cd ..

# restart the API to pick up code changes:
sudo systemctl restart chatbot-api
```

`chatbot-api` is in the passwordless-sudo allowlist, so the restart needs no password. A schema-only change still requires running the migration; a code change requires the restart. After deploying, `systemctl is-active chatbot-api` and a quick `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8800/` (expect `200`) confirm it came back up cleanly.
