# Handling submissions from the public

For whoever looks after the CBEDS website. It assumes you can use Excel and
double-click a file, and nothing else.

There are two forms on the site that anyone can fill in. This explains what happens
when someone does, and what you do about it.

**The one rule worth remembering:** nothing a visitor sends reaches the website on
its own. It waits for you. The only way anything gets published is that you decide
to put it in `draft/CBEDSync.xlsx` yourself, and every tool here is built to keep it
that way.

---

## The two forms

| Form | Where it is | What it is for |
|------|-------------|----------------|
| **Share your work** | CBEDSense → *Put your work forward* | Someone offering an organisation, project or output for CBEDSync, or a post for CBEDSynergy |
| **CBEDS Alliance Charter** | CBEDSynergy → *Join the network* | An organisation signing the Charter |

Both ask for an email address, so you can always go back to whoever sent it.

---

## Setting it up (once, then never again)

### 1. Switch on the collecting

1. Go to **https://app.netlify.com/projects/cbeds/forms**
2. Check **form detection** is enabled — it is on that page, under *Usage and configuration*.
3. You should see two forms listed: **`cbeds-charter`** and **`cbedsense-submission`**.

If the list is empty, no deploy has gone out since detection was switched on. Publish
anything — even a small Excel change through `update-website.bat` — and look again.

### 2. Get an email when something arrives

On the same page, **Form notifications → add an email notification**, once for each of
the two forms, sent to whoever should know.

Do this **before** you test anything. Notifications are not retrospective, so if you
submit a test first you will get no email and it will look broken when it is not.

### 3. Give the collecting script a key

`get-submissions.bat` needs permission to read your own submissions back out of
Netlify.

1. Go to **https://app.netlify.com/user/applications** → **New access token**.
2. Copy it straight away — Netlify shows it once and never again.
3. Open the file called **`.env`** in the project folder (right-click → Open with →
   Notepad; Windows has no default app for it) and put the token after
   `NETLIFY_TOKEN=`, with no quotes and no spaces:

       NETLIFY_TOKEN=nfp_yourtokenhere

4. Save and close.

`.env` never leaves your computer — it is deliberately excluded from GitHub. Do not
paste that token into any other file, and if it ever goes astray, revoke it on the
same Netlify page and make a new one.

> If Notepad saves the file as `.env.txt`, the script will say it cannot find a
> token. In the Save dialog set **Save as type** to **All Files**.

---

## The routine

Four steps. Only the last one publishes anything.

### 1. Collect

Double-click **`get-submissions.bat`**.

It reads everything waiting on Netlify and writes **`draft/Submissions.xlsx`**. A good
run looks like this:

    project: cbeds
    forms  : cbeds-charter, cbedsense-submission
    OK  wrote Submissions.xlsx
        new=2  already staged=5

`new` is what it has just added; `already staged` is what was there before and was
left alone, notes and all. Run it as often as you like — it never adds the same
submission twice.

### 2. Read

Open `draft/Submissions.xlsx`. Each submission is one row, on the sheet it belongs to
— **Agent**, **Project**, **Output**, or **Posts** for something meant for the
CBEDSynergy feed rather than the graph.

The row is in two halves:

- **Columns A onwards are the master's columns**, in the master's order, with `Source`
  already saying `Public`.
- Then one **blank column**, and after it the green **`Review:`** columns — when it
  arrived, who sent it, their email, and for a Charter signature the named lead and
  the commitments they chose. Those are notes for you and are **not** part of
  CBEDSync.

`Review: Status` is yours. Write `approved`, `rejected`, or whatever suits you.

> **Red text means a suggestion, not a submission.** Where research has been done to
> fill in blanks — a location, a theme, a link to a related entity — it is written in
> red so you can tell at a glance what came from the person and what did not. Check
> red cells before approving; delete any you disagree with.

### 3. Approve

For each row you want on the site:

1. Select the master's columns of that row in `Submissions.xlsx` and copy. **The
   amber cell in row 1 tells you where they stop** — it reads something like
   `← copy A:BM only`. Do not work from a remembered letter: the range is however
   wide `CBEDSync.xlsx` currently is, so it moves whenever a column is added to or
   removed from the master.
