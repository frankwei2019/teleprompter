# Tauri v2 → Android arm64 APK：Windows + PowerShell 构建与验证手册

> 适用项目：`teleprompter`（Tauri v2，Rust + Vite，Windows 11 开发 → Android arm64 目标）
> 本机实测环境（2026-10-25 核对）：
> - Tauri CLI **2.11.3**（`node_modules/@tauri-apps/cli`），`tauri` crate **2.11.3**
> - Rust **1.95.0**（host `x86_64-pc-windows-msvc`），已装 target：`aarch64-linux-android` / `armv7-linux-androideabi` / `i686-linux-android` / `x86_64-linux-android`
> - Android SDK：`D:\Android\Sdk`（`ANDROID_HOME` / `ANDROID_SDK_ROOT` 均已指向它）
> - NDK：`D:\Android\Sdk\ndk\26.1.10909125`（`.cargo/config.toml` 里的 linker 已指向它）
> - JDK 17：`C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot`（`JAVA_HOME` 已设）
> - build-tools：**35.0.0**（`apksigner.bat` / `zipalign.exe` / `aapt2.exe` 都在这里；34.0.0 其实也带 `apksigner`，但统一用 35.0.0）
> - cmdline-tools `latest`（`apkanalyzer.bat` / `sdkmanager.bat` / `avdmanager.bat`）
> - 模拟器：`D:\Android\Sdk\emulator\emulator.exe`；AVD **`tauri_test`**（x86_64 / Android 14 / google_apis / `hw.gpu.enabled=yes` / `hw.gpu.mode=host`）
> - 系统镜像：`D:\Android\Sdk\system-images\android-34\google_apis\{arm64-v8a,x86_64}`
> - Debug keystore：`C:\Users\28658\.android\debug.keystore`（已存在）
> - **Release keystore（正式发版用这个）**：`C:\Users\28658\.android\teleprompter-release.jks`（口令见 `E:\OpenClaw\teleprompter-keystore.txt`，不入库）
>
> 配套文档：黑屏根因分析见 [`android-build-black-screen.md`](android-build-black-screen.md)。

---

## 0. 先决条件（每次开新终端都要确认）

```powershell
$env:ANDROID_HOME = 'D:\Android\Sdk'
$env:ANDROID_SDK_ROOT = 'D:\Android\Sdk'
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot'
$env:Path = "$env:JAVA_HOME\bin;D:\Android\Sdk\platform-tools;D:\Android\Sdk\build-tools\35.0.0;D:\Android\Sdk\emulator;$env:Path"

cd D:\mySoftware\teleprompter
```

自检：

```powershell
java -version                     # 预期：openjdk version "17.0.19"
& D:\Android\Sdk\platform-tools\adb.exe version
rustup target list --installed    # 预期包含 aarch64-linux-android
```

> **⚠️ 沙箱警告**：在 DSH 这类受限沙箱里跑构建会失败，且**不是项目的问题**：
> - `npm run build` → Vite 加载 `vite.config.ts` 时 `Error: spawn EPERM`（esbuild 子进程被禁）
> - `cargo build` → `error: failed to open: ...\target\release\.cargo-lock / 拒绝访问 (os error 5)`
>
> 验证构建必须用**普通 PowerShell 窗口**执行。

---

## 1. 出包命令与产物路径

### 1.1 标准命令（arm64 单 ABI 交付包）

```powershell
cd D:\mySoftware\teleprompter
npx tauri android build --target aarch64 --apk
```

关键日志（实测）：

```
        Info Using installed NDK: D:\Android\Sdk\ndk\26.1.10909125
        Info Looking up installed tauri packages to check mismatched versions...
     Running beforeBuildCommand `npm run build`
     Info symlinking lib ... in jniLibs dir ...      ← 关键：这一步失败说明软链/开发者模式问题
    Finished  release [optimized] target(s) ...
```

**产物路径（未签名）**：

```
src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk
```

> `--target aarch64` 而**不加** `--split-per-abi` 时，AGP 产出的是 `universal` 目录下的 APK，但里面**只有 arm64-v8a 一个 ABI**（因为只编了一个 target）。本机现存文件：
> `app-universal-release-unsigned.apk` 12,333,934 B。
>
> 想拿到名字直白的 arm64 包，加 `--split-per-abi`：
>
> ```powershell
> npx tauri android build --target aarch64 --apk --split-per-abi
> # → src-tauri\gen\android\app\build\outputs\apk\arm64\release\app-arm64-release-unsigned.apk
> ```
>
> **出包后第一件事**：确认产物时间戳是刚刚，别装到旧包（见 §6.2 坑 2）。

### 1.2 交付包命名与归档

