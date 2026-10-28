---
name: building-tauri-android-apks
description: Use when producing, signing, or verifying a Tauri v2 Android APK from Windows, and when a Tauri Android app installs and launches but renders a blank black/white screen, when `tauri android build` aborts at the jniLibs symlink step, when the CLI output APK is unsigned, or when an emulator falls back to software rendering.
---

# Building Tauri Android APKs

## Overview

A Tauri Android APK only displays when three independent things hold: the Rust
library was compiled **with** the `custom-protocol` feature, that library and the
packaged frontend come from the **same** `dist/`, and the WebView can actually
serve the app origin. Each can fail silently while the build reports success —
and each has a different symptom. This skill is the contract for producing and
checking the APK.

## When to Use

- Building, signing, shipping, or auditing a Tauri v2 Android APK.
- App installs and launches, but the screen is one solid colour (black in dark
  theme, white in light theme) with no UI, no crash, and no `FATAL EXCEPTION`.
- `tauri android build` fails at the final step with "Creation symbolic link is
  not allowed for this system".
- The CLI output APK is named `-unsigned.apk`, or `adb install` rejects it.
- The emulator is slow, shows `System UI isn't responding`, or logs
  `hasSufficientHostVulkanDriver: unsupported driver version`.

Not for native Android/Kotlin, Flutter, or React Native projects.

## The pipeline

```powershell
# 0. one-time: Developer Mode (without it the CLI aborts at the LAST step)
$p='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
if (-not (Test-Path $p)) { New-Item -Path $p -Force | Out-Null }
Set-ItemProperty -Path $p -Name 'AllowDevelopmentWithoutDevLicense' -Value 1 -Type DWord

# 1. build  -> unsigned APK at
#    src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk
npx tauri android build --target aarch64 --target x86_64 --apk

# 2. align, then sign  (align BEFORE signing - the reverse breaks v2/v3 signatures)
$bt = "$env:ANDROID_SDK_ROOT\build-tools\35.0.0"
$unsigned = "src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk"
& "$bt\zipalign.exe" -f -p 4 $unsigned release\app-aligned.apk
$ksPass = (Get-Content 'E:\OpenClaw\teleprompter-keystore.txt' -TotalCount 1).Trim()
& "$bt\apksigner.bat" sign `
  --ks "$env:USERPROFILE\.android\teleprompter-release.jks" `
  --ks-pass "pass:$ksPass" --key-pass "pass:$ksPass" --ks-key-alias teleprompter `
  --out release\app-arm64.apk release\app-aligned.apk
#   ^ 正式包用 release 证书。debug 签名只用于本地调试；换签会让已装 release 版的设备无法覆盖升级。
& "$bt\apksigner.bat" verify --print-certs release\app-arm64.apk   # v2 and v3 must be true

# 3. verify the artifact itself
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\verify-android-apk.ps1 -ApkPath release\app-arm64.apk

# 4. render check - the only check that proves the UI works
adb install -r release\app-arm64.apk
adb shell am start -W -n <pkg>/.MainActivity
adb shell uiautomator dump /sdcard/ui.xml   # WebView must expose text nodes
```

Step 3 must print `RESULT: OK`. Step 4 must show the app's text in the
`uiautomator` dump — "it installed" proves nothing.

## The three silent failures

| Symptom | Mechanism | Detect |
|---|---|---|
| Solid-colour screen, no crash, app alive | Rust library built **without** `custom-protocol` → tauri's build script sets `cfg(dev)` → on mobile every request is proxied to the Vite dev server, which is not there | `.so` contains `proxy_dev_request` / `Failed to request `; the WebView body is Tauri's error page |
| Old UI, or nothing, after a frontend change | `generate_context!` embeds the frontend into the `.so` **at compile time**; the crate was not recompiled after `dist/` changed | Compare hashed filenames inside the `.so` with the current `dist/assets/` |
| Build "fails" only at the end; old APK keeps being installed | CLI symlinks the `.so` into `jniLibs/`; without Developer Mode it aborts after the Rust+Gradle work succeeded, leaving the previous APK in place | Log line `Info symlinking lib ...` **and** exit code 0 |

The decisive runtime probe — the WebView's devtools socket is exposed on Android
**even for release builds** (contrary to common belief):

```powershell
$pidApp = (adb shell pidof <pkg>) -join ''
adb forward tcp:9222 "localabstract:webview_devtools_remote_$pidApp"
Invoke-RestMethod http://127.0.0.1:9222/json/list   # title == "tauri.localhost" => never parsed
```

A page title equal to the host name (instead of the app's `<title>`) means the
document never loaded.

## Common mistakes

| Mistake | Effect |
|---|---|
| Building the Rust library by hand (`cargo build --release`) | No `custom-protocol` → dev mode → blank screen |
| Not recompiling the crate after `dist/` changed | App serves a stale bundle |
| Assuming the APK carries the frontend | It usually does not — it is inside the `.so`; `assets/` may hold only `dexopt/` and `tauri.conf.json` |
| Publishing the `-unsigned.apk` | Install is rejected |
| `hw.gpu.mode=auto` in the AVD | Silently renders in software; `auto` never picks `host` — set `host`, and need driver >= 553.35 |
| Looking for a `build.customProtocol` toggle in `tauri.conf.json` | There is none — `custom-protocol` is a **Cargo feature** on the `tauri` crate that the CLI injects as `--features custom-protocol`; it is not configurable in JSON |
| Grepping the emulator log for `renderer: host` | Keyword names changed across emulator versions — check `vulkan_mode_selected:host` and `Selecting Vulkan device: <vendor>` instead |
| arm64-only APK on an x86_64 emulator | Runs through NDK translation; build a native `x86_64` APK for emulator testing |
| `adb exec-out screencap -p` piped through a text shell | Corrupts the PNG (header becomes `89 50 4E 47 0D 0D 0A 1A`) — redirect in binary mode or `adb pull` |
| `tsc` with `noEmit:false` + `outDir` in a Vite project | `tsc` writes into `dist/assets` and aborts the build with `TS5033 EPERM` — use `"noEmit": true` |
| `vite.config.ts` pins a port other than 1420 with no `build.devUrl` | `tauri dev` on a device cannot reach the dev server |

## Reference

- `reference.md` — full procedures: prerequisites, both build recipes, signing,
  the CDP/uiautomator/logcat probe ladder, AVD and GPU setup, complete pitfall list.
- `scripts/verify-android-apk.ps1` — release gate; detects dev-mode libraries,
  embedded-vs-packaged asset drift, and drift against the current `dist/`.
