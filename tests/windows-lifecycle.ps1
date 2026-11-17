[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Binary)

# Windows lifecycle of install.ps1 in a throwaway profile. $Binary is the 4w.exe release build for x64.
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this test on Windows.' }
$root = Split-Path -Parent $PSScriptRoot
$binaryPath = (Resolve-Path -LiteralPath $Binary).Path
$installer = Join-Path $root 'install.ps1'
$version = [regex]::Match([IO.File]::ReadAllText($installer), '(?m)^\s*\$version = ''(\d+\.\d+\.\d+)''').Groups[1].Value
if (-not $version) { throw 'The installer version is missing.' }
$temp = Join-Path ([IO.Path]::GetTempPath()) ('4w test ' + [Guid]::NewGuid().ToString('N'))
$previousLocal = $env:LOCALAPPDATA
$previousPath = $env:Path
$null = New-Item -ItemType Directory -Path $temp
$env:LOCALAPPDATA = $temp
$exe = Join-Path $temp '4Words\CLI\bin\4w.exe'
try {
    & $installer -Source $binaryPath
    $check = & $exe --self-test
    if ($LASTEXITCODE -ne 0 -or $check -ne "4w $version OK") { throw 'The installed binary failed its self-test.' }
    & $installer -Source $binaryPath   # idempotent update while the previous exe exists
    $before = (Get-FileHash -LiteralPath $exe).Hash
    $tampered = Join-Path $temp 'tampered.exe'
    Copy-Item -LiteralPath $binaryPath -Destination $tampered
    [IO.File]::AppendAllText($tampered, 'x')
    $rejected = $false
    try { & $installer -Source $tampered }
    catch {
        if ($_.Exception.Message -notlike '*SHA-256*') { throw }
        $rejected = $true
    }
    if (-not $rejected -or (Get-FileHash -LiteralPath $exe).Hash -ne $before) { throw 'Rejection did not preserve the installation.' }
    & $installer -Uninstall
    & $installer -Uninstall
    if (Test-Path -LiteralPath $exe) { throw 'The binary still exists after uninstall.' }
    if ($env:Path -like "*$temp*") { throw 'The session PATH still points to the removed installation.' }
    Write-Host 'Windows lifecycle OK.'
} finally {
    try { & $installer -Uninstall } finally {
        $env:LOCALAPPDATA = $previousLocal
        $env:Path = $previousPath
        Remove-Item -LiteralPath $temp -Force -Recurse
    }
}
