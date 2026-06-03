import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// The web app (coach.small-victories.co/app). Built to dist/app and served by
// the coach-app Express service. Separate from the Svelte plan-viewer build.
export default defineConfig({
  plugins: [react()],
  root: "src/app",
  base: "/app/",
  build: {
    outDir: resolve(__dirname, "dist/app"),
    emptyOutDir: true,
  },
});
