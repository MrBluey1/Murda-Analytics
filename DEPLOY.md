# GitHub snapshot setup (free)

What this does: GitHub Actions runs `scripts/collect.js` on a schedule, saves JSON snapshots, and publishes them with GitHub Pages. Your website reads them when the local server (`node server.js`) is not running. The local server stays the primary, live source.

## One-time setup (Windows)
1. Install Git from git-scm.com and create a free GitHub account.
2. On github.com click New repository. Name it (e.g. `sports-data`), choose **Public** (free accounts can only use Pages from public repos), do NOT add a README, click Create.
3. In PowerShell, `cd` into your project folder, then run (replace USER and REPO):
   ```
   git init -b main
   git add .
   git commit -m "sports data pipeline"
   git remote add origin https://github.com/USER/REPO.git
   git push -u origin main
   ```
   `.gitignore` keeps `edge-analytics.html` out of the repo. Only the data pipeline is uploaded.
4. Repo → Settings → Pages → Build and deployment → Source: **GitHub Actions**.
5. Repo → Settings → Actions → General → Workflow permissions → **Read and write permissions** → Save.
6. Repo → Actions tab → `collect-sports-data` → Run workflow → mode `full` → Run.
   The "Restore previous data" step will show a warning on the very first run. That is expected.
7. When it is green, open `https://USER.github.io/REPO/manifest.json`. You should see JSON with `generatedAt`.
8. Open your site once as `http://localhost:8787/?data=https://USER.github.io/REPO` (or open the HTML file with the same `?data=` ending). The address is remembered.

## Choosing players
Edit `config/tracked.json` on GitHub (pencil icon) and commit. That triggers a full collection. Only listed players have game logs in snapshot mode.

## Keep it alive
GitHub disables scheduled workflows after 60 days with no repository activity, silently. If snapshots stop updating, check the Actions tab and re-enable the workflow, or push any small commit.
