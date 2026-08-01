@echo off
REM ============================================================
REM  CBEDS - rebuild the data WITHOUT publishing anything
REM  Double-click this to check a change to draft\CBEDSync.xlsx
REM  before it goes anywhere near the live site.
REM  Use update-website.bat when you do want to publish.
REM ============================================================
cd /d "%~dp0"

echo Rebuilding website data from CBEDSync.xlsx ...
echo.
python build.py
if errorlevel 1 (
  echo.
  echo Trying to install the one required package ^(openpyxl^)...
  python -m pip install openpyxl
  python build.py
)

echo.
echo ------------------------------------------------------------
echo Nothing was published. cbedsync-data.js was updated on this
echo computer only - the live site is untouched.
echo.
echo   To publish it,    double-click update-website.bat
echo   To throw it away, run:  git checkout -- cbedsync-data.js
echo ------------------------------------------------------------
echo.
pause
