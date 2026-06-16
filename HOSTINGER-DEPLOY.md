# Deploy to Hostinger (Node.js hosting)

Hostinger runs Node apps under **Phusion Passenger** (no Docker). You upload a
**pre-built bundle** and Hostinger runs `npm install` + starts your app. This
avoids the repo's Electron `postinstall`, which would otherwise rebuild
`better-sqlite3` for the wrong runtime.

> Requires a plan with the **Node.js app** feature (Business / Cloud / VPS). If
> your plan has no "Setup Node.js App" option, you'll need a VPS — then use the
> `Dockerfile` / `WEB-DEPLOYMENT.md` path instead.

---

## Step 1 — Build the bundle (on your PC)

```powershell
npm run package:web
```

This creates a **`deploy/`** folder containing exactly what the server needs:

```
deploy/
  app.js              <- Passenger startup file
  package.json        <- only express, cookie, better-sqlite3 (no Electron)
  dist-server/        <- the bundled server
  out/renderer/       <- the built UI
```

Zip the **contents** of `deploy/` (so `app.js` is at the top of the zip), e.g.
select all inside `deploy/` → Send to → Compressed (zip) folder.

---

## Step 2 — Create the Node.js app in hPanel

hPanel → your website → **Advanced → Node.js** (a.k.a. *Setup Node.js App*):

| Field | Value |
|---|---|
| **Node.js version** | 20 (or 18) — an LTS with `better-sqlite3` prebuilts |
| **Application mode** | Production |
| **Application root** | a folder, e.g. `blcrusher` (note its full path) |
| **Application URL** | your domain or a subdomain |
| **Application startup file** | `app.js` |

Create it.

---

## Step 3 — Upload the files

In **File Manager**, open the Application root you chose, upload your zip, and
**Extract** it there. `app.js`, `package.json`, `dist-server/`, and
`out/renderer/` must sit **directly** in the Application root.

---

## Step 4 — Environment variables

In the Node.js app panel, add:

The app stores its data in your **Hostinger MySQL database** (create one in
hPanel → Databases → MySQL, then set these). All five DB vars are required:

| Variable | Value | Why |
|---|---|---|
| `DB_HOST` | `localhost` | MySQL runs on the same host as the app |
| `DB_PORT` | `3306` | default MySQL port |
| `DB_USER` | your MySQL username (e.g. `u728987841_blcrusher_data`) | |
| `DB_PASSWORD` | your MySQL password | |
| `DB_NAME` | your MySQL database name (e.g. `u728987841_blcrusher_data`) | |
| `SECURE_COOKIE` | `1` | Hostinger serves HTTPS — keeps the session cookie TLS-only |

On first start the app **creates all its tables automatically** in that database
(and re-checks them on every deploy), then seeds the `admin` user. No SQL import
or `BL_DB_DIR` needed — MySQL is managed and persistent.

Make sure **SSL is enabled** for the domain (hPanel → Security → SSL).

---

## Step 5 — Install & start

1. In the Node.js app panel click **Run NPM Install** (installs `express`,
   `cookie`, `mysql2` — all pure JavaScript, so no compiler/native build).
2. Click **Start** (or **Restart**). On first start it creates the tables in
   your MySQL database automatically.
3. Open your domain. Log in with **`admin` / `admin123`** and immediately change
   the password (sidebar → Change password).

---

## Updating later

1. `npm run package:web` on your PC again.
2. Re-upload `dist-server/` and `out/renderer/` (and `package.json` if deps
   changed). Your MySQL data is untouched, and any new schema is applied
   automatically on restart.
3. **Run NPM Install** only if `package.json` changed, then **Restart**.

---

## Troubleshooting

- **`npm install` fails on better-sqlite3** — switch the app to Node 20 or 18
  (those have prebuilt binaries) and reinstall.
- **502 / "Passenger" error page** — the app crashed on start. Open the Node app
  **logs** in hPanel; usually a missing `npm install` or wrong startup file.
- **Login works but drops on refresh / "session expired"** — `SECURE_COOKIE=1`
  with no HTTPS. Enable SSL, or temporarily unset `SECURE_COOKIE` to test.
- **Blank page** — confirm `out/renderer/index.html` exists in the app root and
  the startup file is `app.js`.

## Back up your data

Periodically download `blcrusher.db` from your `BL_DB_DIR` folder (File Manager
→ Download). That single file is your entire database.
