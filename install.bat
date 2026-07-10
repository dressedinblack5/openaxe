@echo off
setlocal enabledelayedexpansion

set "INSTALL_DIR=%USERPROFILE%\.openaxe"
set "BIN_DIR=%INSTALL_DIR%\bin"

where curl >nul 2>nul || (
    echo Error: curl is required. Install via https://curl.se/windows/ or use Git Bash.
    exit /b 1
)

echo Detecting architecture...
set "ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM" set "ARCH=arm64"

set "BINARY=openaxe-windows-%ARCH%"
echo Downloading %BINARY%...

curl -fsSL "https://github.com/dressedinblack5/openaxe/releases/latest/download/%BINARY%.zip" -o "%TEMP%\%BINARY%.zip"
if errorlevel 1 (
    echo Failed to download %BINARY%.zip
    echo Check https://github.com/dressedinblack5/openaxe/releases
    pause
    exit /b 1
)

mkdir "%BIN_DIR%" 2>nul
powershell -NoProfile -Command "Expand-Archive -Path '%TEMP%\%BINARY%.zip' -DestinationPath '%BIN_DIR%' -Force" >nul

if not exist "%BIN_DIR%\openaxe.exe" (
    echo Extraction failed: openaxe.exe not found
    pause
    exit /b 1
)

del "%TEMP%\%BINARY%.zip" 2>nul

rem --- PATH ---
where openaxe.exe >nul 2>nul || (
    echo Adding to PATH...
    powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('PATH', [Environment]::GetEnvironmentVariable('PATH', 'User') + ';%BIN_DIR%', 'User')" >nul
    echo Added. Restart terminal or run: set PATH=%%PATH%%;%BIN_DIR%
)

rem --- Desktop shortcut ---
echo Creating desktop shortcut...
powershell -NoProfile -Command "$ws=New-Object -ComObject WScript.Shell;$sc=$ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\openaxe.lnk');$sc.TargetPath='%BIN_DIR%\openaxe.exe';$sc.Description='openaxe - AI-powered terminal coding assistant';$sc.Save()" 2>nul

echo.
echo Installed openaxe to %BIN_DIR%\openaxe.exe
echo Run openaxe in any project directory to start.
pause
