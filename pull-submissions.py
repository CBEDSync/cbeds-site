#!/usr/bin/env python3
"""
CBEDS submission puller.

Fetches form submissions from Netlify and stages them in draft/Submissions.xlsx,
where they can be checked before anything is copied into the master workbook.

Run it:  python pull-submissions.py
Or double-click  get-submissions.bat

WHY A SEPARATE FILE
-------------------
draft/CBEDSync.xlsx holds formulas, three sets of cell comments with their legacy
drawings, and dozens of conditional-formatting rules. openpyxl cannot open and
re-save that without risking some of it. So this script only ever *reads* the
master - to copy its column layout - and only ever *writes* Submissions.xlsx, a
plain file it made itself, which is safe to rewrite every run.

HOW THE COLUMNS STAY IN STEP
----------------------------
The staging sheets are not a hardcoded copy of the master's columns. Each run
reads row 1 of Agent / Project / Output out of CBEDSync.xlsx and rebuilds the
staging headers from it, so the two can never drift. Columns A..<last> match the
master exactly: select that range on a staged row, copy, and paste it straight
into the master as a new row. One blank gutter column follows, then the review
columns, which are not part of the master and are never copied across.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

try:
    import openpyxl
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
except ImportError:
    sys.exit("openpyxl is not installed. Run:  pip install openpyxl")

HERE = Path(__file__).resolve().parent
MASTER = HERE / "draft" / "CBEDSync.xlsx"
STAGING = HERE / "draft" / "Submissions.xlsx"
API = "https://api.netlify.com/api/v1"

SHEETS = ("Agent", "Project", "Output")
SOURCE_HEAD = "Source"

# A "post to the CBEDSynergy network" is not a CBEDSync entity and has no sheet in
# the master, so it gets a small one of its own and is never copied across.
POST_COLS = ["Post", "Description", "Webpage"]

# Columns the reviewer works in. They sit past a blank gutter so that the master's
# own columns can be copied across in one block without dragging these along.
REVIEW = [
    "Review: Status",          # blank / approved / rejected - yours to fill in
    "Review: Notes",
    "Review: Submitted",       # when it arrived
    "Review: Submitted by",
    "Review: Email",
    "Review: Named lead",      # Charter only
    "Review: Commitments",     # Charter only
    "Review: Form",
    "Review: Netlify id",      # how a submission is recognised as already staged
]
ID_COL = "Review: Netlify id"

# Which submission field goes under which *heading* in the master. Headings rather
# than positions, so this survives the sheet being rearranged.
FIELD_TO_HEAD = {
    "desc": "Description",
    "link": "Webpage",
}
TECH_HEADS = ["Technology 1", "Technology2", "Technology 3",
              "Technology 4", "Technology 5", "Technology 6"]


def env(name, default=None):
    """Read a variable from the environment or from .env next to this script."""
    if os.environ.get(name):
        return os.environ[name]
    envfile = HERE / ".env"
    if envfile.exists():
        for line in envfile.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == name:
                return v.strip().strip('"').strip("'")
    return default


def api(path, token):
    req = urllib.request.Request(API + path,
                                 headers={"Authorization": "Bearer " + token,
                                          "User-Agent": "cbeds-site"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            sys.exit("Netlify refused the token (HTTP %d).\n"
                     "Check NETLIFY_TOKEN in .env - it needs to be a personal "
                     "access token from https://app.netlify.com/user/applications"
                     % e.code)
        if e.code == 404:
            sys.exit("Netlify has no such project (HTTP 404).\n"
                     "Check NETLIFY_SITE in .env. It should be the full domain, "
                     "e.g. cbeds.netlify.app")
        sys.exit("Netlify returned HTTP %d for %s" % (e.code, path))
    except urllib.error.URLError as e:
        sys.exit("Could not reach Netlify: %s" % e.reason)


def resolve_site(want, token):
    """Find the project, whether NETLIFY_SITE is its domain, its name or its API id.

    The API wants its own site id, but nobody has that to hand - what people know is
    the address the site answers on. So ask for the list and match against every name
    it might be known by, and if nothing matches say which projects the token can see
    rather than a bare 404."""
    sites = api("/sites", token)
    want = (want or "").strip().lower().rstrip("/")
    bare = want.replace("https://", "").replace("http://", "")
    for s in sites:
        known = {str(s.get(k) or "").lower().replace("https://", "").rstrip("/")
                 for k in ("id", "site_id", "name", "url", "ssl_url",
                           "default_domain", "custom_domain")}
        known.discard("")
        if bare in known or want in known or bare.split(".")[0] == str(s.get("name", "")).lower():
            return s["id"], (s.get("name") or bare)
    names = ", ".join(sorted(str(s.get("name")) for s in sites)) or "(none)"
    sys.exit('Could not find a Netlify project matching "%s".\n'
             "This token can see: %s\n"
             "Set NETLIFY_SITE in .env to one of those names." % (want, names))


def master_headers():
    """Row 1 of each master sheet, so the staging file mirrors it exactly."""
    if not MASTER.exists():
        sys.exit("Cannot find the master workbook: %s" % MASTER)
    wb = openpyxl.load_workbook(MASTER, read_only=True, data_only=True)
    heads = {}
    for name in SHEETS:
        row = next(wb[name].iter_rows(min_row=1, max_row=1, values_only=True))
        cells = ["" if v is None else str(v).strip() for v in row]
        while cells and not cells[-1]:          # drop trailing blanks
            cells.pop()
        heads[name] = cells
    wb.close()
    heads["Posts"] = list(POST_COLS)
    return heads


def head_index(heads, name):
    """Index of a heading, case-insensitively, or None."""
    for i, h in enumerate(heads):
        if h.lower() == name.lower():
            return i
    return None


def new_book(heads):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name in SHEETS + ("Posts",):
        write_header(wb.create_sheet(name), heads[name])
    return wb


def write_header(ws, cols):
    """Master columns, a blank gutter, then the review columns."""
    grey = PatternFill("solid", fgColor="EFF4F5")
    green = PatternFill("solid", fgColor="E4F0EE")
    for i, h in enumerate(cols, start=1):
        c = ws.cell(row=1, column=i, value=h)
        c.font = Font(bold=True)
        c.fill = grey
    start = len(cols) + 2                        # +2 leaves one empty gutter column
    for j, h in enumerate(REVIEW):
        c = ws.cell(row=1, column=start + j, value=h)
        c.font = Font(bold=True)
        c.fill = green
        c.alignment = Alignment(wrap_text=True)
        ws.column_dimensions[get_column_letter(start + j)].width = 18
    ws.freeze_panes = "A2"


def review_index(ws, name):
    for c in range(1, ws.max_column + 1):
        if str(ws.cell(row=1, column=c).value or "").strip() == name:
            return c
    return None


def staged_ids(wb):
    """Every Netlify id already in the file, so nothing is staged twice."""
    seen = set()
    for ws in wb.worksheets:
        col = review_index(ws, ID_COL)
        if not col:
            continue
        for r in range(2, ws.max_row + 1):
            v = ws.cell(row=r, column=col).value
            if v:
                seen.add(str(v))
    return seen


def target_sheet(form_name, data):
    """Which sheet a submission belongs on."""
    if form_name == "cbeds-charter":
        return "Agent"                       # a signatory is listed on CBEDSync
    kind = (data.get("type") or "").strip().lower()
    return {"agent": "Agent", "project": "Project",
            "output": "Output", "post": "Posts"}.get(kind, "Posts")


# The Charter's fields were renamed once, so that Netlify's emails and CSV exports
# read "Organisation" and "Commitments" rather than "Org" and "Commit". Submissions
# taken before that still carry the old names, so both are accepted.
WAS_CALLED = {"organisation": "org", "commitments": "commit"}


def field(data, name):
    v = data.get(name)
    if v in (None, "") and name in WAS_CALLED:
        v = data.get(WAS_CALLED[name])
    return v


def entity_name(form_name, data):
    if form_name == "cbeds-charter":
        return (field(data, "organisation") or "").strip()
    return (data.get("name") or "").strip()


def stage(ws, heads, sub):
    """Append one submission as a row: master columns first, then review columns."""
    data = sub.get("data") or {}
    form = sub.get("form_name") or ""
    row = ws.max_row + 1

    def put_head(head, value):
        if not value:
            return
        i = head_index(heads, head)
        if i is not None:
            ws.cell(row=row, column=i + 1, value=value)

    # the entity's name is always the sheet's first column
    ws.cell(row=row, column=1, value=entity_name(form, data))
    for src, head in FIELD_TO_HEAD.items():
        put_head(head, (data.get(src) or "").strip())
    # CBEDSense's aspects are the closest thing we collect to technologies
    aspects = [a.strip() for a in (data.get("aspects") or "").split(",") if a.strip()]
    for head, value in zip(TECH_HEADS, aspects):
        put_head(head, value)
    put_head(SOURCE_HEAD, "Public")          # the whole point: it came from outside

    commits = field(data, "commitments")
    if isinstance(commits, list):
        commits = ", ".join(commits)

    values = {
        "Review: Submitted": (sub.get("created_at") or "")[:19].replace("T", " "),
        "Review: Submitted by": data.get("by") or field(data, "organisation") or "",
        "Review: Email": data.get("email") or "",
        "Review: Named lead": data.get("lead") or "",
        "Review: Commitments": commits or "",
        "Review: Form": form,
        ID_COL: str(sub.get("id") or ""),
    }
    for head, value in values.items():
        col = review_index(ws, head)
        if col and value:
            ws.cell(row=row, column=col, value=value)


def main():
    token = env("NETLIFY_TOKEN")
    if not token:
        sys.exit(
            "No NETLIFY_TOKEN found.\n\n"
            "1. Create a personal access token at\n"
            "   https://app.netlify.com/user/applications  ->  New access token\n"
            "2. Put it in the .env file next to this script:\n"
            "       NETLIFY_TOKEN=your-token-here\n"
            "   .env is git-ignored, so it stays on this computer.")
    site = env("NETLIFY_SITE", "cbeds.netlify.app")

    heads = master_headers()
    if STAGING.exists():
        wb = openpyxl.load_workbook(STAGING)
        for name in SHEETS:                   # pick up any new master column
            ws = wb[name]
            if [str(c.value or "") for c in ws[1]][:len(heads[name])] != heads[name]:
                print("  note: %s columns changed in the master; new rows follow the "
                      "new layout, older rows were left as they were" % name)
    else:
        wb = new_book(heads)
    already = staged_ids(wb)

    site_id, site_name = resolve_site(site, token)
    print("  project: %s" % site_name)

    forms = api("/sites/%s/forms" % site_id, token)
    wanted = {f["name"]: f["id"] for f in forms
              if f.get("name") in ("cbeds-charter", "cbedsense-submission")}
    if not wanted:
        seen = ", ".join(sorted(str(f.get("name")) for f in forms)) or "(none)"
        sys.exit("No CBEDS forms on %s.\n"
                 "Forms this project has: %s\n"
                 "If that is empty, no deploy carrying the forms has gone out yet."
                 % (site_name, seen))
    print("  forms  : %s" % ", ".join(sorted(wanted)))

    added = skipped = 0
    for name, fid in sorted(wanted.items()):
        for sub in api("/forms/%s/submissions?per_page=100" % fid, token):
            if str(sub.get("id")) in already:
                skipped += 1
                continue
            sheet = target_sheet(name, sub.get("data") or {})
            stage(wb[sheet], heads[sheet], sub)
            added += 1

    wb.save(STAGING)
    print("OK  wrote %s" % STAGING.name)
    print("    new=%d  already staged=%d" % (added, skipped))
    if added:
        print("    Check them, then copy the master columns of the rows you approve")
        print("    into CBEDSync.xlsx. Source already says Public.")


if __name__ == "__main__":
    main()
