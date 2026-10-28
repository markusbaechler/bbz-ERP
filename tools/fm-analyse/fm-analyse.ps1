<#
.SYNOPSIS
  Wertet einen FileMaker-Datenbank-Designreport (XML) aus und oeffnet den Bericht.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\fm-analyse\fm-analyse.ps1 -DdrPfad "$env:USERPROFILE\Documents\bbz-DDR"
.EXAMPLE
  ... -DdrPfad "$env:USERPROFILE\Documents\bbz-DDR" -Zip   # zusaetzlich bbz-DDR.zip fuer Google Drive erzeugen
#>
param(
  [Parameter(Mandatory = $true)][string]$DdrPfad,
  [string]$Ausgabe = "fm-analyse-out",
  [switch]$MitKonten,
  [switch]$Zip
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")

if (-not (Test-Path $DdrPfad)) { throw "DDR-Pfad nicht gefunden: $DdrPfad" }
if (-not (Get-ChildItem -Path $DdrPfad -Filter *.xml -Recurse)) { throw "Keine XML-Dateien in $DdrPfad (Berichtsformat XML gewaehlt?)" }

# Laeuft FileMaker? (nur Hinweis: der DDR erfasst nur geoeffnete Dateien)
$fm = Get-Process | Where-Object { $_.ProcessName -like "FileMaker*" }
foreach ($p in $fm) { Write-Host ("FileMaker-Fenster: " + $p.MainWindowTitle) }

if ($Zip) {
  $zipPfad = Join-Path (Split-Path $DdrPfad -Parent) ((Split-Path $DdrPfad -Leaf) + ".zip")
  Compress-Archive -Path (Join-Path $DdrPfad "*") -DestinationPath $zipPfad -Force
  Write-Host "ZIP fuer Google Drive: $zipPfad"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js fehlt (https://nodejs.org, LTS)" }
Push-Location $repo
try {
  if (-not (Test-Path "node_modules")) { npm install --no-audit --no-fund | Out-Null }
  $argsListe = @("tsx", "tools/fm-analyse/cli.ts", $DdrPfad, "--out", $Ausgabe)
  if ($MitKonten) { $argsListe += "--mit-konten" }
  npx @argsListe
  if ($LASTEXITCODE -ne 0) { throw "Analyse fehlgeschlagen" }
  $bericht = Join-Path $repo (Join-Path $Ausgabe "FUNKTIONSUMFANG.md")
  Write-Host "Bericht: $bericht"
  if (Test-Path $bericht) { Invoke-Item $bericht }
} finally {
  Pop-Location
}
