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

> ⚠️ **Rows are safe, columns are not.** `build.py` finds each field by its **position**, not by its heading — so never insert or delete a column in the middle of the Agent, Project or Output sheets. Doing so shifts everything to its right by one, and the build will run without complaining while writing a graph in which themes, technologies and links are all misread. If you need a new column, **add it at the far right end** of the sheet, past the last `LinksTo` column. Anything out there is ignored unless `build.py` is told about it.

---

## Working with Khalid

Both of you can update the site. Each person does the one-time setup steps 1 and (a shared) 2–3 once, then:

- Before editing, run `git pull` (or just re-clone) to get the latest.
- After editing, run the update script as above.

If you'd rather not both touch git, the simplest arrangement is: whoever owns the master Excel runs the update script, and the other sends changes to them.

---

## Turning on AI-written answers (optional, one-time)

"Ask the graph" on the CBEDSync page works with no setup — it writes answers from
the graph itself. Adding a key makes an AI write a short note under each section
heading, explaining what the listed facts mean.

**The key must never go in the website files.** Anything in an `.html` or `.js` file
is public — visitors can read it, and it ends up in the GitHub repo. Instead the key
lives in Netlify's settings, where only the site's own server code can see it.

### The free option (recommended to start)

1. Get a Google Gemini API key at https://aistudio.google.com/apikey — **free, no
   credit card**. Around 250 questions a day, which is well beyond this site's
   traffic.
2. In Netlify: **Site configuration → Environment variables → Add a variable**.
   - Key: `GEMINI_API_KEY`
   - Value: paste the key
   - Deploy contexts: **All deploy contexts**
3. **Deploys → Trigger deploy → Deploy site.** Environment variables are only read
   at deploy time, so this step is required.

Then ask a question on the CBEDSync page. The answer appears instantly, and a
second or two later each section gains a short paragraph with a **green line beside
it**, ending with "Section notes written by AI from the data shown".

> Note: on Google's free tier, what gets sent may be used to improve their models.
> The graph is already published on this website, so there is little exposure — but
> if that matters to you, use the paid option below instead.

### The paid option (better writing)

Claude writes noticeably better prose. It costs roughly 2–3p per question.

1. Create a key at https://console.anthropic.com → **API keys**, and set a monthly
   spend limit while you are there (**Settings → Limits**). API usage is billed
   separately from any Claude Pro subscription — a subscription does not cover it.
2. Add **two** Netlify environment variables:
   - `ANTHROPIC_API_KEY` — the key
   - `LLM_PROVIDER` — `claude`
3. Trigger a deploy.

### If nothing seems to happen

The page always falls back to the built-in answers, so a missing key or a failed
call looks like nothing happened rather than an error. To see why: Netlify →
**Logs** → **Functions** → `ask`. A line starting `ask failed:` shows the cause.

Repeat questions are cached, so asking the same thing twice costs nothing.

---

## Submissions from the public

Two forms on the site collect things from outside the team:

| Form | Where | What it collects |
|------|-------|------------------|
| **Share your work** | CBEDSense, "Put your work forward" | a candidate Agent / Project / Output for CBEDSync, or a post for CBEDSynergy |
| **CBEDS Alliance Charter** | CBEDSynergy, "Join the network" | an organisation signing the Charter: organisation, named lead, date, and which commitments they chose |

Nothing a visitor sends goes near the website or the Excel on its own. **You read it first, and only what you approve gets typed into `draft/CBEDSync.xlsx`.** That is the point of the setup: the workbook stays the single source of truth and nothing appears on the site that a person has not agreed to.

### Turning it on (once)

Netlify collects the submissions — there is nothing to install and no extra account.

1. Netlify → **Site configuration → Forms**. Make sure form detection is **enabled**. After the next deploy the two forms appear by name: `cbedsense-submission` and `cbeds-charter`.
2. Netlify → **Forms → Form notifications → Add notification → Email notification**. Add whoever should hear about new submissions, and do it once per form. Without this, submissions still arrive — you just have to remember to go and look.

> Form detection reads the deployed pages, so a form only appears in the list **after a deploy that contains it**, and only once at least one submission has arrived does the list show anything under it.

### The `Source` column

Each of the Agent, Project and Output sheets has a **`Source`** column — currently `BM` on all three. It records where an entry came from:

| Value | Meaning |
|-------|---------|
| *(blank)* | the team added it — this is nearly every row, and there is nothing to backfill |
| `Public` | it arrived through a form on the website and was approved |

Fill it in **at the moment you approve a submission**. It cannot be reconstructed later: once a row is in the workbook unmarked, there is no way to tell afterwards where it came from.

Entries marked `Public` show a small **Contributed** badge on the CBEDSync page, in the entity panel and in the full knowledge graph. Leaving the cell blank simply means no badge.

> This one column is found by its **heading**, not its position — unlike every other field on the sheet. So you can move it, and the three sheets do not have to agree on where it sits; keep the heading spelled `Source` and the build will find it. If it cannot, the update script says so instead of quietly recording nothing.

### Reading and approving

1. An email arrives with the submission in it. Nothing is public at this stage.
2. To see them all: Netlify → **Forms** → pick the form. Each submission is one row, and **Download as CSV** on that page gives you the lot in a spreadsheet.
3. If you want it on the site, open `draft/CBEDSync.xlsx` and add it as a row on the matching sheet — **Agent**, **Project** or **Output** — and put `Public` in that row's **`Source`** cell. Then double-click `update-website.bat`. That is the same update you already do; a submission is just a new row like any other.
4. Check the script's last line: it prints `from public submissions=N`. If you approved one today and it still says 0, the `Source` cell is empty.
5. If you do not want it, delete it in Netlify. Nothing else happens.
6. Charter signatures are **not** CBEDSync entities and do not go on the Agent/Project/Output sheets. They are a record of who has signed; keep them wherever the team keeps that list.

Spam is filtered automatically, and each form carries a hidden trap field that bots fill in and people cannot see. Some junk will still get through — delete it and move on.

> **On the free plan Netlify includes a limited number of form submissions per month** (around 100 at the time of writing — check *Billing → Usage* for the current figure). Well above what this site should see, but worth knowing the ceiling exists.

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
| `netlify/functions/ask.mjs` | server code for AI answers — holds no key, reads it from Netlify |
| `netlify.toml`, `package.json`, `package-lock.json` | settings so Netlify can run that server code |

## If something looks wrong
- Ran the script but no change on the si