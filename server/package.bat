@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Backend Service Build Script
echo ========================================
echo.

set "RELEASE_DIR=release"
set "RELEASE_SERVER_DIR=%RELEASE_DIR%\server"

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
    xcopy /E /I /Y tools %RELEASE_SERVER_DIR%\tools >nul
    echo [SUCCESS] Tools directory copied
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
    xcopy /E /I /Y scripts %RELEASE_SERVER_DIR%\scripts >nul
    echo [SUCCESS] Service management scripts copied
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
echo [5/5] Installing production dependencies...
cd %RELEASE_SERVER_DIR%
call npm install --production
cd ..\..
if errorlevel 1 (
    echo [WARNING] npm install failed, you may need to install dependencies manually
) else (
    echo [SUCCESS] Production dependencies installed
)

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
echo     - scripts/           Service management scripts (install, start, stop, etc.)
echo     - tools/              NSSM and other tools (if found)
echo     - node_modules/      Production dependencies
echo     - data/              Database directory (empty, will be created at runtime)
echo     - uploads/           Upload directory (empty, will be created at runtime)
echo     - package.json       Project configuration
echo     - env.template       Environment variable template
echo   - models/              Whisper model files (if found)
echo.
echo Next steps:
echo 1. Navigate to: cd %RELEASE_DIR%\server
echo 2. Copy env.template to .env and configure it
echo 3. Ensure Python dependencies are installed (faster-whisper)
echo 4. Ensure FFmpeg and Ollama are installed
echo 5. Verify models/large-v3 directory exists (should be in %RELEASE_DIR%\models\large-v3)
echo 6. Install Windows service (optional): scripts\install-service.bat
echo 7. Or run directly: npm start
echo.
pause
