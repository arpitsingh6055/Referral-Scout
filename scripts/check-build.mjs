import { readFile, access, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.host_permissions, ["https://www.linkedin.com/*", "https://linkedin.com/*", "https://chatgpt.com/*"]);
assert(!manifest.optional_host_permissions?.length, "The LinkedIn build must not request broad website access");
for (const file of [manifest.background.service_worker,
  manifest.side_panel.default_path, ...manifest.content_scripts.flatMap(s => s.js),
  ...Object.values(manifest.icons ?? {})]) {
  await access(`dist/${file}`);
}
async function inspect(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${item.name}`;
    if (item.isDirectory()) await inspect(file);
    else if (file.endsWith(".js")) {
      const code = await readFile(file, "utf8");
      assert(!/\beval\s*\(|new\s+Function\s*\(|import\s*\(\s*['"]https?:/.test(code), `Unsafe code in ${file}`);
    }
  }
}
await inspect("dist");
console.log("MV3 entry points exist; no eval, Function constructor, or remote dynamic imports found.");
