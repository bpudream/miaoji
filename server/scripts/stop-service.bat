@echo off
setlocal

set "SERVICE_NAME=MiaojiBackend"

echo Stopping %SERVICE_NAME%...
net stop "%SERVICE_NAME%"

if %errorLevel% equ 0 (
    echo [SUCCESS] Service stopped!
) else (
    echo [ERROR] Failed to stop service!
    echo Service may not be running.
)

pause

