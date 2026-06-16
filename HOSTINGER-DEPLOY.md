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

| Variable | Value | Why |
|---|---|---|
| `SECURE_COOKIE` | `1` | Hostinger serves HTTPS — keeps the session cookie TLS-only |
| `BL_DB_DIR` | an absolute path **outside** the app root, e.g. `/home/uXXXXXXXX/blcrusher-data` | so re-uploading the app never overwrites your database |

Create that `blcrusher-data` folder in File Manager first. (If you skip
`BL_DB_DIR`, the database goes to `<app root>/data` — that works too, just don't
delete it when you update the app.)

Make sure **SSL is enabled** for the domain (hPanel → Security → SSL).

---

## Step 5 — Install & start

1. In the Node.js app panel click **Run NPM Install** (installs the 3 runtime
   deps; `better-sqlite3` downloads a prebuilt Node binary — no compiler needed).
2. Click **Start** (or **Restart**).
3. Open your domain. Log in with the default password **`admin123`** and
   immediately change it in **Settings → Change Password**.

---

## Updating later

1. `npm run package:web` on your PC again.
2. Re-upload `dist-server/` and `out/renderer/` (and `package.json` if deps
   changed). Your `BL_DB_DIR` data is untouched.
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