```powershell
$ver = '1.6.0'
$src = 'src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk'
$out = "release\teleprompter-arm64-v$ver.apk"

# 1) 签名（见 §2）—— v1.6.0 起用专用 release 证书，不再是 debug 证书。
#    口令从本机文件读，绝不写进仓库、也不要贴进对话。
$ksPass = (Get-Content 'E:\OpenClaw\teleprompter-keystore.txt' -TotalCount 1).Trim()

# 别名先用 keytool 确认一次（不同机器可能不一样）：
#   & "$env:JAVA_HOME\bin\keytool.exe" -list `
#       -keystore "$env:USERPROFILE\.android\teleprompter-release.jks" -storepass $ksPass
& "D:\Android\Sdk\build-tools\35.0.0\apksigner.bat" sign `
  --ks "$env:USERPROFILE\.android\teleprompter-release.jks" `
  --ks-pass "pass:$ksPass" --key-pass "pass:$ksPass" --ks-key-alias teleprompter `
  --out $out $src

# 2) 顺手清掉 v4 签名旁产物
Remove-Item "$out.idsig" -ErrorAction SilentlyContinue
```

> ⚠️ **别用 debug.keystore 签 v1.6.0 及以后的包。** v1.5.1 是 debug 证书
> （`C=US, O=Android, CN=Android Debug`），v1.6.0 换成了专用 release 证书
> （`CN=teleprompter, OU=Dev, O=teleprompter, L=Shenzhen, ST=Guangdong, C=CN`）。
> Android 要求升级包与已装包同一签名：**装了 v1.6.0 的设备无法覆盖安装 debug 签名的包**，
> 反过来同理。v1.6.0 之后的版本必须继续用 `teleprompter-release.jks`。

最终交付路径：`D:\mySoftware\teleprompter\release\teleprompter-arm64-v<版本号>.apk`
（现存：`release\teleprompter-arm64-v1.6.0.apk`，12,420,497 B，**release 证书签名**；v1.5.1 是 debug 证书）

### 1.3 如果还想在模拟器上测 x86_64 原生 ABI（性能更好）

x86_64 模拟器（`tauri_test`）跑 arm64 包要靠 **ARM 转译层**，慢且不吃 GPU 优化。要原生速度：

```powershell
# rust target 与 linker 已就绪（.cargo/config.toml 里已有 x86_64-linux-android linker）
npx tauri android build --target x86_64 --apk
# → outputs\apk\universal\release\app-universal-release-unsigned.apk（含 lib/x86_64）
```

> 交付物仍然用 arm64 那份；x86_64 包只用于模拟器性能/GPU 验证。

---

## 2. 签名

### 2.1 现状：Tauri CLI 2.11.3 **不会**帮你签 release 包

已核实（读 CLI 二进制字符串 + `tauri android --help`）：

- `tauri android` 只有 `init / dev / build / run` 四个子命令，**没有** `android sign`、**没有** `android keystore`；
- CLI 二进制里只有 `keystore.properties` 这个**文件名**（在 `gen/android/.gitignore` 模板里），没有任何 `apksigner`/`keytool`/`signingConfig` 逻辑。

所以：**release 构建出来一定是 `*-unsigned.apk`，必须自己签。** 未签名的 APK 装不上（`INSTALL_PARSE_FAILED_NO_CERTIFICATES`）。

### 2.2 工具

| 用途 | 工具 | 路径 |
|---|---|---|
| 签名 APK | `apksigner.bat` | `D:\Android\Sdk\build-tools\35.0.0\apksigner.bat`（34.0.0 也有，但统一用 35.0.0） |
| 对齐检查 | `zipalign.exe` | `D:\Android\Sdk\build-tools\35.0.0\zipalign.exe` |
| 生成 keystore | `keytool`（JDK 自带） | `$env:JAVA_HOME\bin\keytool.exe` |
| 查看 APK 信息 | `aapt2.exe` / `apkanalyzer.bat` | 同上 build-tools / cmdline-tools |

### 2.3 Release keystore 在哪、怎么签（v1.6.0 起）

| 项 | 值 |
|---|---|
| store 文件 | `C:\Users\28658\.android\teleprompter-release.jks` |
| store 密码 | **不在仓库里** —— 见本机 `E:\OpenClaw\teleprompter-keystore.txt` |
| key 别名 | `teleprompter`（第一次用前先 `keytool -list` 确认） |
| key 密码 | 同 store 密码 |
| 证书 DN | `CN=teleprompter, OU=Dev, O=teleprompter, L=Shenzhen, ST=Guangdong, C=CN` |
| 证书 SHA-256 | `5dccdb805686d86f4bb3f740ef63361e2236b0f6687bc8914f078271a96e91af` |

签名命令（口令从本机文件读，绝不写进仓库或对话）：

```powershell
$ksPass = (Get-Content 'E:\OpenClaw\teleprompter-keystore.txt' -TotalCount 1).Trim()
& "D:\Android\Sdk\build-tools\35.0.0\apksigner.bat" sign `
  --ks "$env:USERPROFILE\.android\teleprompter-release.jks" `
  --ks-pass "pass:$ksPass" --key-pass "pass:$ksPass" --ks-key-alias teleprompter `
  --out "release\teleprompter-arm64-v1.6.0.apk" `
  "src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk"
```

预期输出：**无输出、退出码 0**（成功时 apksigner 很安静）。同时会在输出目录生成 `<name>.apk.idsig`（v4 签名旁文件，可删）。

