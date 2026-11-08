import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The bundle is loaded from disk (Tauri) or from the APK's assets (Android),
// never from a web origin. `base: "./"` keeps asset URLs relative to index.html.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
  },
});
