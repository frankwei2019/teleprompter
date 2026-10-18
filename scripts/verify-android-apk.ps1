<#
.SYNOPSIS
    Verifies that a Tauri Android APK was packaged as a RELEASE build and that
    its embedded frontend assets are internally consistent.

.DESCRIPTION
    Guards against the "black screen on Android emulator" defect described in
    docs/android-build-black-screen.md.

    Two independent failure modes are detected:

      1. DEV-MODE LIBRARY
         If the tauri crate is compiled without the `custom-protocol` feature,
         tauri's build script sets `cfg(dev)`. On mobile that swaps the asset
         handler for a reverse proxy to the Vite dev server
         (tauri/src/protocol/tauri.rs, `#[cfg(all(dev, mobile))] proxy_dev_request`).
         The APK then loads nothing unless a dev server happens to be running,
         which shows up as a blank white/black WebView.

         Detected by looking for the dev-only strings `proxy_dev_request` and
         `Failed to request ` in libteleprompter_lib.so. A release build does not
         contain them.

      2. STALE EMBEDDED ASSETS
         Frontend assets are embedded into the Rust binary at compile time via
         `generate_context!`, while the APK also carries a copy of `dist/`.
         If the Rust crate was not recompiled after `dist/` changed, the two
         disagree and the WebView cannot load its own bundle.

         Detected by comparing hashed asset filenames found inside the .so with
         the hashed asset filenames actually packaged in the APK.

.PARAMETER ApkPath
    Path to the APK to inspect.

.PARAMETER Abi
    ABI directory inside the APK to inspect. Defaults to arm64-v8a.

.EXAMPLE
    pwsh -File scripts/verify-android-apk.ps1 -ApkPath release/teleprompter-arm64-v1.5.1.apk

.NOTES
    Exit code 0 = APK looks healthy, 1 = defect detected, 2 = could not inspect.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $ApkPath,

    [string] $Abi = 'arm64-v8a'
)

$ErrorActionPreference = 'Stop'
$script:failed = $false

function Write-Check {
    param([string] $Status, [string] $Message)
    $colour = switch ($Status) {
        'PASS' { 'Green' }
        'FAIL' { 'Red' }
        'WARN' { 'Yellow' }
        default { 'Gray' }
    }
    Write-Host ("[{0}] {1}" -f $Status, $Message) -ForegroundColor $colour
    if ($Status -eq 'FAIL') { $script:failed = $true }
}

if (-not (Test-Path $ApkPath)) {
    Write-Host "APK not found: $ApkPath" -ForegroundColor Red
    exit 2
}

$apk = (Resolve-Path $ApkPath).Path
Write-Host ""
Write-Host "Inspecting $apk" -ForegroundColor Cyan
Write-Host ("Size: {0:N0} bytes" -f (Get-Item $apk).Length)
Write-Host ""

# ---------------------------------------------------------------- read the APK
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
} catch {
    Write-Host ("Could not open APK as a zip archive: " + $_.Exception.Message) -ForegroundColor Red
    exit 2
}

try {
    $soEntryName = "lib/$Abi/libteleprompter_lib.so"
    $soEntry = $zip.GetEntry($soEntryName)
    if ($null -eq $soEntry) {
        $abis = ($zip.Entries |
            Where-Object { $_.FullName -match '^lib/[^/]+/libteleprompter_lib\.so$' } |
            ForEach-Object { ($_.FullName -split '/')[1] }) -join ', '
        Write-Check 'FAIL' "APK has no $soEntryName (native ABIs present: $(if ($abis) { $abis } else { 'none' }))"
        Write-Host ""
        Write-Host "FAILED: nothing to verify." -ForegroundColor Red
        exit 1
    }

    # Packaged frontend assets, e.g. assets/assets/index-xks_L8XO.js
    $packaged = $zip.Entries |
        Where-Object { $_.FullName -match '^assets/assets/(index-[A-Za-z0-9_\-]+\.(js|css))$' } |
        ForEach-Object { ($_.FullName -split '/')[-1] } |
        Sort-Object -Unique

    # Slurp the native library so we can scan it for marker strings.
    $tempSo = Join-Path ([System.IO.Path]::GetTempPath()) ("verify-apk-" + [guid]::NewGuid().ToString('N') + ".so")
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($soEntry, $tempSo, $true)
} finally {
    $zip.Dispose()
}

