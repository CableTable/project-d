# Usage on Firebase (Spark)

Static vanilla JS; no build, functions, npm dependencies or paid plan. Node 22+ runs the PC agent.

1. In the [Firebase console](https://console.firebase.google.com/), create a project on **Spark**, register a **Web app**, enable **Authentication → Google** (choose a support email), create the **default Firestore database in production mode**, and enable **Hosting** (classic Hosting, not App Hosting).
2. Paste the web identifiers into **`public/firebase-config.js` only**. Set the default project id in `.firebaserc` too. Leave `authDomain` as your project's `firebaseapp.com` domain and open the site on **`https://<id>.firebaseapp.com`** so mobile redirect sign-in uses the same domain ([Firebase redirect guidance](https://firebase.google.com/docs/auth/web/redirect-best-practices)). The web config is public; never paste a private key there.
3. From the repo root, deploy the site and the initially denying rules:

   ```powershell
   cd usage-site
   npx firebase-tools@15.30.2 login
   npx firebase-tools@15.30.2 deploy --only hosting,firestore:rules --project <id>
   ```

   Sign in on the site. Copy the UID from **“Not allowed. Your uid: …”** into the single `<HIS_UID>` line in `firestore.rules`, then repeat the deploy command. All other users are denied.
4. In **Project settings → Service accounts**, generate a private JSON key. Save it **outside this repo**, by default at **`%APPDATA%\ProjectD\firebase-key.json`** (create the ProjectD folder). Alternatively set the user environment variable `PROJECTD_FIREBASE_KEY` to an absolute external path, then sign out/in to Windows so Startup inherits it. The agent refuses keys located inside the repo, including junction targets. Service-account OAuth uses IAM and bypasses UID rules; the account needs **Cloud Datastore User** (`roles/datastore.user`). Protect the key like a password.
5. Supply `mockups/_design/usage/limits.csv` and `history.csv` on this PC; `runs.csv` and `analysis.json` are optional (missing files upload as empty). The existing `rook usage` command updates limits/history and requires your working Claude/claude2/Codex setup; it does not create runs or analysis. CSV headers:

   ```text
   limits:  agent,role,model,window,used_pct,cap_pct,starts,resets,as_of
   history: when,agent,window,used_pct
   runs:    id,session,date,agent,model,task,kind,total_tokens,new_tokens,verdict
   ```

   `analysis.json` is an array of `{ "id": "…", "topic": "…", "note": "…" }`. Times use ISO 8601 with an offset; a blank cap/token count stays blank. The data folder is absent in this checkout; bring your current files. History uploads retain the last 2,000 rows. Oversized documents fail without publishing a new last-update time; eventually large runs/analysis will need splitting.
6. Back at the repo root, run `node tools/usage-agent.mjs` once to check setup, then stop it with Ctrl+C. Run `powershell -ExecutionPolicy Bypass -File tools/usage-agent-install.ps1`; open **Project D usage agent.lnk** in your Startup folder now, or sign in to Windows again. It runs hidden, without admin. Uninstall with `powershell -ExecutionPolicy Bypass -File tools/usage-agent-install.ps1 -Uninstall`; this removes the shortcut, so stop an already running agent separately. Logs and PID lock live in `%APPDATA%\ProjectD` (log trimmed at 1 MB). Locks older than the current Windows boot, with a missing PID (ESRCH), or with a permission-denied PID probe (EPERM) are taken over automatically; a live PID from this boot still blocks a second agent.

A failed refresh is handled once per request; the next attempt waits for a new request or the hourly refresh. The error and its time appear under Last update and clear after a successful refresh. If Firestore cannot be reached to publish the error, it remains in the local log. The agent refreshes at startup/hourly, polls `control/refresh` every 10 seconds, and writes a heartbeat every 60 seconds. “Update now” waits for a server last-update timestamp newer than its request; after 60 seconds it says “PC didn't answer” (a slow refresh may finish later). A heartbeat older than three minutes shows “PC offline”. Keep the PC awake for updates; the last uploaded data remains readable while it is off. One agent uses about 8,640 poll reads and 1,440 heartbeat writes per day; other project traffic shares Spark quotas.

Every refresh also reads the repo-root `TODO.md` into `usage/todo`. The page lists every Markdown section in order, with completed items under “N done”; within a section, a completed entry replaces an open entry with the same number. Run `node usage-site/browser.test.mjs` from the repo root for the offline Firebase UI check and phone/desktop light/dark screenshots in `shots/`.

**Deploy authentication:** this service-account key can also authenticate the CLI through `$env:GOOGLE_APPLICATION_CREDENTIALS = "$env:APPDATA\ProjectD\firebase-key.json"`, if its IAM permissions include Hosting and Firestore rules deployment. Datastore User alone cannot deploy. Prefer running the `login` command above once yourself rather than granting the agent deployment permissions. [Firebase CLI authentication](https://firebase.google.com/docs/cli#use_the_cli_with_ci_systems) supports Application Default Credentials; [service-account Firestore access](https://firebase.google.com/docs/firestore/use-rest-api#authentication_and_authorization) is governed by IAM.
