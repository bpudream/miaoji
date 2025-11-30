@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Miaoji Backend Service Installer
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

REM 获取脚本所在目录
REM %~dp0 返回脚本文件的驱动器和路径（不依赖当前工作目录）
set "SCRIPT_DIR=%~dp0"
REM 移除末尾的反斜杠（如果有）
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

REM 如果脚本在 scripts 子目录中，向上退一级到 server 目录
if "%SCRIPT_DIR:~-7%"=="\scripts" (
    set "SERVER_DIR=%SCRIPT_DIR:~0,-7%"
) else (
    set "SERVER_DIR=%SCRIPT_DIR%"
)
set "NODE_EXE=node.exe"
set "SERVICE_NAME=MiaojiBackend"
set "SERVICE_DISPLAY_NAME=Miaoji Backend Service"
set "SERVICE_DESCRIPTION=Miaoji Backend Service for transcription and AI processing"

echo ========================================
echo Service Installation Information
echo ========================================
echo Script Location: %~f0
echo Server Directory: %SERVER_DIR%
echo.
echo NOTE: This script uses the script's directory as the server directory.
echo       It does NOT depend on the current working directory.
echo       You can run this script from anywhere.
echo.
pause

echo [1/5] Checking Node.js...
where node >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please install Node.js or add it to PATH.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('where node') do set "NODE_PATH=%%i"
echo [SUCCESS] Node.js found: %NODE_PATH%
echo.
echo Current working directory: %CD%
echo Server directory (used by script): %SERVER_DIR%

echo.
echo [2/5] Checking service files...
set "APP_JS=%SERVER_DIR%\dist\app.js"
if not exist "%APP_JS%" (
    echo [ERROR] Service file not found: %APP_JS%
    echo Please build the service first: npm run build
    pause
    exit /b 1
)
echo [SUCCESS] Service file found: %APP_JS%

echo.
echo [3/5] Checking NSSM...
set "NSSM_PATH=%SERVER_DIR%\tools\nssm.exe"
if not exist "%NSSM_PATH%" (
    echo [WARNING] NSSM not found at %NSSM_PATH%
    echo.
    echo Please download NSSM:
    echo 1. Visit: https://nssm.cc/download
    echo 2. Download the latest release (nssm-2.24.zip)
    echo 3. Extract nssm.exe to: %SERVER_DIR%\tools\nssm.exe
    echo.
    echo Or run: tools\download-nssm.bat
    pause
    exit /b 1
)
echo [SUCCESS] NSSM found: %NSSM_PATH%

echo.
echo [4/5] Checking if service already exists...
sc query "%SERVICE_NAME%" >nul 2>&1
if %errorLevel% equ 0 (
    echo [WARNING] Service already exists!
    echo.
    set /p "OVERWRITE=Do you want to reinstall the service? (Y/N): "
    if /i not "!OVERWRITE!"=="Y" (
        echo Installation cancelled.
        pause
        exit /b 0
    )
    echo.
    echo Removing existing service...
    call "%NSSM_PATH%" remove "%SERVICE_NAME%" confirm
    timeout /t 2 >nul
)

echo.
echo [5/5] Installing service...
set "LOG_DIR=%SERVER_DIR%\logs"
echo ========================================
echo Installation Configuration:
echo ========================================
echo Service Name: %SERVICE_NAME%
echo Display Name: %SERVICE_DISPLAY_NAME%
echo Node.js: %NODE_PATH%
echo App File: %APP_JS%
echo Working Directory: %SERVER_DIR%
echo Log Directory: %LOG_DIR%
echo.
echo IMPORTANT: All paths are absolute and based on script location.
echo            Service will use: %SERVER_DIR%
echo.
pause

REM 安装服务
"%NSSM_PATH%" install "%SERVICE_NAME%" "%NODE_PATH%" "%APP_JS%"

if %errorLevel% neq 0 (
    echo [ERROR] Failed to install service!
    pause
    exit /b 1
)

REM 配置服务
echo Configuring service...

REM 设置显示名称和描述
"%NSSM_PATH%" set "%SERVICE_NAME%" DisplayName "%SERVICE_DISPLAY_NAME%"
"%NSSM_PATH%" set "%SERVICE_NAME%" Description "%SERVICE_DESCRIPTION%"

