@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Install Production Dependencies (Full Setup)
echo ========================================
echo.

REM Debug info
echo [DEBUG] Running script: %~f0
echo [DEBUG] Initial Current Directory: %CD%
echo.

REM 获取 server 目录（脚本可能位于 server\scripts 或 release\scripts）
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
for %%a in ("%SCRIPT_DIR%\..") do set "SCRIPT_PARENT=%%~fa"

echo [DEBUG] SCRIPT_DIR: "%SCRIPT_DIR%"
echo [DEBUG] SCRIPT_PARENT: "%SCRIPT_PARENT%"

set "SERVER_DIR="

REM ==========================================
REM 路径查找逻辑
REM ==========================================

REM 1. Check parent directory
if exist "%SCRIPT_PARENT%\package.json" (
    set "SERVER_DIR=%SCRIPT_PARENT%"
    echo [DEBUG] Match Rule 1: Found package.json in %SCRIPT_PARENT%
    goto :FOUND
)

REM 2. Check parent/server directory
if exist "%SCRIPT_PARENT%\server\package.json" (
    set "SERVER_DIR=%SCRIPT_PARENT%\server"
    echo [DEBUG] Match Rule 2: Found package.json in %SCRIPT_PARENT%\server
    goto :FOUND
)

REM 3. Check current/server directory
if exist "%SCRIPT_DIR%\server\package.json" (
    set "SERVER_DIR=%SCRIPT_DIR%\server"
    echo [DEBUG] Match Rule 3: Found package.json in %SCRIPT_DIR%\server
    goto :FOUND
)

REM 4. Check current directory
if exist "%SCRIPT_DIR%\package.json" (
    set "SERVER_DIR=%SCRIPT_DIR%"
    echo [DEBUG] Match Rule 4: Found package.json in %SCRIPT_DIR%
    goto :FOUND
)

REM If we get here, nothing was found
goto :NOT_FOUND

:FOUND
echo [DEBUG] SERVER_DIR successfully set to: "%SERVER_DIR%"

REM Double check if variable is actually set
if not defined SERVER_DIR (
    echo [CRITICAL ERROR] SERVER_DIR variable lost despite logic match!
    goto :NOT_FOUND
)
goto :CHECK_ENV

:NOT_FOUND
echo.
echo [ERROR] Unable to locate server directory (package.json not found)
echo [DEBUG] Searched locations relative to script:
echo   - ..\package.json
echo   - ..\server\package.json
echo   - .\server\package.json
echo   - .\package.json
echo.
echo [DEBUG] Listing SCRIPT_DIR content:
dir "%SCRIPT_DIR%"
echo.
echo [DEBUG] Listing SCRIPT_PARENT content:
dir "%SCRIPT_PARENT%"
pause
exit /b 1

:CHECK_ENV
echo [INFO] Target Server Directory: "%SERVER_DIR%"
echo.

REM 检查 Node.js 环境
echo [INFO] Checking environment...

where node >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please install Node.js or add it to PATH.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('where node') do echo [INFO] Node executable: %%i
echo Node version:
node -v

echo.
where npm >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] npm is not found in PATH!
    echo Please ensure npm is installed and in PATH.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('where npm') do echo [INFO] NPM executable: %%i
echo NPM version:
call npm -v

REM Check Python (Needed for step 4)
echo.
where python >nul 2>&1
if %errorLevel% neq 0 (
    echo [WARNING] Python is not found in PATH!
    echo Python dependency installation will be skipped.
) else (
    for /f "tokens=*" %%i in ('where python') do echo [INFO] Python executable: %%i
    echo Python version:
    python --version
)


echo.
echo [INFO] Checking package files in "%SERVER_DIR%"...
if not exist "%SERVER_DIR%\package.json" (
    echo [ERROR] package.json unexpectedly missing at "%SERVER_DIR%\package.json"
    dir "%SERVER_DIR%"
    pause
    exit /b 1
)

if exist "%SERVER_DIR%\package-lock.json" (
    echo [INFO] package-lock.json found.
) else (
    echo [WARNING] package-lock.json not found. Using package.json only.
)

echo.
echo ========================================
echo Step 1: Installing Node.js Dependencies
echo ========================================
echo.
echo [INFO] Starting installation in "%SERVER_DIR%"...
cd /d "%SERVER_DIR%"
if %errorLevel% neq 0 (
    echo [ERROR] Failed to change directory to "%SERVER_DIR%"
    pause
    exit /b 1
)
echo [DEBUG] Changed working directory to: %CD%

echo.
echo Running: npm install --production --verbose
echo This may take a few minutes...
echo.

call npm install --production --verbose
if %errorLevel% neq 0 (
    echo.
    echo ========================================
    echo [ERROR] Failed to install Node.js dependencies! Error code: %errorLevel%
    echo ========================================
    pause
    exit /b %errorLevel%
)

echo.
echo ========================================
echo Step 2: Setting up Python Environment
echo ========================================
echo.

set "PYTHON_WORKER_DIR=%SERVER_DIR%\python"
if not exist "%PYTHON_WORKER_DIR%" (
    echo [WARNING] Python worker directory not found at: %PYTHON_WORKER_DIR%
    echo Skipping Python setup...
) else (
    echo [INFO] Python worker directory: %PYTHON_WORKER_DIR%
    cd /d "%PYTHON_WORKER_DIR%"

    where python >nul 2>&1
    if !errorLevel! neq 0 (
        echo [WARNING] Python not found in PATH. Skipping Python environment setup.
        echo Please manually install Python 3.9+ and set up the environment.
    ) else (
        echo [INFO] Creating/Checking virtual environment...

        if not exist ".venv" (
            python -m venv .venv
            if !errorLevel! neq 0 (
                 echo [ERROR] Failed to create virtual environment.
                 echo Please check if Python is installed correctly.
            ) else (
                 echo [SUCCESS] Virtual environment created.
            )
        ) else (
            echo [INFO] Virtual environment already exists.
        )

        if exist ".venv\Scripts\python.exe" (
            echo [INFO] Installing Python dependencies...
            echo This may take a while ^(downloading large packages^)...

            ".venv\Scripts\python.exe" -m pip install --upgrade pip

            if exist "requirements.txt" (
                echo [INFO] Found requirements.txt, installing dependencies...
                ".venv\Scripts\python.exe" -m pip install -r requirements.txt
            ) else (
                echo [WARNING] requirements.txt not found, falling back to manual package list...
                ".venv\Scripts\python.exe" -m pip install faster-whisper
            )

            if !errorLevel! neq 0 (
                echo [WARNING] Some Python dependencies failed to install.
                echo You may need to run manual installation or check network/proxy.
            ) else (
                echo [SUCCESS] Python dependencies installed.
            )
        )
    )
)

echo.
echo ========================================
echo [SUCCESS] All Setup Steps Completed!
echo ========================================
echo.
echo You can now start the service:
echo   npm start
echo   or
echo   scripts\start-service.bat ^(if service is installed^)

echo.
pause
exit /b 0
