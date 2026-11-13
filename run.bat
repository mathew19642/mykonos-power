@echo off
set PORT=3000
echo ==========================================
echo    Mykonos Power - System Startup
echo ==========================================

echo [1/3] Checking for existing processes on port %PORT%...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%PORT% ^| findstr LISTENING') do (
    echo Terminating old process (PID: %%a)...
    taskkill /f /pid %%a >nul 2>&1
)

echo [2/3] Starting Server...
start /b node server.js

echo [3/3] Waiting for server to initialize...
timeout /t 3 /nobreak >nul
echo Opening Mykonos Power at http://localhost:%PORT%...
start http://localhost:%PORT%

echo.
echo SUCCESS: Mykonos Power is now running at http://localhost:3000
echo Keep this window open while using the application.
echo Press any key to stop the server and exit.
pause >nul
taskkill /f /im node.exe >nul 2>&1
exit

