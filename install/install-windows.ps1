# Referral Scout installer for Windows (Microsoft Edge or Google Chrome).
#
# Downloads the extension, unpacks it into your user folder, copies that folder's path to the clipboard and opens the
# browser's extensions page. Browsers never let a script switch on an extension that is not from their store (a
# protection against malware), so the last two clicks are yours: turn on "Developer mode", then "Load unpacked".
#
# No administrator rights are needed. Run it again later to update, then press "Reload" on the extension.
#
# Run:  right-click this file > "Run with PowerShell"
#   or: powershell -ExecutionPolicy Bypass -File install-windows.ps1

$ErrorActionPreference = 'Stop'
$Version = '0.45.5'
$Url = "https://github.com/arpitsingh6055/Referral-Scout/releases/download/v$Version/referral-scout-$Version.zip"
$Root = Join-Path $env:LOCALAPPDATA 'ReferralScout'
$Target = Join-Path $Root 'extension'
$Staging = Join-Path $Root 'staging'
$Zip = Join-Path $env:TEMP "referral-scout-$Version.zip"

function Finish([string]$message) {
  if ($message) { Write-Host $message }
  if ($Host.Name -eq 'ConsoleHost') { [void](Read-Host 'Press Enter to close') }
}

try {
  Write-Host "Downloading Referral Scout $Version..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing

  New-Item -ItemType Directory -Force -Path $Root | Out-Null
  if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }
  Expand-Archive -Path $Zip -DestinationPath $Staging -Force
  if (-not (Test-Path (Join-Path $Staging 'manifest.json'))) {
    throw 'The download does not look like the Referral Scout extension (no manifest.json inside).'
  }

  # Always the same folder, so a browser that already has it loaded only needs "Reload" after an update.
  if (Test-Path $Target) { Remove-Item $Target -Recurse -Force }
  Move-Item $Staging $Target
  Remove-Item $Zip -Force -ErrorAction SilentlyContinue
  Set-Clipboard -Value $Target

  $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1

  if ($edge) { Start-Process $edge 'edge://extensions'; $page = 'edge://extensions' }
  elseif ($chrome) { Start-Process $chrome 'chrome://extensions'; $page = 'chrome://extensions' }
  else { $page = 'edge://extensions (or chrome://extensions)' }

  Write-Host ''
  Write-Host "Referral Scout $Version is unpacked in:"
  Write-Host "  $Target"
  Write-Host '(This path is already copied to your clipboard.)'
  Write-Host ''
  Write-Host 'Two clicks left, on the extensions page that just opened:'
  Write-Host "  1. Turn on 'Developer mode' (a switch on the left side or top right). If the page did not open, go to $page."
  Write-Host "  2. Click 'Load unpacked', paste the path into the folder box (Ctrl+V), and choose 'Select Folder'."
  Write-Host ''
  Write-Host 'Then pin Referral Scout from the puzzle-piece menu and click it to open the side panel.'
  Write-Host 'To update later: run this script again, then press Reload on Referral Scout in the extensions page.'
  Finish ''
}
catch {
  Finish "Installation failed: $($_.Exception.Message)"
  exit 1
}
