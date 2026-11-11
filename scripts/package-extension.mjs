import { access, rm, rename } from "node:fs/promises";
import { execFileSync } from "node:child_process";

await access("dist/manifest.json");
await rm("referral-scout.zip.pending", { force: true });

if (process.platform === "win32") {
  execFileSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference = 'Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::CreateFromDirectory((Join-Path (Get-Location) 'dist'), (Join-Path (Get-Location) 'referral-scout.zip.pending'))"
  ], { stdio: "inherit" });
} else {
  execFileSync("zip", ["-qr", "../referral-scout.zip.pending", "."], { cwd: "dist", stdio: "inherit" });
}

await access("referral-scout.zip.pending");
await rm("referral-scout.zip", { force: true });
await rename("referral-scout.zip.pending", "referral-scout.zip");

console.log("Created referral-scout.zip");
