#!/bin/bash
# Referral Scout installer for macOS (Microsoft Edge or Google Chrome).
#
# Downloads the extension, unpacks it into your user Library, copies that folder's path to the clipboard and opens
# the browser's extensions page. Browsers never let a script switch on an extension that is not from their store (a
# protection against malware), so the last two clicks are yours: turn on "Developer mode", then "Load unpacked".
#
# No administrator rights (sudo) are needed. Run it again later to update, then press "Reload" on the extension.
#
# Run:  bash install-mac.sh

set -euo pipefail

VERSION="0.58.2"
URL="https://github.com/arpitsingh6055/Referral-Scout/releases/download/v${VERSION}/referral-scout-${VERSION}.zip"
ROOT="$HOME/Library/Application Support/ReferralScout"
TARGET="$ROOT/extension"

if [ "$(id -u)" -eq 0 ]; then
  echo "Please run this without sudo: the extension belongs in your own user folder." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading Referral Scout ${VERSION}..."
curl -fL --progress-bar "$URL" -o "$TMP/referral-scout.zip"

mkdir -p "$TMP/unpacked"
unzip -q "$TMP/referral-scout.zip" -d "$TMP/unpacked"
if [ ! -f "$TMP/unpacked/manifest.json" ]; then
  echo "The download does not look like the Referral Scout extension (no manifest.json inside)." >&2
  exit 1
fi

# Always the same folder, so a browser that already has it loaded only needs "Reload" after an update.
mkdir -p "$ROOT"
rm -rf "$TARGET"
mv "$TMP/unpacked" "$TARGET"
printf '%s' "$TARGET" | pbcopy

PAGE="edge://extensions (or chrome://extensions)"
if [ -d "/Applications/Microsoft Edge.app" ]; then
  open -a "Microsoft Edge" "edge://extensions" || true
  PAGE="edge://extensions"
elif [ -d "/Applications/Google Chrome.app" ]; then
  open -a "Google Chrome" "chrome://extensions" || true
  PAGE="chrome://extensions"
fi

cat <<EOF

Referral Scout ${VERSION} is unpacked in:
  ${TARGET}
(This path is already copied to your clipboard.)

Two clicks left, on the extensions page that just opened:
  1. Turn on "Developer mode" (a switch at the top right or on the left). If the page did not open, go to ${PAGE}.
  2. Click "Load unpacked". In the window that opens, press Cmd+Shift+G, paste the path (Cmd+V), press Return,
     then click "Select".

Then pin Referral Scout from the puzzle-piece menu and click it to open the side panel.
To update later: run this script again, then press Reload on Referral Scout in the extensions page.
EOF
