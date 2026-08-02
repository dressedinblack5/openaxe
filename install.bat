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
rem x64 CPUs without AVX2 (pre-Haswell, some VMs) need the baseline build
if "%ARCH%"=="x64" (
    powershell -NoProfile -Command "Add-Type -TypeDefinition 'using System.Runtime.InteropServices;public class Cpu{[DllImport(\"kernel32.dll\")]public static extern bool IsProcessorFeaturePresent(int f);}';if([Cpu]::IsProcessorFeaturePresent(40)){exit 0}else{exit 1}" >nul 2>nul
    if errorlevel 1 set "ARCH=x64-baseline"
)

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
rem openaxe.exe requires opentui.dll (render library) and tiktoken_bg.wasm
rem (tokenizer) next to it. Verify all three to catch stale releases.
if not exist "%BIN_DIR%\opentui.dll" (
    echo Extraction failed: opentui.dll not found
    echo This release is incomplete. Check https://github.com/dressedinblack5/openaxe/releases
    pause
    exit /b 1
)
if not exist "%BIN_DIR%\tiktoken_bg.wasm" (
    echo Extraction failed: tiktoken_bg.wasm not found
    echo This release is incomplete. Check https://github.com/dressedinblack5/openaxe/releases
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

rem --- Visual C++ Redistributable check (required by opentui.dll) ---
set "NEED_VC=0"
if not exist "%SystemRoot%\System32\vcruntime140.dll" set "NEED_VC=1"
if not exist "%SystemRoot%\System32\msvcp140.dll" set "NEED_VC=1"
if "%NEED_VC%"=="1" (
    echo.
    echo Visual C++ Redistributable not detected. Installing...
    set "VCREDIST=vc_redist.x64.exe"
    if "%ARCH%"=="arm64" set "VCREDIST=vc_redist.arm64.exe"
    curl -fsSL "https://aka.ms/vs/17/release/%VCREDIST%" -o "%TEMP%\%VCREDIST%"
    if errorlevel 1 (
        echo Failed to download %VCREDIST%.
        echo openaxe needs the Visual C++ Redistributable. Install it manually from:
        echo   https://aka.ms/vs/17/release/%VCREDIST%
    ) else (
        start /wait "%TEMP%\%VCREDIST%" /install /quiet /norestart
        del "%TEMP%\%VCREDIST%" 2>nul
        echo VC++ Redistributable installed.
    )
)

rem --- Smoke test: binary must start and report a version ---
"%BIN_DIR%\openaxe.exe" --version >nul 2>nul
if errorlevel 1 (
    echo Error: downloaded openaxe.exe failed to run.
    echo If the Visual C++ Redistributable is missing, install it from:
    echo   https://aka.ms/vs/17/release/vc_redist.x64.exe
    pause
    exit /b 1
)

echo.
echo Installed openaxe to %BIN_DIR%\openaxe.exe
echo Run openaxe in any project directory to start.
pause