**签完必须确认签的是哪把钥匙**（签错钥匙的包用户装不上，且很难事后发现）：

```powershell
& "D:\Android\Sdk\build-tools\35.0.0\apksigner.bat" verify --print-certs "release\teleprompter-arm64-v1.6.0.apk"
# 期望：Signer #1 certificate DN: CN=teleprompter, OU=Dev, ...
# 若看到 CN=Android Debug  -> 签错钥匙了，重签
```

> **历史（仅供理解旧包）**：v1.5.1 及更早用的是 debug keystore
> （`%USERPROFILE%\.android\debug.keystore`，密码 `android`，别名 `androiddebugkey`
> —— 都是 Android 官方默认值，不是机密）。那条路现在**只用于本地临时调试包**，
> 不要用于正式发布：装过 v1.6.0 的设备无法覆盖安装 debug 签名的包。

> 签名必须在 `zipalign` **之后**；AGP 产出的 unsigned APK 已经对齐，直接签即可。
> 如果你用 `zipalign` 手工重排过，顺序是：zipalign → apksigner。

### 2.4 发布用 keystore（正式上架，不能用 debug）

```powershell
# 1) 生成（密码请自行设定，别进仓库）
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -v `
  -keystore "D:\mySoftware\teleprompter\release\teleprompter-release.jks" `
  -alias teleprompter -keyalg RSA -keysize 2048 -validity 10000

# 2) 用它签名
& "D:\Android\Sdk\build-tools\35.0.0\apksigner.bat" sign `
  --ks "D:\mySoftware\teleprompter\release\teleprompter-release.jks" `
  --ks-pass pass:<store密码> --key-pass pass:<key密码> --ks-key-alias teleprompter `
  --out "release\teleprompter-arm64-v1.5.1-release.apk" `
  "src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk"
```

**让 Gradle 直接产出已签名包（可选，省掉 apksigner 手工步骤）**
在 `src-tauri\gen\android\keystore.properties`（该文件已被 `gen/android/.gitignore` 忽略）写：

```properties
keyAlias=teleprompter
keyPassword=<key密码>
storeFile=D:/mySoftware/teleprompter/release/teleprompter-release.jks
storePassword=<store密码>
```

并在 `src-tauri\gen\android\app\build.gradle.kts` 的 `android { }` 里加：

```kotlin
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties()
if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
}

android {
    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
        }
    }
    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
```

> ⚠️ `gen/android` 属于生成目录，`tauri android init` 可能覆盖其中部分文件。每次 init/build 后用
> `git -C D:\mySoftware\teleprompter status --porcelain src-tauri/gen/android` 复查你的手改是否还在。

---

## 3. 验证 APK 本身没坏（不能只看"装上了"）

按顺序执行 6 关，任意一关不过就别装。

### 3.1 ZIP 容器完整性（CRC 全量校验）

```powershell
$apk = 'D:\mySoftware\teleprompter\release\teleprompter-arm64-v1.5.1.apk'
py -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); bad=z.testzip(); print('BAD ENTRY:',bad) if bad else print('ZIP OK: all CRCs valid')" $apk
```

预期：`ZIP OK: all CRCs valid`（`BAD ENTRY:` 后面跟文件名 = 该文件损坏）。

### 3.2 签名有效

```powershell
& "D:\Android\Sdk\build-tools\35.0.0\apksigner.bat" verify --verbose --print-certs $apk
```

本机实测输出（debug 证书）：

```
Verifies
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Verified using v3.1 scheme (APK Signature Scheme v3.1): false
Number of signers: 1
Signer #1 certificate DN: C=US, O=Android, CN=Android Debug
Signer #1 certificate SHA-256 digest: c72d11664e91eea536fdd256eb63ff1f58ad604a9abfd06fb178a075251825c8
Signer #1 key algorithm: RSA
Signer #1 key size (bits): 2048
```

判定标准：
- 第一行必须是 **`Verifies`**（不是 `DOES NOT VERIFY`）；
- `v2 / v3 = true`。**`v1 = false` 属正常**——minSdk 24 不再需要 JAR(v1) 签名，`apksigner` 会自动跳过；
- `Signer #1 certificate DN` 里 `CN=Android Debug` → 用的是 debug keystore；正式包应为你的自定义 DN。

### 3.3 对齐（4 字节对齐，否则 Android 会拒绝安装/性能劣化）

```powershell
& "D:\Android\Sdk\build-tools\35.0.0\zipalign.exe" -c -v 4 $apk | Select-Object -Last 3
```

预期末行：`Verification succesful`（工具原文拼写就是这样，末尾是 `succesful`）。

### 3.4 清单/版本/SDK 正确

```powershell
& "D:\Android\Sdk\build-tools\35.0.0\aapt2.exe" dump badging $apk | Select-Object -First 8
```

本机实测：

