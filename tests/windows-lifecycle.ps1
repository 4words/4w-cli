[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$BunArchive)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Execute este teste em Windows.' }
$root = Split-Path -Parent $PSScriptRoot
$archive = (Resolve-Path -LiteralPath $BunArchive).Path
$installer = Join-Path $root 'install.ps1'
$version = [regex]::Match([IO.File]::ReadAllText($installer), '(?m)^\s*\$version = ''(\d+\.\d+\.\d+)''').Groups[1].Value
if (-not $version) { throw 'A versão do instalador está ausente.' }
$source = Join-Path $root "releases\$version\cli.ts"
$temp = Join-Path ([IO.Path]::GetTempPath()) ('4w test ' + [Guid]::NewGuid().ToString('N'))
$previousLocal = $env:LOCALAPPDATA
$previousPath = $env:Path
$null = New-Item -ItemType Directory -Path $temp
$env:LOCALAPPDATA = $temp
$exe = Join-Path $temp '4Words\CLI\bin\4w.exe'
try {
    & $installer -Source $source -BunArchive $archive
    $check = & $exe --self-test
    if ($LASTEXITCODE -ne 0 -or $check -notmatch '^4w \d+\.\d+\.\d+ OK$') { throw 'Falha no binário instalado.' }
    & $installer -Source $source -BunArchive $archive
    $before = (Get-FileHash -LiteralPath $exe).Hash
    $invalid = Join-Path $temp 'alterado.ts'
    [IO.File]::WriteAllText($invalid, 'invalid')
    $rejected = $false
    try { & $installer -Source $invalid -BunArchive $archive }
    catch {
        if ($_.Exception.Message -notlike '*SHA-256*') { throw }
        $rejected = $true
    }
    if (-not $rejected -or (Get-FileHash -LiteralPath $exe).Hash -ne $before) { throw 'A rejeição não preservou a instalação.' }
    & $installer -Uninstall
    & $installer -Uninstall
    if (Test-Path -LiteralPath $exe) { throw 'Binário ainda existe após remoção.' }
    if ($env:Path -like "*$temp*") { throw 'PATH da sessão ainda aponta para a instalação removida.' }
    Write-Host 'Ciclo Windows OK.'
} finally {
    try { & $installer -Uninstall } finally {
        $env:LOCALAPPDATA = $previousLocal
        $env:Path = $previousPath
        Remove-Item -LiteralPath $temp -Force -Recurse
    }
}
