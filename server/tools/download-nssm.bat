@echo off
echo ========================================
echo NSSM Download Helper
echo ========================================
echo.

set "NSSM_VERSION=2.24"
set "NSSM_URL=https://nssm.cc/release/nssm-%NSSM_VERSION%.zip"
set "DOWNLOAD_DIR=%~dp0"
set "ZIP_FILE=%DOWNLOAD_DIR%nssm-%NSSM_VERSION%.zip"
set "EXTRACT_DIR=%DOWNLOAD_DIR%nssm-%NSSM_VERSION%"
set "NSSM_EXE=%DOWNLOAD_DIR%nssm.exe"

echo This script will download NSSM (Non-Sucking Service Manager)
echo Version: %NSSM_VERSION%
echo URL: %NSSM_URL%
echo.
echo Target: %NSSM_EXE%
echo.

if exist "%NSSM_EXE%" (
    echo [INFO] NSSM already exists at: %NSSM_EXE%
    set /p "OVERWRITE=Do you want to download again? (Y/N): "
    if /i not "!OVERWRITE!"=="Y" (
        echo Download cancelled.
        pause
        exit /b 0
    )
    del "%NSSM_EXE%" >nul 2>&1
)

echo.
echo [1/3] Downloading NSSM...
echo This may take a moment...

REM 检查是否有 PowerShell 和 curl
where powershell >nul 2>&1
if %errorLevel% equ 0 (
    echo Using PowerShell to download...
    powershell -Command "Invoke-WebRequest -Uri '%NSSM_URL%' -OutFile '%ZIP_FILE%'"
) else (
    where curl >nul 2>&1
    if %errorLevel% equ 0 (
        echo Using curl to download...
        curl -L -o "%ZIP_FILE%" "%NSSM_URL%"
    ) else (
        echo [ERROR] Neither PowerShell nor curl is available!
        echo.
        echo Please download manually:
        echo 1. Visit: %NSSM_URL%
        echo 2. Download nssm-%NSSM_VERSION%.zip
        echo 3. Extract nssm.exe to: %DOWNLOAD_DIR%
        pause
        exit /b 1
    )
)

if not exist "%ZIP_FILE%" (
    echo [ERROR] Download failed!
    echo Please download manually from: %NSSM_URL%
    pause
    exit /b 1
)

echo [SUCCESS] Download completed

echo.
echo [2/3] Extracting...
if exist "%EXTRACT_DIR%" rmdir /s /q "%EXTRACT_DIR%"

REM 使用 PowerShell 解压（Windows 10+）
where powershell >nul 2>&1
if %errorLevel% equ 0 (
    powershell -Command "Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%DOWNLOAD_DIR%' -Force"
) else (
    echo [ERROR] Cannot extract ZIP file automatically.
    echo Please extract manually:
    echo 1. Open: %ZIP_FILE%
    echo 2. Extract nssm-%NSSM_VERSION%\win64\nssm.exe
    echo 3. Copy to: %DOWNLOAD_DIR%
    pause
    exit /b 1
)

echo.
echo [3/3] Copying nssm.exe...
set "SOURCE_EXE=%EXTRACT_DIR%\win64\nssm.exe"
if exist "%SOURCE_EXE%" (
    copy "%SOURCE_EXE%" "%NSSM_EXE%" >nul
    echo [SUCCESS] NSSM installed to: %NSSM_EXE%
) else (
    REM 尝试 win32 目录
    set "SOURCE_EXE=%EXTRACT_DIR%\win32\nssm.exe"
    if exist "%SOURCE_EXE%" (
        copy "%SOURCE_EXE%" "%NSSM_EXE%" >nul
        echo [SUCCESS] NSSM installed to: %NSSM_EXE%
    ) else (
        echo [ERROR] nssm.exe not found in extracted files!
        echo Please extract manually.
        pause
        exit /b 1
    )
)

REM 清理临时文件
if exist "%ZIP_FILE%" del "%ZIP_FILE%"
if exist "%EXTRACT_DIR%" rmdir /s /q "%EXTRACT_DIR%"

echo.
echo ========================================
echo NSSM download completed!
echo ========================================
echo.
echo You can now run: install-service.bat
echo.
pause

