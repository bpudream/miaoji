@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Path Verification Script
echo ========================================
echo.

REM 获取脚本所在目录
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

REM 如果脚本在 scripts 子目录中，向上退一级到 server 目录
if "%SCRIPT_DIR:~-7%"=="\scripts" (
    set "SERVER_DIR=%SCRIPT_DIR:~0,-7%"
) else (
    set "SERVER_DIR=%SCRIPT_DIR%"
)

echo Script Location: %~f0
echo Script Directory: %SCRIPT_DIR%
echo Server Directory: %SERVER_DIR%
echo Current Working Directory: %CD%
echo.

echo ========================================
echo Checking Required Files and Directories
echo ========================================
echo.

set "ERRORS=0"

REM 检查 dist/app.js
set "APP_JS=%SERVER_DIR%\dist\app.js"
if exist "%APP_JS%" (
    echo [OK] Service file: %APP_JS%
) else (
    echo [ERROR] Service file not found: %APP_JS%
    set /a ERRORS+=1
)

REM 检查 NSSM
set "NSSM_PATH=%SERVER_DIR%\tools\nssm.exe"
if exist "%NSSM_PATH%" (
    echo [OK] NSSM: %NSSM_PATH%
) else (
    echo [WARNING] NSSM not found: %NSSM_PATH%
    echo            Run: tools\download-nssm.bat
)

REM 检查 .env
set "ENV_FILE=%SERVER_DIR%\.env"
if exist "%ENV_FILE%" (
    echo [OK] Environment file: %ENV_FILE%
) else (
    echo [WARNING] .env file not found: %ENV_FILE%
    echo            Copy from env.template and configure
)

REM 检查 Node.js
where node >nul 2>&1
if %errorLevel% equ 0 (
    for /f "tokens=*" %%i in ('where node') do set "NODE_PATH=%%i"
    echo [OK] Node.js: %NODE_PATH%
) else (
    echo [ERROR] Node.js not found in PATH
    set /a ERRORS+=1
)

REM 检查目录结构
echo.
echo ========================================
echo Directory Structure
echo ========================================
echo.

if exist "%SERVER_DIR%\dist" (
    echo [OK] dist\ directory exists
) else (
    echo [ERROR] dist\ directory not found
    set /a ERRORS+=1
)

if exist "%SERVER_DIR%\python" (
    echo [OK] python\ directory exists
) else (
    echo [WARNING] python\ directory not found
)

if exist "%SERVER_DIR%\data" (
    echo [OK] data\ directory exists
) else (
    echo [INFO] data\ directory will be created automatically
)

if exist "%SERVER_DIR%\logs" (
    echo [OK] logs\ directory exists
) else (
    echo [INFO] logs\ directory will be created automatically
)

echo.
echo ========================================
if %ERRORS% equ 0 (
    echo Verification completed: All critical files found!
    echo.
    echo You can now run: install-service.bat
) else (
    echo Verification completed with %ERRORS% error(s)!
    echo.
    echo Please fix the errors before installing the service.
)
echo ========================================
echo.
pause

