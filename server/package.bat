@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Backend Service Build Script
echo ========================================
echo.

set "RELEASE_DIR=release"
set "RELEASE_SERVER_DIR=%RELEASE_DIR%\server"
set "RELEASE_SCRIPTS_DIR=%RELEASE_DIR%\scripts"
set "RELEASE_TOOLS_DIR=%RELEASE_DIR%\tools"

echo [1/5] Cleaning old build files...
if exist dist (
    echo Removing dist directory...
    rmdir /s /q dist
)
if exist %RELEASE_DIR% (
    echo Removing old release directory...
    rmdir /s /q %RELEASE_DIR%
)

echo.
echo [2/5] Compiling TypeScript...
call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] TypeScript compilation failed!
    pause
    exit /b 1
)

echo.
echo [3/5] Checking build output...
if not exist dist\app.js (
    echo [ERROR] Build output not found: dist\app.js
    pause
    exit /b 1
)
echo [SUCCESS] Build output generated

echo.
echo [4/5] Creating release package...
mkdir %RELEASE_SERVER_DIR% 2>nul

echo Copying compiled files...
xcopy /E /I /Y dist %RELEASE_SERVER_DIR%\dist >nul

echo Copying Python worker...
if exist python (
    xcopy /E /I /Y python %RELEASE_SERVER_DIR%\python >nul
    echo [SUCCESS] Python worker copied
) else (
    echo [WARNING] Python worker directory not found
)

echo Copying tools directory (NSSM, etc.)...
if exist tools (
    mkdir %RELEASE_TOOLS_DIR% 2>nul
    xcopy /E /I /Y tools %RELEASE_TOOLS_DIR% >nul
    echo [SUCCESS] Tools directory copied to %RELEASE_TOOLS_DIR%
) else (
    echo [WARNING] Tools directory not found
)

echo Copying models directory...
if exist ..\models (
    xcopy /E /I /Y ..\models %RELEASE_DIR%\models >nul
    echo [SUCCESS] Models directory copied
) else (
    echo [WARNING] Models directory not found at ..\models
    echo [TIP] Models are required for transcription. Please ensure models/large-v3 exists.
)

echo Copying service management scripts...
if exist scripts (
    mkdir %RELEASE_SCRIPTS_DIR% 2>nul
    xcopy /E /I /Y scripts %RELEASE_SCRIPTS_DIR% >nul
    echo [SUCCESS] Service management scripts copied to %RELEASE_SCRIPTS_DIR%
) else (
    echo [WARNING] Scripts directory not found
)

echo Copying package files...
copy /Y package.json %RELEASE_SERVER_DIR%\ >nul
copy /Y package-lock.json %RELEASE_SERVER_DIR%\ 2>nul
copy /Y env.template %RELEASE_SERVER_DIR%\ >nul

echo Creating required directories...
mkdir %RELEASE_SERVER_DIR%\data 2>nul
mkdir %RELEASE_SERVER_DIR%\uploads 2>nul

echo.
echo [5/5] Package creation completed!
echo.
echo NOTE: node_modules will NOT be included in the package.
echo       Dependencies should be installed on the target machine.
echo       This ensures compatibility with the target environment.

echo.
echo Checking environment configuration...
cd %RELEASE_SERVER_DIR%
if not exist .env (
    echo [WARNING] .env file does not exist
    echo [TIP] Please copy from env.template and configure .env file
) else (
    echo [SUCCESS] .env file exists
)
cd ..\..

echo.
echo ========================================
echo Build completed!
echo ========================================
echo.
echo Release directory: %RELEASE_DIR%\server
echo.
echo Package contents:
echo   - server/
echo     - dist/              Compiled JavaScript files
echo     - python/            Python worker scripts
echo     - data/              Database directory (empty, will be created at runtime)
echo     - uploads/           Upload directory (empty, will be created at runtime)
echo     - package.json       Project configuration
echo     - package-lock.json  Dependency lock file
echo     - env.template       Environment variable template
echo   - scripts/             Service management scripts (install, start, stop, etc.)
echo   - tools/               NSSM and helper scripts (if found)
echo   - models/              Whisper model files (if found)
echo.
echo IMPORTANT: node_modules is NOT included!
echo           Dependencies must be installed on the target machine.
echo.
echo Next steps (on target machine):
echo 1. Copy the release directory to target machine
echo 2. Navigate to the release root: cd %RELEASE_DIR%
echo 3. Install dependencies: scripts\install-dependencies.bat
echo    (or from server dir: ..\scripts\install-dependencies.bat)
echo 4. Copy server\env.template to server\.env and configure it
echo 5. Ensure Python dependencies are installed (faster-whisper)
echo 6. Ensure FFmpeg and Ollama are installed
echo 7. Verify models/large-v3 directory exists (should be in %RELEASE_DIR%\models\large-v3)
echo 8. Install Windows service (optional): scripts\install-service.bat
echo 9. Or run directly from server/: npm start
echo.
pause
