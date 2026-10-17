import { defineConfig } from "vite";

// Build-time injection of the actual packaging date (not the runtime clock).
// See src/globals.d.ts for the matching TypeScript declaration.
const BUILD_DATE = new Date().toISOString().slice(0, 10);

export default defineConfig({
  // Inject BUILD_DATE as a literal string so the bundled JS contains the build
  // date, not the date when the user opens the app.
  define: {
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
  },
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
  },
});
