# BL Crusher Manager — Web App

The same app now runs two ways from one codebase:

| | Desktop (`.exe`) | Web app |
|---|---|---|
| Transport | Electron IPC (`window.api`) | `POST /api/call` over HTTPS |
| Data | SQLite in the user's AppData folder | SQLite in `BL_DB_DIR` on the server |
| Auth | Password prompt each launch | Password login + 30‑day session cookie |
| Build | `npm run build:win` | `npm run build:web` → `npm run start:web` |

All business logic (services, ledgers, schema, migrations) is shared — the web
server simply wraps the same handler map the desktop IPC bridge uses.

---

## What you get

- A small Node/Express server that serves the React UI **and** the API.
- Real server‑side authentication: the admin password is stored **hashed**
  (scrypt) and a login issues an HTTP‑only session cookie. Every API call is
  rejected with `401` unless it carries a valid session.
- One shared SQLite database, so all staff see the same data.
- Existing desktop databases are upgraded automatically the first time the
  server opens them (same migrations).

---

## Run it locally (smoke test)

```powershell
# 1. Build the renderer (static files) + the bundled server
npm run build:web

# 2. Start it (defaults: PORT=3000, data in ./data)
npm run start:web
```

Open <http://localhost:3000>, log in with the admin password
(default `admin123` — change it in **Settings**).

> **Native module note.** `better-sqlite3` is compiled for *Electron* on a dev
> machine (via the package `postinstall`). To run the server with plain Node
> locally you must rebuild it for Node first: `npm rebuild better-sqlite3`
> (then `npm run rebuild` to switch it back for the desktop app). On the
> server/Docker this is handled for you.

---

## Deploy to the cloud (recommended: Docker)

A `Dockerfile` is included. It installs dependencies, rebuilds `better-sqlite3`
for Node, builds the web bundle, and runs the server on port **3000**. The
SQLite database lives in `/data`, which **must be a persistent disk** so your
data survives redeploys.

### Option A — Render.com (uses the included `render.yaml`)

1. Push this project to a GitHub/GitLab repo.
2. In Render: **New → Blueprint**, point it at the repo. It reads `render.yaml`
   and creates a Docker web service with a 1 GB disk mounted at `/data`.
3. Deploy. Your app is at `https://<name>.onrender.com`.

### Option B — Railway / Fly.io / any Docker host

```bash
docker build -t bl-crusher-manager .
docker run -d -p 3000:3000 \
  -v bl_data:/data \
  -e SECURE_COOKIE=1 \
  --name bl-crusher bl-crusher-manager
```

- Railway: add a **Volume** mounted at `/data`.
- Fly.io: `fly volumes create bl_data` and mount it at `/data` in `fly.toml`.
- Put it behind the platform's HTTPS (all of the above terminate TLS for you).

### Option C — Your own VM (Ubuntu)

```bash
sudo apt-get install -y nodejs npm
git clone <your repo> && cd "BL Clushering Work Project"
npm ci --ignore-scripts && npm rebuild better-sqlite3
npm run build:web
BL_DB_DIR=/var/lib/bl-crusher SECURE_COOKIE=1 PORT=3000 npm run start:web
```

Run it under `pm2` or a `systemd` service, and put **nginx/Caddy in front for
HTTPS** (required — see security below).

---

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `HOST` | `0.0.0.0` | Bind address |
| `BL_DB_DIR` | `./data` | Folder holding `blcrusher.db` — **use a persistent disk** |
| `BL_STATIC_DIR` | `out/renderer` | Built UI to serve |
| `SECURE_COOKIE` | unset | Set to `1` in production so the session cookie is HTTPS‑only |

---

## Security checklist for internet access

- [ ] **Always serve over HTTPS** and set `SECURE_COOKIE=1`. The platforms above
      provide TLS automatically; on a bare VM use nginx/Caddy.
- [ ] **Change the admin password** immediately after first login
      (Settings → Change Password). It is stored hashed (scrypt).
- [ ] Keep regular **backups of `blcrusher.db`** from the data disk.
- [ ] The app currently has a single shared admin login. If you later need
      per‑user accounts and roles, that's a follow‑up change.
