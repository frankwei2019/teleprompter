# Tauri Android build & troubleshooting reference

Heavy reference for the `building-tauri-android-apks` skill. Procedures only — no narrative.

---

## 1. Prerequisites (Windows 11)

| Component | Version used | Check |
|---|---|---|
| Node.js / npm | 24.x / 11.x | `node --version` |
| JDK | 17 (LTS) | `java -version` |
| Android SDK | Platform 34/36, build-tools 35.0.0 | `%ANDROID_SDK_ROOT%` |
| NDK | 26.1.10909125 | `%ANDROID_SDK_ROOT%\ndk\` |
| Rust targets | `aarch64-linux-android` (+ armv7 / i686 / x86_64) | `rustup target list --installed` |
| Tauri CLI | must match the `tauri` crate version | `npx tauri --version` |
| PowerShell | 5.1 ships as `powershell.exe` | `powershell.exe -NoProfile -Command '$PSVersionTable.PSVersion'` |

Version skew between the CLI and the `tauri` crate is a common source of JNI/asset-protocol breakage. Keep them equal.

**Shell choice.** Many Windows machines have no `pwsh` (PowerShell 7) on `PATH` — only the built-in `powershell.exe` 5.1. Write scripts so they run under 5.1:

- keep the script **ASCII-only** (5.1 reads BOM-less files as ANSI and mangles non-ASCII), or ship a UTF-8 **with BOM**;
- avoid `$PSScriptRoot` assumptions that break when the script is dot-sourced or invoked as a scriptblock — guard it: `if ($PSScriptRoot) { ... }`;
- run bundled scripts with an explicit policy bypass, since unsigned local scripts are blocked under `RemoteSigned` in some environments:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-android-apk.ps1 -ApkPath <apk>
```

---

## 2. Windows Developer Mode is mandatory for the Tauri CLI

The CLI's last packaging step symlinks the Rust library into the Gradle project:

```
src-tauri\target\aarch64-linux-android\release\libteleprompter_lib.so
  -> src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a\libteleprompter_lib.so
```

Without the privilege this fails **at the very end of the build**, after the Rust and Gradle work has already succeeded:

```
failed to build Android app: Failed to create a symbolic link from ...
Creation symbolic link is not allowed for this system.
You should use developer mode.
```

**The failure mode to recognise:** the build reports an error, but `target\<arch>\release\libteleprompter_lib.so` exists and is correct. A previously produced APK is left untouched, so people keep shipping the old one and conclude "rebuilding changed nothing".

Enable it (Administrator PowerShell, one time):

```powershell
$p = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
if (-not (Test-Path $p)) { New-Item -Path $p -Force | Out-Null }
Set-ItemProperty -Path $p -Name 'AllowDevelopmentWithoutDevLicense' -Value 1 -Type DWord
```

Or: Settings → Privacy & security → For developers → Developer Mode.

No sign-out or reboot is required; newly started processes pick it up.

**Verify with a real build, not a toy test.** A "can I create a symlink here?" probe is misleading inside restricted sandboxes — the sandboxed token keeps only `SeChangeNotifyPrivilege`, so the probe fails even when Developer Mode is correctly enabled. The decisive check is that `npx tauri android build` exits 0 and logs:

```
Info symlinking lib "...libteleprompter_lib.so" in jniLibs dir "...jniLibs/arm64-v8a"
```

---

## 3. Build recipes

### 3.1 Official path (Developer Mode enabled)

```powershell
# 1) build: frontend -> rust (with --features custom-protocol) -> gradle -> apk
npx tauri android build --target aarch64 --apk
#    artifact: src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk

# 2) align, then sign  (align BEFORE signing - the reverse breaks v2/v3 signatures)
$bt = "$env:ANDROID_SDK_ROOT\build-tools\35.0.0"
$unsigned = "src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk"
& "$bt\zipalign.exe" -f -p 4 $unsigned release\app-aligned.apk
& "$bt\apksigner.bat" sign `
  --ks "$env:USERPROFILE\.android\teleprompter-release.jks" `
  --ks-pass "pass:$ksPass" --key-pass "pass:$ksPass" --ks-key-alias teleprompter `
  --out release\app-arm64.apk release\app-aligned.apk
#   ^ 本项目的正式包用专用 release 证书，不是 debug keystore。
#     debug 签名只用于本地临时调试；换成 debug 签会让已装 release 版的设备无法覆盖升级。
#     口令从本机文件读（见 docs/android-build-and-verify-guide.md §2.3），不要硬编码。
& "$bt\apksigner.bat" verify --verbose --print-certs release\app-arm64.apk
#   -> "Verified using v2 scheme: true" and "v3 scheme: true"

