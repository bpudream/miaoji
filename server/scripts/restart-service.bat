@echo off
setlocal

set "SERVICE_NAME=MiaojiBackend"

echo Restarting %SERVICE_NAME%...
echo.

echo [1/2] Stopping service...
net stop "%SERVICE_NAME%" >nul 2>&1
if %errorLevel% equ 0 (
    echo [SUCCESS] Service stopped
) else (
    echo [INFO] Service was not running
)

echo.
echo [2/2] Waiting 2 seconds...
timeout /t 2 >nul

echo.
echo Starting service...
net start "%SERVICE_NAME%"

if %errorLevel% equ 0 (
    echo.
    echo ========================================
    echo [SUCCESS] Service restarted!
    echo ========================================
    echo.
    echo Check status: sc query %SERVICE_NAME%
) else (
    echo.
    echo [ERROR] Failed to restart service!
    echo.
    echo Make sure the service is installed: install-service.bat
    echo Check service status: sc query %SERVICE_NAME%
)

pause

