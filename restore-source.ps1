$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$archiveDir = Join-Path $repoRoot 'archive'
$base64Path = Join-Path $archiveDir 'jiuzhou-multi-account-status-source.zip.base64.txt'
if (-not (Test-Path -LiteralPath $base64Path)) {
  throw "Missing archive file: $base64Path"
}
$zipPath = Join-Path $repoRoot 'jiuzhou-multi-account-status-source.zip'
$extractDir = Join-Path $repoRoot 'restored-source'
$base64 = [IO.File]::ReadAllText($base64Path).Trim()
[IO.File]::WriteAllBytes($zipPath, [Convert]::FromBase64String($base64))
if (Test-Path -LiteralPath $extractDir) {
  Remove-Item -LiteralPath $extractDir -Recurse -Force
}
Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
Write-Host "Restored to: $extractDir"