```
package: name='com.teleprompter.app' versionCode='1005001' versionName='1.5.1' platformBuildVersionName='16' compileSdkVersion='36' compileSdkVersionCodename='16'
minSdkVersion:'24'
targetSdkVersion:'36'
uses-permission: name='android.permission.INTERNET'
uses-permission: name='android.permission.SYSTEM_ALERT_WINDOW'
uses-permission: name='android.permission.FOREGROUND_SERVICE'
uses-permission: name='android.permission.FOREGROUND_SERVICE_SPECIAL_USE'
application-label:'teleprompter'
```

核对点：`package name` = `com.teleprompter.app`；`versionName` 与 `package.json` 一致；
**`versionCode` 必须比已装的旧包大**，否则升级安装报 `INSTALL_FAILED_VERSION_DOWNGRADE`（当前 1005001）。

### 3.5 ABI 与 native 库齐全

```powershell
# APK 内所有 native 库
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead($apk)
$z.Entries | Where-Object { $_.FullName -like 'lib/*' } | ForEach-Object { "{0}  {1:N0} B" -f $_.FullName, $_.Length }
$z.Dispose()
```

交付的 arm64 包预期**只有一行**：

```
lib/arm64-v8a/libteleprompter_lib.so  9,711,544 B
```

> 多出 `lib/x86_64/...` → 这是 universal 包混了 ABI；只有 `lib/arm64-v8a` 才是纯 arm64 交付物。

### 3.6 项目级体检脚本（防"dev 模式 .so → 空白页"复发）

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\verify-android-apk.ps1 -ApkPath release\teleprompter-arm64-v1.5.1.apk
```

> ⚠️ 本机 **没有 `pwsh`（PowerShell 7）**，只有 `powershell.exe`（5.1）；而且未签名的 .ps1 在
> `RemoteSigned` 策略下会被拒，所以一律用 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File`。
> 脚本同样安装在 `~\.dsh\skills\building-tauri-android-apks\scripts\` 下，可直接用那条路径。

预期末尾：`RESULT: OK - APK looks like a healthy release build.`
它检查三件事：
1. `.so` 里**不含** `proxy_dev_request` / `Failed to request `（= 不是 dev 模式编译）；
2. APK 内 `assets/assets/` 与 `.so` 内嵌资源名完全一致；
3. `.so` 内嵌资源名 == 当前 `dist/assets/` 文件名（前端改了但 crate 没重编会被抓出来）。

失败时脚本 exit 1。

---

## 4. 确认模拟器真的用上了硬件加速

### 4.1 启动模拟器（固定 host GPU）

```powershell
& D:\Android\Sdk\emulator\emulator.exe @tauri_test `
  -gpu host `
  -no-snapshot -no-boot-anim `
  -verbose | Tee-Object C:\Users\28658\AppData\Local\Temp\emu.log
```

> `-gpu host` **必须显式给**。本项目踩过的坑：AVD 里 `hw.gpu.mode=auto` **不会**选 host，即使驱动已升级，
> 仍会落到 `lavapipe` / `SwiftShader` 软件渲染。AVD 配置文件在 `D:\Android\Avd\tauri_test.avd\config.ini`
> （不在仓库内），本机当前值：`hw.gpu.enabled=yes`、`hw.gpu.mode=host`。

### 4.2 判定依据 A：模拟器日志（最硬）

```powershell
# ⚠️ 这几行是「模拟器进程自己的 stdout」，不是 Android logcat —— 要看 emu.log（§4.1 里的 Tee-Object 输出）
Get-Content "$env:TEMP\emu.log" | Select-String -Pattern 'emuglConfig_init|Selecting Vulkan device|hasSufficientHostVulkanDriver'
```

**硬件加速（host GPU，NVIDIA RTX 3050）** —— 这是本机实测到的正确输出：

```
emuglConfig_init: vulkan_mode_selected:host gles_mode_selected:host
Selecting Vulkan device: NVIDIA GeForce RTX 3050 Laptop GPU, Version: 1.4.351
Graphics API Version OpenGL ES 3.0 (4.5.0 NVIDIA 617.42)
```

**软件渲染（错误状态）** —— 出现以下任一关键字即判定为未加速：

```
hasSufficientHostVulkanDriver: unsupported driver version (527.58.0, min required: 553.35.0)
vulkan_mode_selected:swiftshader gles_mode_selected:swiftshader
lavapipe
SwiftShader
```

### 4.3 判定依据 B：SurfaceFlinger 的 GLES 实现

```powershell
& D:\Android\Sdk\platform-tools\adb.exe shell dumpsys SurfaceFlinger | Select-String -Pattern 'GLES'
```

- 硬件：`GLES: OpenGL ES 3.1 (4.5.0 NVIDIA 617.42)` / 出现真实 GPU 厂商名
- 软件：出现 `SwiftShader`、`llvmpipe`、`lavapipe`

### 4.4 判定依据 C：模拟器控制台 `get gpu mode`

