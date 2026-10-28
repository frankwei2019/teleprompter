// Build-time injected by vite.config.ts define block.
// Inlined as a literal string at build time; the bundled JS contains the actual
// packaging date, never the user's clock.
declare const __BUILD_DATE__: string;

// App version, injected from src-tauri/tauri.conf.json by vite.config.ts.
// Single source, so the displayed version cannot drift from the version
// actually stamped into the bundle.
declare const __APP_VERSION__: string;