# 3) verify
pwsh -File scripts\verify-android-apk.ps1 -ApkPath release\app-arm64.apk
```

`src-tauri/gen/android/keystore.properties` is gitignored — put signing credentials there to make Gradle emit a signed APK automatically. Never commit a keystore or password.

### 3.2 Fallback path (no Developer Mode)

```powershell
# 1) let the CLI compile Rust - it fails at the symlink step, but the .so is good
npx tauri android build --target aarch64 --apk

# 2) copy (never symlink) the release .so into jniLibs
$abi = 'arm64-v8a'
New-Item -ItemType Directory -Force -Path "src-tauri\gen\android\app\src\main\jniLibs\$abi" | Out-Null
Copy-Item "src-tauri\target\aarch64-linux-android\release\libteleprompter_lib.so" `
          "src-tauri\gen\android\app\src\main\jniLibs\$abi\libteleprompter_lib.so" -Force

# 3) assemble, skipping the gradle task that would call the CLI again
cd src-tauri\gen\android
.\gradlew.bat assembleArm64Release -x rustBuildArm64Release -x rustBuildUniversalRelease --no-daemon

# 4) sign (see 3.1 step 2) from
#    src-tauri\gen\android\app\build\outputs\apk\arm64\release\app-arm64-release-unsigned.apk
```

**The `.so` must come from `target\<arch>\release\` and must have been produced by the Tauri CLI.** A library built by hand with `cargo build --release` lacks the `custom-protocol` feature and is a dev-mode library (see §5).

### 3.3 Which ABIs to ship

- `--target aarch64` → arm64-only APK. Correct for real phones; on an x86_64 emulator it installs and runs through **NDK translation** (`libndk_translation`), which works but adds overhead and can mask real problems.
- `--target x86_64` → native for the emulator; much faster and a cleaner test target.
- Ship both for testing: `npx tauri android build --target aarch64 --target x86_64 --apk` (a universal APK with both ABIs).

Build a **native x86_64** APK when the acceptance test happens on an emulator — it removes translation from the equation entirely.

### 3.4 Tauri dev server port

`vite.config.ts` may pin a port (e.g. `server.port: 1421`) while Tauri's mobile dev mode defaults to `http://localhost:1420`. Without a matching `build.devUrl` in `tauri.conf.json`, `tauri dev` on a device/emulator cannot reach the dev server:

```json
"build": {
  "devUrl": "http://localhost:1421",
  ...
}
```

Release builds never use `devUrl`, so this does not affect shipping — it only breaks `tauri dev`.

---

## 4. Asset embedding: the crate and `dist/` must be built together

`generate_context!` embeds the frontend into the Rust binary **at compile time**. The APK may also carry a copy of `dist/` — but it frequently does **not**: a CLI-built release APK typically contains only `assets/dexopt/*` and `assets/tauri.conf.json`, because the WebView is served entirely from the assets embedded in the `.so`. Do not assume the presence or absence of `assets/assets/` in an APK means anything on its own; the embedded set inside the `.so` is what the app actually serves.

If `dist/` changed but the app crate was not recompiled, the embedded set is stale.

Tauri hashes frontend filenames, so any change to `dist/` content changes the filenames. If the build injects a build date or any other varying value, **every** `npm run build` yields new hashes — which makes "frontend changed, crate not rebuilt" a routine event.

Consequences:

| State | Symptom |
|---|---|
| Crate not rebuilt, APK carries fresh `dist/` | App serves the OLD bundle (stale UI), or serves nothing |
| Crate built in dev mode | Blank page (see §5) |

Force a re-embed when in doubt:

```powershell
cd src-tauri
cargo clean -p <crate-name> --target aarch64-linux-android
```

Detect it: `scripts/verify-android-apk.ps1` compares the hashed filenames embedded in the `.so` against the ones packaged in the APK and against the current `dist/assets/`.

---

## 5. Blank / black / white screen: what is actually happening

### Symptom

App installs, launches, process stays alive, activity is focused, **no crash, no FATAL EXCEPTION**, and the screen is one solid colour with no UI.

Colour follows the system theme: light theme → white, dark theme → black.

### The dev-mode trap (the usual root cause)

`tauri/build.rs`:

```rust
let custom_protocol = has_feature("custom-protocol");
let dev = !custom_protocol;        // no feature => dev = true
alias("dev", dev);
```

`tauri/src/protocol/tauri.rs`:

```rust
#[cfg(all(dev, mobile))]
proxy_dev_request(client, url, ...).await?;   // proxies to the Vite dev server
#[cfg(not(all(dev, mobile)))]
manager.get_asset(path, ...)?;                // serves the bundled frontend
```

