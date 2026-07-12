@echo off
REM ============================================================
REM  CBEDS - update the website from the Excel
REM  Double-click this file after you edit draft\CBEDSync.xlsx
REM ============================================================
cd /d "%~dp0"

echo Rebuilding website data from CBEDSync.xlsx ...
python build.py
if errorlevel 1 (
  echo.
  echo Trying to install the one required package ^(openpyxl^)...
  python -m pip install openpyxl
  python build.py
)

echo.
echo Publishing to the live site ...
where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed - skipping publish. Data file was updated locally.
  goto done
)
git add cbedsync-data.js
git commit -m "Update site data from Excel"
git push
echo.
echo Done. The live site will refresh in about a minute.

:done
echo.
pause
