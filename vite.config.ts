import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";
const manifestPlugin: Plugin = {
  name: "extension-manifest",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "manifest.json", source: readFileSync("manifest.json", "utf8") });
  }
};

export default defineConfig(({ mode }) => mode === "content" ? {
  publicDir: false,
  build: {
    emptyOutDir: false, target: "chrome120",
    lib: { entry: "src/content/onboarding.ts", name: "ColdContactSetup", formats: ["iife"], fileName: () => "health.js" }
  }
} : {
  base: "./",
  plugins: [manifestPlugin],
  build: {
    target: "chrome120",
    rollupOptions: {
      input: { options: "options.html", sidepanel: "sidepanel.html", onboarding: "onboarding.html", "service-worker": "src/background/service-worker.ts" },
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js" }
    }
  }
});
