import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";
const manifestPlugin: Plugin = {
  name: "extension-manifest",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "manifest.json", source: readFileSync("manifest.json", "utf8") });
  }
};

export default defineConfig(({ mode }) => mode === "preview" ? {
  // A design-review build of the workbench with sample data. Never part of the extension package.
  base: "./",
  build: { outDir: "preview", emptyOutDir: true, target: "chrome120", rollupOptions: { input: { preview: "preview.html" }, output: { inlineDynamicImports: true, entryFileNames: "preview.js", assetFileNames: "preview[extname]" } } }
} : mode === "apply" ? {
  publicDir: false,
  build: {
    emptyOutDir: false, target: "chrome120",
    lib: { entry: "src/content/apply.ts", name: "ReferralScoutApply", formats: ["iife"], fileName: () => "apply.js" }
  }
} : mode === "content" ? {
  publicDir: false,
  build: {
    emptyOutDir: false, target: "chrome120",
    lib: { entry: "src/content/runtime.ts", name: "ReferralScoutRuntime", formats: ["iife"], fileName: () => "health.js" }
  }
} : {
  base: "./",
  plugins: [manifestPlugin],
  build: {
    target: "chrome120",
    // A service worker may not call import(): the HTML specification forbids it, and Vite's preload helper
    // reaches for `document`, which a worker does not have. Both would only fail at runtime, so the worker's
    // code is emitted without either.
    modulePreload: false,
    rollupOptions: {
      input: { sidepanel: "sidepanel.html", workbench: "workbench.html", "service-worker": "src/background/service-worker.ts" },
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js", inlineDynamicImports: false }
    }
  }
});
