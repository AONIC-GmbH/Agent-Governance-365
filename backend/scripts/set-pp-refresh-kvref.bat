@echo off
REM Prefer the PowerShell REST-based fixer (avoids Windows @@ / parenthesis bugs).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-pp-refresh-kvref.ps1"
exit /b %ERRORLEVEL%
