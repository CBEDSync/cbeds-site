#!/usr/bin/env python3
"""
CBEDS site data builder.

Reads the master workbook (draft/CBEDSync.xlsx) and regenerates
cbedsync-data.js - the file the website reads to draw the network.

Run it after you edit the Excel:  python build.py
Or double-click  update-website.bat (Windows) / update-website.command (Mac).
"""

import json
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is not installed. Run:  pip install openpyxl")

HERE = Path(__file__).resolve().parent
XLSX = HERE / "draft" / "CBEDSync.xlsx"
OUT = HERE / "cbedsync-data.js"
DESC_MAX = 240
SUB_MAX = 60
WEB_MAX = 300

# "Source" says where a row came from: blank when the team added it, "Public" when it
# arrived through a form on the website and was approved. Unlike every other field
# here, it is found by its heading rather than its position, so it can sit in any
# column and can be moved later without touching this file.
SOURCE_HEAD = "Source"

THEMES = [
    "Data Integration and Interoperability",
    "Economic and Market Transparency",
    "Compliance and Quality Assurance",
    "Lifecycle and Asset Performance",
    "Health, Safety, and Wellbeing",
    "Production and Construction Management",
    "Sustainability and Circularity",
]
STAGES = [
    "Data Needs and Requirements ",
    "Data Collection and Exchange",
    "Data Models and Integration",
    "Data Governance and Security",
    "Data Reporting and Analytics",
]


def s(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def txt(v, maxlen=None):
    """Clean text: collapse newlines/tabs to spaces, optionally trim to maxlen + …"""
    d = s(v)
    for ch in ("\r\n", "\n", "\r", "\t"):
        d = d.replace(ch, " ")
    if maxlen is not None and len(d) > maxlen:
        d = d[:maxlen] + "…"
    return d


def find_col(ws, head):
    """Index of the column with this heading in row 1, or None if there is not one.

    Everything else on these sheets is read by position, which is why a column must
    never be inserted in the middle of one. This is looked up by name instead, so
    the Source column can live anywhere and be moved without breaking the build."""
    for row in ws.iter_rows(min_row=1, max_row=1, values_only=True):
        for i, v in enumerate(row):
            if s(v).lower() == head.lower():
                return i
    return None


def source(row, col):
    """The Source cell for this row, or "" if the sheet has no such column.

    Rows come back only as wide as the sheet has data, so a trailing empty cell can
    make a row shorter than the heading - that is a blank Source, not an error."""
    if col is None or col >= len(row):
        return ""
    return s(row[col])


def flags(row, cols, labels):
    out = []
    for col, label in zip(cols, labels):
        if s(row[col]):
            out.append(label)
    return out


def values(row, cols):
    out = []
    for col in cols:
        v = s(row[col])
        if v and v not in out:
            out.append(v)
    return out


def rels(row, cols, t):
    out = []
    for col in cols:
        v = s(row[col])
        if v:
            out.append({"n": v, "t": t})
    return out


def build():
    if not XLSX.exists():
        sys.exit("Cannot find workbook: %s" % XLSX)
    wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
    nodes = []
    no_source = []          # sheets with no Source column, reported at the end

    ws = wb["Agent"]
    src_col = find_col(ws, SOURCE_HEAD)
    if src_col is None:
        no_source.append("Agent")
    for row in ws.iter_rows(min_row=2, values_only=True):
        name = s(row[0])
        if not name:
            continue
        node = {
            "id": name, "kind": "agent",
            "sub": txt(row[2], SUB_MAX), "cls": s(row[1]),
            "web": txt(row[3], WEB_MAX), "desc": txt(row[4], DESC_MAX), "loc": s(row[7]),
            "themes": flags(row, range(21, 28), THEMES),
            "stages": flags(row, range(28, 33), STAGES),
            "tech": values(row, range(33, 39)),
            "rel": rels(row, range(9, 21), "partOf") + rels(row, range(39, 55), "link"),
        }
        src = source(row, src_col)
        if src:                       # left out when blank, which is nearly every row
            node["src"] = src
        nodes.append(node)

    ws = wb["Project"]
    src_col = find_col(ws, SOURCE_HEAD)
    if src_col is None:
        no_source.append("Project")
    for row in ws.iter_rows(min_row=2, values_only=True):
        name = s(row[0])
        if not name:
            continue
        node = {
            "id": name, "kind": "project",
            "sub": s(row[2]), "cls": "Project",
            "web": txt(row[3], WEB_MAX), "desc": txt(row[1], DESC_MAX), "loc": s(row[6]),
            "themes": flags(row, range(9, 16), THEMES),
            "stages": flags(row, range(16, 21), STAGES),
            "tech": values(row, range(21, 27)),
            "rel": rels(row, [7, 8], "managedBy") + rels(row, range(27, 43), "link"),
        }
        src = source(row, src_col)
        if src:
            node["src"] = src
        nodes.append(node)

    ws = wb["Output"]
    src_col = find_col(ws, SOURCE_HEAD)
    if src_col is None:
        no_source.append("Output")
    for row in ws.iter_rows(min_row=2, values_only=True):
        name = s(row[0])
        if not name:
            continue
        node = {
            "id": name, "kind": "output",
            "sub": txt(row[2], SUB_MAX), "cls": s(row[1]),
            "web": txt(row[3], WEB_MAX), "desc": txt(row[5], DESC_MAX), "loc": "",
            "year": s(row[4]),
            "themes": flags(row, range(10, 17), THEMES),
            "stages": flags(row, range(17, 22), STAGES),
            "tech": values(row, range(22, 28)),
            "rel": rels(row, [8, 9], "producedBy") + rels(row, range(28, 44), "link"),
        }
        src = source(row, src_col)
        if src:
            node["src"] = src
        nodes.append(node)

    techcat = {}
    for row in wb["Technologies"].iter_rows(min_row=2, values_only=True):
        tech, cat = s(row[0]), s(row[1])
        if tech:
            techcat[tech] = cat

    counts = {
        "agent": sum(1 for n in nodes if n["kind"] == "agent"),
        "project": sum(1 for n in nodes if n["kind"] == "project"),
        "output": sum(1 for n in nodes if n["kind"] == "output"),
        "public": sum(1 for n in nodes if n.get("src") == "Public"),
    }
    return {"nodes": nodes, "themes": THEMES, "stages": STAGES,
            "techcat": techcat, "counts": counts, "noSource": no_source}


def main():
    data = build()
    missing = data.pop("noSource")          # a message for you, not data for the site
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text("window.CBEDS_DATA=" + payload, encoding="utf-8")
    c = data["counts"]
    print("OK  wrote %s" % OUT.name)
    print("    agents=%d  projects=%d  outputs=%d  total=%d"
          % (c["agent"], c["project"], c["output"], len(data["nodes"])))
    # A quick check that approved submissions were actually marked in the Source
    # column - if you approved one today and this still says 0, the cell is empty.
    print("    from public submissions=%d" % c["public"])
    if missing:
        print('    note: no "%s" column on %s - add one at the far right of the '
              "sheet to record which entries came from the public"
              % (SOURCE_HEAD, ", ".join(missing)))


if __name__ == "__main__":
    main()