```powershell
$c = New-Object System.Net.Sockets.TcpClient('127.0.0.1', 5554)
$s = $c.GetStream(); $w = New-Object System.IO.StreamWriter($s); $w.NewLine = "`n"
$w.WriteLine('get gpu mode'); $w.Flush()
Start-Sleep -Milliseconds 500
$r = New-Object System.IO.StreamReader($s); $r.ReadToEnd()
$c.Close()
```

预期：`host`（= 硬件）；`swiftshader` / `off` / `auto` 即为未真正启用 host。

> 端口不一定是 5554：先看 `adb devices` 的 `emulator-5554` 对应端口，或在模拟器窗口
> `Help → Show Emulator Toolbar` 里查看。

### 4.5 判定依据 D：App 冷启动耗时（量化）

```powershell
& D:\Android\Sdk\platform-tools\adb.exe shell am start -W -n com.teleprompter.app/.MainActivity
```

本项目实测：
- 软件渲染（SwiftShader）：`TotalTime: 9456` ms（慢 10 倍，且系统会弹 `System UI isn't responding` ANR）
- 硬件加速（host GPU）：`TotalTime: 954` ms

**`TotalTime` 差一个数量级 = 硬件加速是否生效的最终判决。**

### 4.6 判定依据 E：WebView 自身的 GPU 状态

1. **release 包就能连**（本项目已实测：Tauri v2 在 Android 上的 WebView 一直暴露
   `@webview_devtools_remote_<pid>` socket，**不需要** debug 包、不需要改代码）；
2. 电脑上开 `chrome://inspect`，或直接：
   ```powershell
   & D:\Android\Sdk\platform-tools\adb.exe shell cat /proc/net/unix | Select-String 'devtools'
   # → @webview_devtools_remote_2075
   & D:\Android\Sdk\platform-tools\adb.exe forward tcp:9222 localabstract:webview_devtools_remote_2075
   ```
3. `chrome://inspect` → 选中 target → 打开 `chrome://gpu`，看 **Graphics Feature Status**：
   - `WebGL: Hardware accelerated` / `Canvas: Hardware accelerated` → 硬件加速
   - `Software only, hardware acceleration unavailable` → 软件渲染

---

## 5. 装上去是空白页 / 黑屏 —— 具体定位流程

> 目标：**定位到根因**，不是"清缓存重试"。
> 完整根因分析见 [`android-build-black-screen.md`](android-build-black-screen.md)，这里是可执行的分叉流程。

### 第 0 步：先把"装上了"和"跑起来了"分开确认

```powershell
$adb = 'D:\Android\Sdk\platform-tools\adb.exe'
& $adb install -r -d 'D:\mySoftware\teleprompter\release\teleprompter-arm64-v1.5.1.apk'
# 预期：Success
# 若报 INSTALL_FAILED_NO_MATCHING_ABIS → ABI 不匹配（见 §6.2 坑 3）
# 若报 INSTALL_PARSE_FAILED_NO_CERTIFICATES → 没签名（§2）

& $adb shell pm path com.teleprompter.app
# 预期：package:/data/app/.../base.apk

& $adb logcat -c
& $adb shell am start -n com.teleprompter.app/.MainActivity
Start-Sleep -Seconds 3
```

### 第 1 步：是"没渲染"还是"渲染了但是黑的"？—— 看无障碍树

```powershell
& $adb shell uiautomator dump /sdcard/ui.xml
& $adb shell cat /sdcard/ui.xml > "$env:TEMP\ui.xml"
Get-Content "$env:TEMP\ui.xml" | Select-String 'WebView|text='
```

- **WebView 节点有子节点、有中文 text（"重置""悬浮""预设"…）** → 页面**已经渲染**，黑屏是样式/主题问题 → 跳到第 5 步。
- **WebView 节点为空、没有任何 text** → 页面**根本没渲染** → 继续第 2 步。

### 第 2 步：进程活着吗？崩溃吗？

```powershell
& $adb shell pidof com.teleprompter.app                      # 有 PID = 进程活着
& $adb logcat -d -s AndroidRuntime:E libc:F DEBUG:E      # 有 FATAL EXCEPTION = 崩溃
& $adb shell dumpsys activity top | Select-String 'RustWebView|ACTIVITY'   # 看 WebView 尺寸
```

- 有 `FATAL EXCEPTION` → 是原生崩溃，按栈里的 `libteleprompter_lib.so` 符号反查；
- `RustWebView{... 0,0-1080,2340}` 满屏但页面空 → 继续第 3 步。

### 第 3 步：WebView 到底加载了什么？（**决定性一步**）

```powershell
& $adb shell cat /proc/net/unix | Select-String 'webview_devtools_remote'
# → @webview_devtools_remote_2075（pid 可能变）

& $adb forward tcp:9222 localabstract:webview_devtools_remote_2075
Invoke-RestMethod http://127.0.0.1:9222/json/list | Format-List title,url,type
```

| 观察到的 `title` / `url` | 结论 | 根因方向 |
|---|---|---|
| `title = 词悬浮`，`url = http://tauri.localhost/` | **index.html 已解析**，页面正常 | 不是加载问题 → 第 5 步（样式/主题） |
| `title = tauri.localhost`，`url = http://tauri.localhost/`，且页面 body 是 `Failed to request http://tauri.localhost/: error sending request...` | **Tauri 的 dev 代理分支在跑** | `.so` 是 **dev 模式**编译（缺 `custom-protocol` feature）→ §6.2 坑 1 |
| `url = http://localhost:1421/` | 指向 dev server | 装的是 debug 包 / 没开 `custom-protocol` |
| `net::ERR_CONNECTION_REFUSED` | 代理到不存在的服务器 | 同上 |
| 列表里**根本没有** target | WebView 没起来 | WebView provider 缺失（见 §6.2 坑 7） |