REM 设置工作目录
"%NSSM_PATH%" set "%SERVICE_NAME%" AppDirectory "%SERVER_DIR%"

REM 设置环境变量（从 .env 文件读取，如果存在）
if exist "%SERVER_DIR%\.env" (
    echo Loading environment variables from .env file...
    REM 读取关键环境变量
    set "BACKEND_PORT=3000"
    set "PYTHON_WORKER_PATH="
    set "PYTHON_PATH="
    set "MODEL_PATH="

    for /f "usebackq tokens=1,* delims==" %%a in ("%SERVER_DIR%\.env") do (
        set "LINE=%%a"
        if not "!LINE!"=="" if not "!LINE:~0,1!"=="#" (
            if "!LINE:~0,13!"=="BACKEND_PORT=" set "BACKEND_PORT=%%b"
            if "!LINE:~0,19!"=="PYTHON_WORKER_PATH=" set "PYTHON_WORKER_PATH=%%b"
            if "!LINE:~0,11!"=="PYTHON_PATH=" set "PYTHON_PATH=%%b"
            if "!LINE:~0,10!"=="MODEL_PATH=" set "MODEL_PATH=%%b"
        )
    )

    REM 设置环境变量到服务
    "%NSSM_PATH%" set "%SERVICE_NAME%" AppEnvironmentExtra "BACKEND_PORT=!BACKEND_PORT!"
    if not "!PYTHON_WORKER_PATH!"=="" "%NSSM_PATH%" set "%SERVICE_NAME%" AppEnvironmentExtra "PYTHON_WORKER_PATH=!PYTHON_WORKER_PATH!"
    if not "!PYTHON_PATH!"=="" "%NSSM_PATH%" set "%SERVICE_NAME%" AppEnvironmentExtra "PYTHON_PATH=!PYTHON_PATH!"
    if not "!MODEL_PATH!"=="" "%NSSM_PATH%" set "%SERVICE_NAME%" AppEnvironmentExtra "MODEL_PATH=!MODEL_PATH!"

    echo [SUCCESS] Environment variables loaded: BACKEND_PORT=!BACKEND_PORT!
) else (
    echo [WARNING] .env file not found, using default environment variables
    "%NSSM_PATH%" set "%SERVICE_NAME%" AppEnvironmentExtra "BACKEND_PORT=3000"
)

REM 设置启动类型为自动
"%NSSM_PATH%" set "%SERVICE_NAME%" Start SERVICE_AUTO_START

REM 设置失败时自动重启
"%NSSM_PATH%" set "%SERVICE_NAME%" AppExit Default Restart
"%NSSM_PATH%" set "%SERVICE_NAME%" AppRestartDelay 5000

REM 设置日志
set "LOG_DIR=%SERVER_DIR%logs"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
"%NSSM_PATH%" set "%SERVICE_NAME%" AppStdout "%LOG_DIR%\service-out.log"
"%NSSM_PATH%" set "%SERVICE_NAME%" AppStderr "%LOG_DIR%\service-err.log"

REM 设置输出文件轮转
"%NSSM_PATH%" set "%SERVICE_NAME%" AppRotateFiles 1
"%NSSM_PATH%" set "%SERVICE_NAME%" AppRotateOnline 1
"%NSSM_PATH%" set "%SERVICE_NAME%" AppRotateSeconds 86400
"%NSSM_PATH%" set "%SERVICE_NAME%" AppRotateBytes 10485760

echo.
echo ========================================
echo Service installed successfully!
echo ========================================
echo.
echo Service Name: %SERVICE_NAME%
echo Display Name: %SERVICE_DISPLAY_NAME%
echo.
echo Next steps:
echo 1. Start the service: net start %SERVICE_NAME%
echo    Or use: sc start %SERVICE_NAME%
echo 2. Check service status: sc query %SERVICE_NAME%
echo 3. View logs: %LOG_DIR%\service-out.log
echo.
set /p "START_NOW=Do you want to start the service now? (Y/N): "
if /i "%START_NOW%"=="Y" (
    echo.
    echo Starting service...
    net start "%SERVICE_NAME%"
    if %errorLevel% equ 0 (
        echo [SUCCESS] Service started!
        echo.
        echo Service is now running and will start automatically on boot.
    ) else (
        echo [ERROR] Failed to start service. Check logs for details.
    )
)
echo.
pause

