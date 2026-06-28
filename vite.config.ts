import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Public demo SPA. `base` is the GitHub Pages repo subpath; `import.meta.env.BASE_URL`
// (used by src/lib/demo.ts -> demoAssetUrl) resolves baked /demo assets against it.
// Build output goes to docs/ and is committed; GitHub Pages serves it directly from
// the chosen branch (Settings -> Pages -> Deploy from a branch -> <branch> -> /docs).
// No CI: build locally with `npm run build`, then commit docs/.
//
// CHANGEME: set `base` to "/<your-repo-slug>/".
export default defineConfig({
  base: "/dead-data-cleaner-poc/",
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: ["react", "react-dom"] },
  build: { outDir: "docs", emptyOutDir: true },
  server: { port: 4173, strictPort: true },
});