判定 dev 模式（最直接的铁证，在 PC 上跑）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\verify-android-apk.ps1 -ApkPath release\teleprompter-arm64-v1.5.1.apk
# 报 "Native library was built in DEV mode" → 根因确认
```

### 第 4 步：如果 DevTools 连不上（socket 根本不存在）

正常情况下 **release 包也有这个 socket**（本项目在 release APK 上实测可用）。只有在
`/proc/net/unix` 里查不到 `webview_devtools_remote` 时，才需要额外手段：

- 用 **debug** 包复现：把 `src-tauri\gen\android\app\src\main\java\com\teleprompter\app\MainActivity.kt` 里
  `super.onCreate(savedInstanceState)` 前加一行 `WebView.setWebContentsDebuggingEnabled(true)`（**仅调试用，勿提交**）；
- 或直接抓 Rust 侧日志：`& $adb logcat -d | Select-String 'teleprompter|tauri|rust'`，项目里 `eprintln!` 的内容会出现在 `stderr` tag。

### 第 5 步：页面渲染了但看不见（黑/白底）

```powershell
& $adb shell dumpsys gfxinfo com.teleprompter.app | Select-String 'Total frames|Janky|Stats since'
```

- `Total frames rendered` = 0 → 根本没画（回到第 1 步）；
- 有帧但看不到 → 查主题/背景：本项目 `tauri.conf.json` 里 `transparent: true` 在 **Android 上不生效**
  （Tauri v2 的移动端 WebView 不支持透明窗口），`html, body { background: #000 }` 之类样式需自行适配；
  另外 release 包 `usesCleartextTraffic=false`，任何 `http://` 外链都会被拦。

### 第 6 步：Release 才黑、Debug 正常 → 怀疑 R8/Proguard

```powershell
Get-Content src-tauri\gen\android\app\proguard-rules.pro
Get-Content src-tauri\gen\android\app\proguard-tauri.pro
```

release build 有 `isMinifyEnabled = true`；若 JS 桥相关类被裁掉，表现就是白屏但无崩溃。
处理：在 `app/proguard-rules.pro` 里 keep 掉 WebView/JS 桥接类，然后重出包。

### 第 7 步：确认不是"装到旧包"

```powershell
Get-Item release\teleprompter-arm64-v1.5.1.apk | Select Name,Length,LastWriteTime
Get-Item src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk | Select Name,Length,LastWriteTime
& $adb shell dumpsys package com.teleprompter.app | Select-String 'versionCode|lastUpdateTime|codePath'
```

对比 `lastUpdateTime` 与本地 APK 时间戳。若模拟器里是旧包 → `adb uninstall com.teleprompter.app` 后重装
（**这一步不是"清缓存重试"，而是排除"装错包"这个具体假设**）。

### 第 8 步：崩溃兜底

```powershell
& $adb shell dumpsys dropbox --print data_app_crash | Select-Object -Last 60
```

---

## 6. Tauri 项目在 Android 上特别容易踩的坑

### 6.1 ★ Rust 库必须是 release + `custom-protocol`（本项目已踩过的头号坑）

`src-tauri/Cargo.toml` 里 `tauri = { version = "2", features = [] }`——`custom-protocol` **默认是关的**，
由 Tauri CLI 在 release 构建时通过 `--features custom-protocol` 注入（实测 CLI 执行的 cargo 命令里能看到
`--features "tauri/custom-protocol tauri/custom-protocol"`）。

**一旦漏掉**：`tauri` 的 build.rs 把 `cfg(dev)` 置真 → 移动端走 `proxy_dev_request`，把所有请求
反代到 Vite dev server → 模拟器里没有 dev server → **整页空白**。

规则：
- 出包**只用** `npx tauri android build ...`，不要手工 `cargo build --release` 后拷 `.so`；
- 每包必跑 `scripts/verify-android-apk.ps1`（它就是查 `.so` 里有没有 `proxy_dev_request`）。

### 6.2 ★ Windows 上"软链失败"会伪装成"旧包"（本项目真实根因之一）

Tauri CLI 最后一步要把 `target/<arch>/release/libteleprompter_lib.so` **软链**到
`gen/android/app/src/main/jniLibs/<abi>/`。普通 Windows 用户没有 `SeCreateSymbolicLinkPrivilege`，
软链失败 → 打包阶段中断 → **但 Rust 早已编译成功** → 于是 `release/` 里的旧 APK 一直没被更新，
大家反复装的是旧包。报错原文：

```
failed to create a symbolic link from "...target\aarch64-linux-android\release\libteleprompter_lib.so" to
"...gen/android/app/src/main/jniLibs\arm64-v8a\libteleprompter_lib.so"
Creation symbolic link is not allowed for this system. You should use developer mode.
```

修复（管理员 PowerShell，一次性）：

```powershell
$p = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock'
if (-not (Test-Path $p)) { New-Item -Path $p -Force | Out-Null }
Set-ItemProperty -Path $p -Name 'AllowDevelopmentWithoutDevLicense' -Value 1 -Type DWord
```

**防复发**：每次出包后核对 `Get-Item ...\app-universal-release-unsigned.apk | Select LastWriteTime`
和命令退出码（`$LASTEXITCODE`），别只看"安装成功"。

### 6.3 ★ ABI 与模拟器不匹配

- 交付物是 arm64；`tauri_test` 是 **x86_64** AVD。Android 11+ 的 x86_64 google_apis 镜像带 ARM 转译层，
  `ro.product.cpu.abilist = x86_64,arm64-v8a`，所以 arm64 包**能装能跑**，但走的是转译，性能差。
  想吃满 GPU/性能 → 用 `--target x86_64` 另外出一个包用于模拟器测试。
- 反向坑：**arm64 系统镜像**（`system-images\android-34\google_apis\arm64-v8a`）在 x86_64 Windows 主机上是
  全模拟，**拿不到硬件加速**，此时 §4 的判定必然是 SwiftShader——这不是配置错，是平台限制。

### 6.4 `gen/android` 是"半生成目录"，手改会被冲掉

本项目**手改过** `gen/android/app/src/main/AndroidManifest.xml`（加了 `SYSTEM_ALERT_WINDOW`、
`FOREGROUND_SERVICE_SPECIAL_USE`、`.FloatingWindowService`、`supportsPictureInPicture`），
并新增了 `app/src/main/java/com/teleprompter/app/FloatingWindowService.kt`。

`tauri android init` / build 期间 CLI 会重写其中若干文件（`app/build.gradle.kts`、`tauri.build.gradle.kts`、
`tauri.properties`、`tauri.settings.gradle`、`AndroidManifest.xml` 模板等）。**每次 build 后**：

```powershell
git -C D:\mySoftware\teleprompter status --porcelain src-tauri/gen/android
```

如果你的手改没了（Manifest 里 `FloatingWindowService` 消失 → Gradle 报 `Class referenced in the manifest was not found`），
说明被模板覆盖了，需要重新 patch。

### 6.5 `tauri android dev` 在移动端连不上 dev server

`vite.config.ts` 把端口固定成 **1421**（`server.port: 1421, strictPort: true`），
而 Tauri 移动端 dev 默认连 **1420**。症状：`tauri android dev` 起来后 WebView 白屏/连不上。
修法（`src-tauri/tauri.conf.json`）：

```json
"build": { "devUrl": "http://localhost:1421", "beforeDevCommand": "npm run dev" }
```

（Windows 上 `localhost` 要用 `http://10.0.2.2:1421` 吗？——不需要，Android 模拟器里的 `localhost`
指的是模拟器自身；Tauri CLI 会自己处理设备地址映射，实测该项目的 dev 流程用 `localhost` 即可，
若连不上再改 `10.0.2.2`。）

### 6.6 桌面端配置在 Android 上被忽略

`tauri.conf.json` 的 `app.windows` 里的 `transparent` / `decorations` / `alwaysOnTop` / `skipTaskbar`、
以及 HTML 里的 `data-tauri-drag-region`，在 Android 上**基本无效**（移动端是单个全屏 Activity）。
本项目 UI 依赖"桌面悬浮窗"语义，Android 端观感要单独调（背景色、WebView 背景、沉浸式
`enableEdgeToEdge()` 会带来刘海/手势条遮挡——`MainActivity.kt` 已调用它，布局要加 `viewport-fit=cover` 适配）。

### 6.7 插件权限与 scope 是两回事

`src-tauri/capabilities/default.json` 里给了 `fs:default`、`fs:allow-read-text-file`，
但 **fs 插件默认 scope 是空的**（未配置 scope 时只能读 scope 内路径）。
Android 上 `dialog` 插件返回的可能是 `content://` URI，`fs` 读不了 → "导入文件"功能在 Android 上可能失败，
需要额外 scope 或改用插件自带的 Android 实现。capability 文件里建议显式加
`"platforms": ["android"]` 限定，或为移动端单独建一份 capability。

### 6.8 16 KB 页面对齐（上架要求，Android 15+）

Google Play 要求 targetSdk 35+ 的原生库支持 16 KB page size。本项目 NDK 是 **26.1.10909125**，
属于旧版本；上架前应升到 **NDK r27+**（或 r26 + `-Wl,-z,max-page-size=16384`），
并同步更新 `src-tauri/.cargo/config.toml` 里的 linker 路径（现在写死了
`ndk/26.1.10909125/.../aarch64-linux-android24-clang.cmd`）。**升级 NDK 一定要同步改这个路径**，
否则构建会直接失败。

### 6.9 `tauri android init` 的版本一致性

CLI 会检查 npm 侧 `@tauri-apps/*` 与 Cargo 侧 `tauri-*` crate 版本是否一致，不一致直接报错。
本机当前：CLI 2.11.3 / tauri crate 2.11.3 / plugin-dialog 2.7.1 / plugin-fs 2.5.1，一致。
若确实只是构建元数据差异，可用 `--ignore-version-mismatches`，但**不要长期依赖**。

### 6.10 minSdk / targetSdk / 权限

- `minSdk = 24`、`targetSdk = 36`、`compileSdk = 36`（`gen/android/app/build.gradle.kts`）。
- Android 12+ 必须有 `android:exported`（模板已处理）。
- Android 13+ 通知、14+ 前台服务类型（`FOREGROUND_SERVICE_SPECIAL_USE`）——本项目的悬浮窗服务用到了，
  少一个权限就会在**运行时**被系统杀掉（不是安装时报错），表现为"悬浮窗点了没反应"。

### 6.11 Rust 代码里的平台差异

`src-tauri/src/lib.rs` 用了 `app.path().app_cache_dir()`（跨平台 OK），但 `Cargo.toml` 里的 `dirs` 5 在
Android 上语义有限（拿不到标准用户目录），若后续用它存配置需改成 `app.path().app_config_dir()`。
另外 `#[cfg_attr(mobile, tauri::mobile_entry_point)]` **必须保留**（已在 `lib.rs:30`），否则 Android 端没有入口。

---

## 7. 一键流水线（可直接粘贴执行）

```powershell
# ===== 出包 =====
cd D:\mySoftware\teleprompter
$env:ANDROID_HOME='D:\Android\Sdk'; $env:JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot'
npx tauri android build --target aarch64 --apk
if ($LASTEXITCODE -ne 0) { throw "tauri android build failed ($LASTEXITCODE)" }

# ===== 签名 =====
$src='src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk'
$out='release\teleprompter-arm64-v1.5.1.apk'
& "D:\Android\Sdk\build-tools\35.0.0\apksigner.bat" sign `
  --ks "$env:USERPROFILE\.android\teleprompter-release.jks" `
  --ks-pass "pass:$ksPass" --key-pass "pass:$ksPass" --ks-key-alias teleprompter --out $out $src
#   ^ v1.6.0 起用 release 证书；口令见 E:\OpenClaw\teleprompter-keystore.txt（§2.3）
if ($LASTEXITCODE -ne 0) { throw "apksigner failed" }

# ===== 静态自检 =====
py -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip() or 'ZIP OK')" $out
& "D:\Android\Sdk\build-tools\35.0.0\apksigner.bat" verify --verbose --print-certs $out | Select-Object -First 4
& "D:\Android\Sdk\build-tools\35.0.0\zipalign.exe" -c -v 4 $out | Select-Object -Last 1
& "D:\Android\Sdk\build-tools\35.0.0\aapt2.exe" dump badging $out | Select-Object -First 2
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\verify-android-apk.ps1 -ApkPath $out

# ===== 安装 + 启动 =====
$adb='D:\Android\Sdk\platform-tools\adb.exe'
& $adb install -r -d $out
& $adb shell am start -W -n com.teleprompter.app/.MainActivity

# ===== 硬件加速判定 =====
# 模拟器侧的 GPU 选择结果在模拟器自己的 stdout 里（§4.1 存下来的 emu.log）
Get-Content "$env:TEMP\emu.log" -ErrorAction SilentlyContinue | Select-String 'emuglConfig_init|Selecting Vulkan device'
# 设备侧的真实渲染器看这里
& $adb shell dumpsys SurfaceFlinger | Select-String 'GLES'
```

---

## 8. 附录：本机关键路径速查

| 用途 | 路径 |
|---|---|
| Android SDK | `D:\Android\Sdk` |
| NDK | `D:\Android\Sdk\ndk\26.1.10909125` |
| apksigner / zipalign / aapt2 | `D:\Android\Sdk\build-tools\35.0.0\`（34.0.0 也有 apksigner，但统一用 35.0.0） |
| adb / emulator | `D:\Android\Sdk\platform-tools\`、`D:\Android\Sdk\emulator\` |
| AVD | `D:\Android\Avd\tauri_test.avd\config.ini`（`hw.gpu.mode=host`） |
| Debug keystore | `C:\Users\28658\.android\debug.keystore`（alias `androiddebugkey` / pass `android`） |
| **Release keystore** | `C:\Users\28658\.android\teleprompter-release.jks`（alias `teleprompter`，口令见本机文件）—— 正式发版用它 |
| Rust linker 配置 | `D:\mySoftware\teleprompter\src-tauri\.cargo\config.toml` |
| Gradle 工程 | `D:\mySoftware\teleprompter\src-tauri\gen\android\` |
| 未签名 APK | `src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk` |
| 已签名交付包 | `D:\mySoftware\teleprompter\release\teleprompter-arm64-v1.5.1.apk` |
| 自检脚本 | `D:\mySoftware\teleprompter\scripts\verify-android-apk.ps1` |
| 黑屏根因文档 | `D:\mySoftware\teleprompter\docs\android-build-black-screen.md` |