In dev mode the app treats `http://tauri.localhost/` as an external URL and proxies it to the dev server. With no dev server reachable, the WebView renders Tauri's own error page instead of the app — a solid-colour screen.

> There is **no** `build.customProtocol` toggle in `tauri.conf.json`. `custom-protocol` is a Cargo feature on the `tauri` crate; the Tauri CLI injects `--features custom-protocol` for release builds. If you hand-build the library, that injection never happens.

The `Failed to request {url}: {err}` string exists **only** in the dev-only branch, so its presence in `libteleprompter_lib.so` is a definitive marker.

### Probe ladder

Run in this order; each step eliminates a class of causes cheaply.

| Probe | Command | Reading |
|---|---|---|
| Process alive? | `adb shell pidof <pkg>` | empty → crashed; look at `adb logcat -b crash` |
| View present/sized? | `adb shell dumpsys activity top` | `RustWebView{... 0,0-1080,2340}` → layout fine, problem is in the document |
| Any DOM text? | `adb shell uiautomator dump /sdcard/ui.xml` | WebView node with no children → document empty |
| What is the document? | CDP (§6) | body text tells you which page rendered |
| Native lib sanity | `scripts/verify-android-apk.ps1` | dev-mode + stale-asset detection |

### Things that look like the cause but are not

| Suspect | Why it is ruled out |
|---|---|
| ABI mismatch | `adb install` would fail `INSTALL_FAILED_NO_MATCHING_ABIS`; x86_64 emulators translate arm64 via NDK |
| Frontend not packaged | Check the APK's `assets/assets/` against `index.html`'s references |
| GPU too weak | Reproduces identically with host GPU enabled → not GPU |
| `transparent: true` window | A transparent window shows the theme background, not a solid fill; the DOM check settles it |
| JS error | A JS error leaves earlier DOM mutations in place; the DOM would not be empty |

---

## 6. Inspecting the live WebView with Chrome DevTools Protocol

Tauri/WebView on Android always exposes a devtools socket. No debug build required.

```powershell
$pidApp = (adb shell pidof com.teleprompter.app) -join ''
adb forward --remove-all
adb forward tcp:9222 "localabstract:webview_devtools_remote_$pidApp"

# list targets
Invoke-RestMethod http://127.0.0.1:9222/json/list
#   -> title, url, webSocketDebuggerUrl
```

`title` equal to the host name (e.g. `tauri.localhost`) instead of the page `<title>` means the document never parsed.

Evaluate in the page over the websocket:

```powershell
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [System.Threading.CancellationToken]::None
$ws.ConnectAsync([Uri]("ws://127.0.0.1:9222/devtools/page/" + $targetId), $ct).Wait()

function Send($ws, $json) {
    $b = [System.Text.Encoding]::UTF8.GetBytes($json)
    $s = New-Object 'System.ArraySegment[byte]' -ArgumentList @(,$b)
    $ws.SendAsync($s, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait()
}
function Recv($ws) {
    $buf = New-Object byte[] 1048576
    $s = New-Object 'System.ArraySegment[byte]' -ArgumentList @(,$buf)
    $sb = New-Object System.Text.StringBuilder
    do { $r = $ws.ReceiveAsync($s, $ct).Result
         if ($r.Count -gt 0) { [void]$sb.Append([System.Text.Encoding]::UTF8.GetString($buf, 0, $r.Count)) }
    } while (-not $r.EndOfMessage)
    $sb.ToString()
}

$expr = 'JSON.stringify({url:location.href,title:document.title,readyState:document.readyState,body:document.body?document.body.innerText.slice(0,300):null})'
Send $ws ('{"id":1,"method":"Runtime.evaluate","params":{"expression":' + ($expr | ConvertTo-Json) + ',"returnByValue":true}}')
for ($i = 0; $i -lt 60; $i++) { $r = Recv $ws; if ($r -match '"id":1\b') { ($r | ConvertFrom-Json).result.result.value; break } }
```

`Page.navigate` with the same envelope lets you probe other URLs (e.g. `https://tauri.localhost/` vs `http://tauri.localhost/`) and see whether the asset handler is active.

---

## 7. Capturing the screen without corrupting the PNG

`adb exec-out screencap -p` piped through PowerShell text redirection corrupts the bytes: the PNG signature becomes `89 50 4E 47 0D 0D 0A 1A` instead of `89 50 4E 47 0D 0A 1A 0A`, and the file will not open. Symptom: a screenshot tool reports "unsupported or malformed image data" and every capture is the same size.

