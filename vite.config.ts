import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

// Build-time injection of the actual packaging date (not the runtime clock).
// See src/globals.d.ts for the matching TypeScript declaration.
const BUILD_DATE = new Date().toISOString().slice(0, 10);

// 版本号从 tauri.conf.json 读，而不是再抄一份到源码里。
// 展示出来的版本必须等于真正打进包里的版本（Tauri 用它生成 versionName），
// 所以源头就取这个文件；以前 main.ts 里那份硬编码的 APP_VERSION 改版本时
// 极易漏改，就会出现「界面显示 1.5.1、装的是 1.6.0」——正是顶部版本号要防的事。
const APP_VERSION = JSON.parse(
  readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf-8"),
).version as string;

export default defineConfig({
  // Inject BUILD_DATE / APP_VERSION as literal strings so the bundled JS
  // contains them as constants rather than reading the runtime clock.
  define: {
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
  },
});