try {
    Write-Host ("Native library: {0:N0} bytes" -f (Get-Item $tempSo).Length)
    $bytes = [System.IO.File]::ReadAllBytes($tempSo)
    $ascii = [System.Text.Encoding]::ASCII.GetString($bytes)

    # ------------------------------------------------ check 1: dev-mode library
    # These strings only exist in tauri's dev-only mobile proxy code path.
    $devMarkers = @('proxy_dev_request', 'Failed to request ')
    $hits = @()
    foreach ($marker in $devMarkers) {
        $count = ([regex]::Matches($ascii, [regex]::Escape($marker))).Count
        if ($count -gt 0) { $hits += "$marker (x$count)" }
    }
    if ($hits.Count -gt 0) {
        Write-Check 'FAIL' "Native library was built in DEV mode - found: $($hits -join ', ')"
        Write-Host "        tauri's mobile dev mode proxies every request to the Vite dev server" -ForegroundColor DarkGray
        Write-Host "        instead of serving bundled assets, so the WebView stays blank." -ForegroundColor DarkGray
        Write-Host "        Rebuild with the CLI (adds --features custom-protocol):" -ForegroundColor DarkGray
        Write-Host "            npx tauri android build --target aarch64 --apk" -ForegroundColor DarkGray
    } else {
        Write-Check 'PASS' "Native library is a release build (no dev-mode proxy strings)"
    }

    # ------------------------------------------- check 2: embedded asset names
    $embedded = [regex]::Matches($ascii, 'index-[A-Za-z0-9_\-]{6,12}\.(?:js|css)') |
        ForEach-Object { $_.Value } |
        Sort-Object -Unique

    Write-Host ""
    Write-Host ("Packaged frontend assets ({0}):" -f @($packaged).Count) -ForegroundColor Cyan
    if ($packaged) { $packaged | ForEach-Object { Write-Host "    $_" } } else { Write-Host "    (none)" }

    Write-Host ("Assets embedded in the native library ({0}):" -f @($embedded).Count) -ForegroundColor Cyan
    if ($embedded) { $embedded | ForEach-Object { Write-Host "    $_" } } else { Write-Host "    (none)" }
    Write-Host ""

    if (-not $packaged) {
        # A release build serves the frontend from the assets embedded in the
        # native library, so an APK-side copy is optional and often absent.
        Write-Host "[INFO] APK ships no assets/assets/ copy - the frontend is served" -ForegroundColor DarkGray
        Write-Host "       from the assets embedded in the native library (expected)." -ForegroundColor DarkGray
    } elseif (-not $embedded) {
        Write-Check 'FAIL' "Native library embeds no frontend assets, but the APK ships $(@($packaged).Count)"
    } else {
        $missingInSo = @($packaged | Where-Object { $embedded -notcontains $_ })
        $orphanInSo = @($embedded | Where-Object { $packaged -notcontains $_ })

        if ($missingInSo.Count -eq 0 -and $orphanInSo.Count -eq 0) {
            Write-Check 'PASS' "Embedded frontend assets match the packaged assets exactly"
        } else {
            if ($missingInSo.Count -gt 0) {
                Write-Check 'FAIL' "Packaged but NOT embedded (stale Rust build): $($missingInSo -join ', ')"
            }
            if ($orphanInSo.Count -gt 0) {
                Write-Check 'FAIL' "Embedded but NOT packaged (leftover from an older build): $($orphanInSo -join ', ')"
            }
            Write-Host "        The Rust crate and the APK frontend come from different dist/ builds." -ForegroundColor DarkGray
            Write-Host "        Force the codegen to re-embed by rebuilding the crate, e.g.:" -ForegroundColor DarkGray
            Write-Host "            cargo clean -p teleprompter --target aarch64-linux-android" -ForegroundColor DarkGray
            Write-Host "        then rebuild the APK." -ForegroundColor DarkGray
        }
    }

    # ------------------------------- check 3: staleness against local dist/
    # Independent of how the APK was packaged: the assets embedded in the native
    # library must match whatever dist/ currently contains.
    $distAssets = Join-Path $PSScriptRoot '..\dist\assets'
    if (Test-Path $distAssets) {
        $local = Get-ChildItem $distAssets -File |
            Where-Object { $_.Name -match '^index-[A-Za-z0-9_\-]+\.(js|css)$' } |
            ForEach-Object { $_.Name } |
            Sort-Object -Unique

        if (@($local).Count -gt 0) {
            Write-Host ""
            Write-Host ("Current dist/assets ({0}) - the frontend just built:" -f @($local).Count) -ForegroundColor Cyan
            $local | ForEach-Object { Write-Host "    $_" }

            $notEmbedded = @($local | Where-Object { $embedded -notcontains $_ })
            $stale = @($embedded | Where-Object { $local -notcontains $_ })

            if ($notEmbedded.Count -eq 0 -and $stale.Count -eq 0) {
                Write-Check 'PASS' "Embedded assets match the current dist/ build"
            } else {
                if ($notEmbedded.Count -gt 0) {
                    Write-Check 'FAIL' "Current dist/ files missing from the native library: $($notEmbedded -join ', ')"
                }
                if ($stale.Count -gt 0) {
                    Write-Check 'FAIL' "Native library still embeds old dist/ files: $($stale -join ', ')"
                }
                Write-Host "        The Rust crate was not recompiled after dist/ changed." -ForegroundColor DarkGray
                Write-Host "        Rebuild the library for the target, then repackage the APK." -ForegroundColor DarkGray
            }
        }
    }
} finally {
    Remove-Item $tempSo -Force -ErrorAction SilentlyContinue
}

Write-Host ""
if ($script:failed) {
    Write-Host "RESULT: FAILED - this APK can produce a blank/black screen on device or emulator." -ForegroundColor Red
    exit 1
}

Write-Host "RESULT: OK - APK looks like a healthy release build." -ForegroundColor Green
exit 0