2. Paste it as a new row at the bottom of the matching sheet in `draft/CBEDSync.xlsx`.
3. Do **not** copy the green `Review:` columns. Leaving them out is why there is a
   blank column between the two halves.

`Source` comes across already saying `Public`. That matters: it is what makes the
entry show a small **Contributed** badge on CBEDSync, and it is the only record of
where the entry came from. It cannot be worked out later.

To turn something down, delete it in Netlify. Nothing else happens.

### 4. Check, then publish

Double-click **`rebuild-only.bat`** first. It updates the site's data on your computer
and stops, so you can open the pages and look. It prints:

    OK  wrote cbedsync-data.js
        agents=429  projects=150  outputs=754  total=1333
        from public submissions=1

If you approved something and `from public submissions` is still `0`, the `Source`
cell is empty.

When you are happy, double-click **`update-website.bat`** to publish. The live site
catches up in about a minute.

---

## Charter signatures are a bit different

A signature produces **two** things:

1. **The organisation** becomes an Agent row like any other approved submission. The
   Charter promises members are listed on CBEDSync, and this is how that happens.
2. **The signature itself** — the named lead, the date, the commitments they chose —
   has nowhere to live on the Agent sheet. Keep it with whatever record the team holds
   of who has signed. It is in the green `Review:` columns for you to copy out.

---

## Things that will catch you out

**Never insert a column in the middle of the Agent, Project or Output sheets.** The
build finds each field by its position, not its heading. Insert a column and
everything to its right shifts by one — the build will run without complaining and
publish a graph where themes, technologies and links are all wrong. If you need a new
column, add it at the **far right**, past the last `LinksTo`.

**Do not put `Submissions.xlsx` on GitHub.** It holds people's names and email
addresses, and this repository is public. It is already excluded, so this only
matters if you go out of your way — but it is worth knowing why.

**Do not edit `cbedsync-data.js`.** It is generated from the Excel every time you run
either `.bat`, so anything typed into it is overwritten.

**Netlify's free plan includes a limited number of submissions a month** — around 100
at the time of writing. Check *Billing → Usage* for the current figure. Well above
what this site should see, but the ceiling exists.

**Spam.** Each form has a hidden trap field that bots fill in and people never see, and
Netlify filters the obvious. Some junk will still arrive. Delete it and move on.

---

## When something goes wrong

The scripts try to say what is actually wrong rather than just failing. The common
ones:

| What it says | What it means |
|---|---|
| `No NETLIFY_TOKEN found` | Step 3 above was skipped, or Notepad saved `.env.txt` |
| `Netlify refused the token` | The token is wrong or has been revoked — make a new one |
| `Could not find a Netlify project matching...` | It lists the projects your token can see; set `NETLIFY_SITE` in `.env` to one of them |
| `No CBEDS forms on cbeds` | Form detection is off, or no deploy has carried the forms yet |
| `Submissions.xlsx does not match the master's columns` | Delete `draft/Submissions.xlsx` and run again. It is rebuilt from Netlify, so the only thing lost is anything you typed into the `Review:` columns — copy that out first |
| `no "Source" column on ...` | A sheet is missing its `Source` heading. Add it at the far right |
| `names shared by more than one entry` | Not an error. Two entries share a name — usually a company and the product named after it. Worth knowing, because a link naming one of them reaches only the first |
| `Python was not found` | Python is not installed on this computer. See the setup section of `HOW-TO-HOST-AND-UPDATE.md` |

---

## The files involved

| File | What it does |
|------|--------------|
| `get-submissions.bat` | Collects submissions into `draft/Submissions.xlsx` |
| `rebuild-only.bat` | Rebuilds the site's data and stops, so you can check |
| `update-website.bat` | Rebuilds and publishes |
| `draft/CBEDSync.xlsx` | The master data. **This is the one that matters** |
| `draft/Submissions.xlsx` | The waiting room. Generated, never published, safe to delete |
| `.env` | Your Netlify token. Stays on your computer |

Hosting, the Excel itself and the AI answers are covered in
[`HOW-TO-HOST-AND-UPDATE.md`](HOW-TO-HOST-AND-UPDATE.md).
