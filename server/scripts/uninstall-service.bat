@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Miaoji Backend Service Uninstaller
echo ========================================
echo.

REM 检查是否以管理员身份运行
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] This script must be run as Administrator!
    echo Please right-click and select "Run as administrator"
    pause
    exit /b 1
)

set "SERVICE_NAME=MiaojiBackend"

REM 获取 server 目录（脚本可能在 server\scripts 或 release\scripts）
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
for %%a in ("%SCRIPT_DIR%\..") do set "SCRIPT_PARENT=%%~fa"

set "SERVER_DIR="
if exist "%SCRIPT_PARENT%\package.json" (
    set "SERVER_DIR=%SCRIPT_PARENT%"
) else if exist "%SCRIPT_PARENT%\server\package.json" (
    set "SERVER_DIR=%SCRIPT_PARENT%\server"
) else if exist "%SCRIPT_DIR%\server\package.json" (
    set "SERVER_DIR=%SCRIPT_DIR%\server"
)

if not defined SERVER_DIR (
    echo [ERROR] Unable to locate server directory (package.json not found)
    pause
    exit /b 1
)
for %%a in ("%SERVER_DIR%\..") do set "SERVER_PARENT=%%~fa"
set "TOOLS_DIR=%SERVER_DIR%\tools"
if exist "%SERVER_PARENT%\tools" (
    set "TOOLS_DIR=%SERVER_PARENT%\tools"
)
set "NSSM_PATH=%TOOLS_DIR%\nssm.exe"

echo Checking if service exists...
sc query "%SERVICE_NAME%" >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Service "%SERVICE_NAME%" is not installed.
    pause
    exit /b 0
)

echo.
echo Service found: %SERVICE_NAME%
echo.
echo WARNING: This will remove the service and stop it if running.
set /p "CONFIRM=Are you sure you want to uninstall? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo Uninstallation cancelled.
    pause
    exit /b 0
)

echo.
echo [1/3] Stopping service (if running)...
net stop "%SERVICE_NAME%" >nul 2>&1
if %errorLevel% equ 0 (
    echo [SUCCESS] Service stopped
) else (
    echo [INFO] Service was not running
)

echo.
echo [2/3] Waiting for service to stop...
timeout /t 2 >nul

echo.
echo [3/3] Removing service...
if exist "%NSSM_PATH%" (
    "%NSSM_PATH%" remove "%SERVICE_NAME%" confirm
) else (
    sc delete "%SERVICE_NAME%"
)

if %errorLevel% equ 0 (
    echo.
    echo ========================================
    echo Service uninstalled successfully!
    echo ========================================
    echo.
    echo The service has been removed from Windows Services.
    echo Log files are preserved in: %SERVER_DIR%\logs\
    echo.
) else (
    echo.
    echo [ERROR] Failed to remove service!
    echo You may need to remove it manually using:
    echo   sc delete %SERVICE_NAME%
    echo.
)

pause

