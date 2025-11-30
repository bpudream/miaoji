@echo off
setlocal

set "SERVICE_NAME=MiaojiBackend"

echo Starting %SERVICE_NAME%...
net start "%SERVICE_NAME%"

if %errorLevel% equ 0 (
    echo [SUCCESS] Service started!
    echo.
    echo Check status: sc query %SERVICE_NAME%
) else (
    echo [ERROR] Failed to start service!
    echo.
    echo Make sure the service is installed: install-service.bat
    echo Check service status: sc query %SERVICE_NAME%
)

pause

