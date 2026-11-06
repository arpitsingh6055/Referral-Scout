import { access, rm, rename } from "node:fs/promises";
import { execFileSync } from "node:child_process";

await access("dist/manifest.json");
await rm("cold-contact-pro.zip.pending", { force: true });

if (process.platform === "win32") {
  execFileSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference = 'Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::CreateFromDirectory((Join-Path (Get-Location) 'dist'), (Join-Path (Get-Location) 'cold-contact-pro.zip.pending'))"
  ], { stdio: "inherit" });
} else {
  execFileSync("zip", ["-qr", "../cold-contact-pro.zip.pending", "."], { cwd: "dist", stdio: "inherit" });
}

await access("cold-contact-pro.zip.pending");
await rm("cold-contact-pro.zip", { force: true });
await rename("cold-contact-pro.zip.pending", "cold-contact-pro.zip");

console.log("Created cold-contact-pro.zip");
