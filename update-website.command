#!/bin/bash
# ============================================================
#  CBEDS - update the website from the Excel  (macOS)
#  Double-click after you edit draft/CBEDSync.xlsx
#  (first time: right-click > Open to approve it)
# ============================================================
cd "$(dirname "$0")"

echo "Rebuilding website data from CBEDSync.xlsx ..."
python3 build.py || { echo "Installing required package (openpyxl)..."; python3 -m pip install openpyxl; python3 build.py; }

echo
echo "Publishing to the live site ..."
if command -v git >/dev/null 2>&1; then
  git add cbedsync-data.js
  git commit -m "Update site data from Excel"
  git push
  echo "Done. The live site will refresh in about a minute."
else
  echo "Git not installed - data file updated locally only."
fi
echo
read -n1 -r -p "Press any key to close..."
