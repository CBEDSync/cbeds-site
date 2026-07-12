# CBEDS website — hosting & updating

Your site is a set of static pages (`cbeds.html` — the homepage — and the CBEDSense / CBEDSync / CBEDSynergy / CBEDStory pages). `index.html` is a tiny redirect that sends the site root to `cbeds.html`. The network diagram reads its data from **`cbedsync-data.js`**, which is generated from **`draft/CBEDSync.xlsx`** by the script **`build.py`**.

So the flow is:

    Edit CBEDSync.xlsx  →  run build.py  →  cbedsync-data.js updates  →  site shows new data

`update-website.bat` (Windows) / `update-website.command` (Mac) does the last two steps in one double-click, and also pushes the change to the live site.

---

## One-time setup (about 15 minutes)

You only do this once. After that, updating is a single double-click.

### 1. Install the tools (once per computer)
- **Python** — https://www.python.org/downloads/ (on Windows, tick "Add Python to PATH" during install).
- **Git** — https://git-scm.com/downloads
- Then open a terminal / Command Prompt in this folder and run: `pip install openpyxl`

### 2. Put the site in a GitHub repo
1. Create a free account at https://github.com and click **New repository** (name it e.g. `cbeds-site`, keep it Public or Private — both work).
2. In this folder, open a terminal / Command Prompt and run:

       git init
       git add .
       git commit -m "CBEDS site"
       git branch -M main
       git remote add origin https://github.com/<your-username>/cbeds-site.git
       git push -u origin main

   (GitHub shows you the exact `remote add` line after creating the repo.)

### 3. Connect the repo to a free host
Pick either — both auto-deploy every time you push:

**Netlify**
1. https://app.netlify.com → **Add new site → Import an existing project → GitHub**.
2. Choose your `cbeds-site` repo. Leave build command blank, publish directory `/`. Deploy.
3. You get a URL like `cbeds.netlify.app` (rename it in Site settings).

**Cloudflare Pages**
1. https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**.
2. Choose the repo, leave build settings empty, Save and Deploy.

A custom domain (including a `ucl.ac.uk` subdomain, if IT gives you a CNAME record) can be added later in either dashboard.

---

## Updating the site (every time — one step)

1. Edit `draft/CBEDSync.xlsx` and save it.
2. Double-click **`update-website.bat`** (Windows) or **`update-website.command`** (Mac).

That rebuilds the data and pushes it. The live site refreshes in about a minute. Done.

> New rows appear automatically — the only rule is that an entry needs a **name** in the first column of its sheet (Agent / Project / Output). Empty-name rows are ignored.

---

## Working with Khalid

Both of you can update the site. Each person does the one-time setup steps 1 and (a shared) 2–3 once, then:

- Before editing, run `git pull` (or just re-clone) to get the latest.
- After editing, run the update script as above.

If you'd rather not both touch git, the simplest arrangement is: whoever owns the master Excel runs the update script, and the other sends changes to them.

---

## Files in this project

| File | What it is |
|------|-----------|
| `cbeds.html` (homepage), `cbedsense.html`, `cbedsync.html`, `cbedsynergy.html`, `cbedstory.html` | the website pages |
| `index.html` | a small redirect to `cbeds.html` so the site root loads |
| `cbedsync-data.js` | the data the site reads — **generated, don't edit by hand** |
| `draft/CBEDSync.xlsx` | the master data — **edit this** |
| `build.py` | converts the Excel into `cbedsync-data.js` |
| `update-website.bat` / `.command` | one-click: rebuild + publish |
| `cbedsync-data.backup.js` | a backup of the previous data file |
| `Slide1-3.JPG`, `favicon.svg` | site images |

## If something looks wrong
- Ran the script but no change on the si