Use a binary-safe path — redirect through `cmd`, or pull a file the device already wrote:

```powershell
cmd /c "adb exec-out screencap -p > screen.png"      # binary-safe redirect
adb shell screencap -p /sdcard/s.png
adb pull /sdcard/s.png .
```

Sanity-check any image you captured before trusting it:

```powershell
$b = [System.IO.File]::ReadAllBytes('screen.png')[0..7]
'{0:X2} {1:X2} {2:X2} {3:X2} {4:X2} {5:X2} {6:X2} {7:X2}' -f $b[0..7]
# expect: 89 50 4E 47 0D 0A 1A 0A
```

A ~15 KB PNG is a solid-colour (blank) screen; a full UI is ~100 KB. Compare sizes to tell "blank" from "rendered" without opening the file.

---

## 8. Emulator: hardware acceleration

`D:\Android\Avd\<name>.avd\config.ini`:

```ini
hw.gpu.enabled=yes
hw.gpu.mode=host
```

**`hw.gpu.mode=auto` does NOT pick `host`**, even with a fully supported driver — it still falls back to `lavapipe` / `SwiftShader`. Set `host` explicitly (or pass `-gpu host`).

Host Vulkan needs a recent NVIDIA driver: the emulator rejects drivers older than **553.35** with

```
hasSufficientHostVulkanDriver: unsupported driver version (527.58.0, min required: 553.35.0)
```

Confirm acceleration actually engaged. Keyword names differ between emulator
versions — check for **all** of these, they are stable:

```
emuglConfig_init: vulkan_mode_selected:host gles_mode_selected:host
Selecting Vulkan device: NVIDIA GeForce RTX 3050 Laptop GPU, Version: 1.4.351
Graphics API Version OpenGL ES 3.0 (4.5.0 NVIDIA 617.42)
```

Older emulator builds printed `emulator: INFO: renderer: host` /
`renderer: swiftshader_indirect` instead; treat the presence of
`swiftshader`, `llvmpipe` or `lavapipe` anywhere in the GPU section as software.

And from the device:

```powershell
adb shell dumpsys SurfaceFlinger | Select-String 'GLES'
# GLES: Google (NVIDIA Corporation), ... (NVIDIA GeForce RTX 3050 Laptop GPU/PCIe/SSE2), OpenGL ES 3.1
```

Effect on a Tauri app: cold start 9,456 ms → 954 ms, and the `System UI isn't responding` ANR seen under software rendering disappears.

WHPX (Windows Hypervisor Platform) is the emulator's accelerator on Windows 11:

```powershell
& "$env:ANDROID_SDK_ROOT\emulator\emulator.exe" -accel-check
#   WHPX(10.0.x) is installed and usable.
```

---

## 9. Pitfall list

| Pitfall | Consequence | Prevention |
|---|---|---|
| Crate built without `custom-protocol` | Blank screen in every build | Build with the Tauri CLI only |
| `tauri android build` aborts at the symlink step | Old APK keeps being shipped | Enable Developer Mode; check the build really exits 0 |
| Hand-assembling the APK from a stale `.so` | Stale UI or blank screen | Rebuild the crate after any `dist/` change; run the verify script |
| `dist/` changed but crate not recompiled | App serves an old bundle | `cargo clean -p <crate> --target aarch64-linux-android` |
| Forgetting to sign the CLI output | APK refuses to install | Always run `apksigner`; expect the `-unsigned.apk` name |
| `hw.gpu.mode=auto` | Silent software rendering, slow + ANR | `hw.gpu.mode=host` |
| NVIDIA driver < 553.35 | No host Vulkan | Upgrade the driver |
| `screencap` through a text pipe | Corrupt PNG, false "blank" readings | Binary-safe redirect or `adb pull` |
| `tsc` with `noEmit:false` + `outDir` | `tsc` writes into `dist/assets`, breaks `npm run build` with `TS5033 EPERM` | `"noEmit": true` in tsconfig for Vite projects |
| Checking only "did it install" | Ships a broken APK | Run the verify script and render the app once before publishing |
| Shipping an arm64-only APK to an x86_64 emulator | Runs through NDK translation — slower, and translation bugs masquerade as app bugs | Build a native `x86_64` APK for emulator testing |
| `devUrl` missing / port mismatch with Vite | `tauri dev` cannot reach the dev server on device | Set `build.devUrl` to the same port as `vite.config.ts` |
| Injecting a build timestamp into the bundle | Every build changes asset hashes, so "crate not rebuilt" becomes routine | Prefer a fixed value (version string) and keep the timestamp out of hashed content |
