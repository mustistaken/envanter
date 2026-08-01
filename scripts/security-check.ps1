# Repository security and JavaScript syntax scanner
# Usage: .\scripts\security-check.ps1

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not (Test-Path $root)) { $root = Get-Location }

Write-Output "Scanning repo at $root ..."
$jsHtmlFiles = Get-ChildItem -Path $root -Recurse -Include *.js,*.html,*.htm -File |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' }
$jsFiles = $jsHtmlFiles | Where-Object { $_.Extension -eq '.js' }
$highRiskPatterns = @('eval\s*\(', 'new\s+Function\s*\(', 'document\.write\s*\(')
$warnPatterns = @('innerHTML', 'onclick=', 'localStorage\.setItem\s*\(', 'atob\s*\(')
$high = @()
$warn = @()
$syntaxFailures = @()

foreach ($f in $jsHtmlFiles) {
  $text = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
  foreach ($p in $highRiskPatterns) {
    if ($text -match $p) { $high += [PSCustomObject]@{File=$f.FullName; Pattern=$p} }
  }
  foreach ($p in $warnPatterns) {
    if ($text -match $p) { $warn += [PSCustomObject]@{File=$f.FullName; Pattern=$p} }
  }
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  foreach ($f in $jsFiles) {
    $syntaxOutput = & $node.Source --check $f.FullName 2>&1
    if ($LASTEXITCODE -ne 0) {
      $syntaxFailures += [PSCustomObject]@{File=$f.FullName; Output=($syntaxOutput -join [Environment]::NewLine)}
    }
  }
} else {
  Write-Output "Node.js not found; JavaScript syntax checks were skipped."
}

if ($high.Count -gt 0) {
  Write-Output "HIGH-RISK PATTERNS FOUND:"
  $high | ForEach-Object { Write-Output " - $($_.Pattern) in $($_.File)" }
} else {
  Write-Output "No high-risk patterns found."
}

if ($syntaxFailures.Count -gt 0) {
  Write-Output "JAVASCRIPT SYNTAX ERRORS FOUND:"
  $syntaxFailures | ForEach-Object {
    Write-Output " - $($_.File)"
    Write-Output $_.Output
  }
} elseif ($node) {
  Write-Output "JavaScript syntax checks passed."
}

if ($warn.Count -gt 0) {
  Write-Output "Warnings (inspect these):"
  $warn | Select-Object -Unique File,Pattern |
    ForEach-Object { Write-Output " - $($_.Pattern) in $($_.File)" }
} else {
  Write-Output "No warning patterns found."
}

if ($high.Count -gt 0 -or $syntaxFailures.Count -gt 0) { exit 1 }
exit 0
