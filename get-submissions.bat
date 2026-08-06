@echo off
REM ============================================================
REM  CBEDS - collect form submissions from the website
REM  Double-click this to pull anything new into
REM  draft\Submissions.xlsx, where you can check it before
REM  copying approved rows into CBEDSync.xlsx.
REM  Nothing here touches the master workbook or the live site.
REM ============================================================
cd /d "%~dp0"

echo Collecting submissions from Netlify ...
echo.
python pull-submissions.py
if errorlevel 1 (
  echo.
  echo Trying to install the one required package ^(openpyxl^)...
  python -m pip install openpyxl
  python pull-submissions.py
)

echo.
echo ------------------------------------------------------------
echo Open draft\Submissions.xlsx to review.
echo.
echo   Columns A onwards match CBEDSync.xlsx exactly. The amber cell
echo   in row 1 says where they stop, e.g. "copy A:BM only" - that
echo   range moves if a column is added to the master, so read it
echo   rather than remembering it. Paste it as a new row on the
echo   matching sheet in CBEDSync.xlsx; Source already says Public.
echo   The green "Review:" columns are notes for you, not the master.
echo.
echo   Then double-click rebuild-only.bat to see it on the site.
echo ------------------------------------------------------------
echo.
pause
