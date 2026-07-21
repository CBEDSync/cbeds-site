# CBEDS website

Static site for **CBEDS — the Centre for Built Environment Data Sharing**.

## Pages
- `cbeds.html` — homepage
- `cbedstory.html` — the CBEDStory / journey page
- `cbedsync.html` — the knowledge-graph explorer
- `cbedsynergy.html` — the organisation network (in development)
- `cbedsense.html` — the community space (in development)
- `index.html` — a small redirect so the site root loads `cbeds.html`

## How the data works
The knowledge graph reads `cbedsync-data.js`, which is **generated** from
`draft/CBEDSync.xlsx` by `build.py`. Don't edit `cbedsync-data.js` by hand.

    Edit draft/CBEDSync.xlsx  →  run build.py  →  cbedsync-data.js updates

`update-website.bat` (Windows) / `update-website.command` (Mac) rebuilds the
data and publishes in one step. See `HOW-TO-HOST-AND-UPDATE.md` for full setup.

## Assets
`favicon.svg`, `cbedslogo.jpg`, `Slide1–3.JPG`, and the design sources in `draft/`.
