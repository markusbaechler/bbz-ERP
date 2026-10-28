<#
.SYNOPSIS
  Analysiert den Funktionsumfang einer FileMaker-Loesung und oeffnet den Bericht.
  Weg A: Datenbank-Designreport (XML).  Weg C: Data API des FileMaker Servers (ohne FileMaker-Oberflaeche).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\fm-analyse\fm-analyse.ps1 -DdrPfad "$env:USERPROFILE\Documents\bbz-DDR"
.EXAMPLE
  ... -DdrPfad "$env:USERPROFILE\Documents\bbz-DDR" -Zip   # zusaetzlich bbz-DDR.zip fuer Google Drive erzeugen
.EXAMPLE
  ... -Server "https://bbz-az-srvapp01.example.ch" -Datenbank Projekte,Seminare -Benutzer analyse   # Passwort wird verdeckt abgefragt
#>
[CmdletBinding(DefaultParameterSetName = "Ddr")]
param(
  [Parameter(Mandatory = $true, ParameterSetName = "Ddr")][string]$DdrPfad,
  [Parameter(ParameterSetName = "Ddr")][switch]$Zip,
  [Parameter(Mandatory = $true, ParameterSetName = "DataApi")][string]$Server,
  [Parameter(Mandatory = $true, ParameterSetName = "DataApi")][string[]]$Datenbank,
  [Parameter(Mandatory = $true, ParameterSetName = "DataApi")][string]$Benutzer,
  [Parameter(ParameterSetName = "DataApi")][ValidateSet("v1", "v2", "vLatest")][string]$ApiVersion = "v1",
  [Parameter(ParameterSetName = "DataApi")][switch]$OhneAnzahl,
  [string]$Ausgabe = "fm-analyse-out",
  [switch]$MitKonten
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")

if ($PSCmdlet.ParameterSetName -eq "Ddr") {
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
  $argsListe = @("tsx", "tools/fm-analyse/cli.ts", $DdrPfad, "--out", $Ausgabe)
} else {
  $argsListe = @("tsx", "tools/fm-analyse/cli.ts", "--data-api", $Server, "--benutzer", $Benutzer, "--api-version", $ApiVersion, "--out", $Ausgabe)
  foreach ($db in $Datenbank) { $argsListe += @("--datenbank", $db) }
  if ($OhneAnzahl) { $argsListe += "--ohne-anzahl" }
  # Passwort verdeckt abfragen und nur fuer den Kindprozess in die Umgebung legen (nie als Argument)
  $sicher = Read-Host -AsSecureString "FileMaker-Passwort fuer $Benutzer"
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sicher)
  try { $env:FM_PASSWORT = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if ($MitKonten) { $argsListe += "--mit-konten" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js fehlt (https://nodejs.org, LTS)" }
Push-Location $repo
try {
  if (-not (Test-Path "node_modules")) { npm install --no-audit --no-fund | Out-Null }
  npx @argsListe
  if ($LASTEXITCODE -ne 0) { throw "Analyse fehlgeschlagen" }
  $bericht = Join-Path $repo (Join-Path $Ausgabe "FUNKTIONSUMFANG.md")
  Write-Host "Bericht: $bericht"
  if (Test-Path $bericht) { Invoke-Item $bericht }
} finally {
  Remove-Item Env:FM_PASSWORT -ErrorAction SilentlyContinue
  Pop-Location
}
