# Simple repository security scanner (PowerShell)
# Usage: .\scripts\security-check.ps1

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)  # repo root (one level above scripts)
# If script is moved, fallback to current directory:
if (-not (Test-Path $root)) { $root = Get-Location }

Write-Output "Scanning repo at $root ..."
$jsHtmlFiles = Get-ChildItem -Path $root -Recurse -Include *.js,*.html,*.htm -File | Where-Object { $_.FullName -notmatch '\\node_modules\\' }
$highRiskPatterns = @('eval\s*\(', 'new\s+Function\s*\(', 'document\.write\s*\(')
$warnPatterns = @('innerHTML', 'onclick=', 'localStorage\.setItem\s*\(', 'atob\s*\(')
$high = @()
$warn = @()
foreach ($f in $jsHtmlFiles) {
  $text = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
  foreach ($p in $highRiskPatterns) {
    if ($text -match $p) { $high += [PSCustomObject]@{File=$f.FullName; Pattern=$p} }
  }
  foreach ($p in $warnPatterns) {
    if ($text -match $p) { $warn += [PSCustomObject]@{File=$f.FullName; Pattern=$p} }
  }
}
if ($high.Count -gt 0) {
  Write-Output "HIGH-RISK PATTERNS FOUND:"
  $high | ForEach-Object { Write-Output " - $($_.Pattern) in $($_.File)" }
} else { Write-Output "No high-risk patterns found." }
if ($warn.Count -gt 0) {
  Write-Output "\nWarnings (inspect these):"
  $warn | Select-Object -Unique File,Pattern | ForEach-Object { Write-Output " - $($_.Pattern) in $($_.File)" }
} else { Write-Output "No warning patterns found." }
if ($high.Count -gt 0) { exit 1 } else { exit 0 }
