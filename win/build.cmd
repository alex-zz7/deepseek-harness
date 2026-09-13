@echo off
setlocal
cd /d "%~dp0"
where dotnet >nul 2>nul
if errorlevel 1 (
  echo Need the .NET 8 SDK: https://dotnet.microsoft.com/download
  exit /b 1
)
dotnet publish -c Release -o ..\build
if errorlevel 1 exit /b 1
echo.
echo Built build\DeepSeekHarness.exe
echo Open that file. Do not open a browser.
