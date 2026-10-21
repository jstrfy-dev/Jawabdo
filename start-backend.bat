@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20.6 or newer and reopen this window.
  exit /b 1
)

node -e "const [major,minor]=process.versions.node.split('.').map(Number);if(major<20||(major===20&&minor<6))process.exit(1)"
if errorlevel 1 (
  echo Node.js 20.6 or newer is required. Detected:
  node --version
  exit /b 1
)

if not exist ".env" (
  if not exist ".env.example" (
    echo .env.example is missing; cannot create local backend settings.
    exit /b 1
  )
  copy ".env.example" ".env" >nul
  if errorlevel 1 (
    echo Could not create .env from .env.example.
    exit /b 1
  )
  echo Created .env from the example. Review its local settings before continuing.
)

if not exist "node_modules\mysql2" (
  echo Dependencies are missing. Run npm install first.
  exit /b 1
)

echo Checking the configured MySQL database...
call npm run mysql:check
if errorlevel 1 (
  echo Start MySQL in the XAMPP Control Panel and verify MYSQL_* settings in .env.
  exit /b 1
)

echo Starting the JawabDo MySQL backend. This does not import or reset the database.
call npm run mysql:start
exit /b %errorlevel%
