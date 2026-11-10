[CmdletBinding()]
param(
    [switch]$Uninstall,
    [string]$Source,
    [string]$BunArchive
)

& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $version = '0.3.1'
    $sourceSha = '9e3472cccfdeef0a00d59bae8ec2573cc76c70c09011930e5fe650f2b033112b'
    $bunVersion = '1.4.4'
    $release = 'https://raw.githubusercontent.com/4words/4w-cli/main'
    if ($env:OS -ne 'Windows_NT') { throw 'Use this installer on Windows.' }
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is not available.' }
    $base = Join-Path $env:LOCALAPPDATA '4Words\CLI'
    $bin = Join-Path $base 'bin'
    $exe = Join-Path $bin '4w.exe'
    $marker = Join-Path $base 'path-owned'
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $mutex = [Threading.Mutex]::new($false, "Global\4Words-CLI-$identity")
    $locked = $false
    $work = $null
    $registry = $null

    function Step([string]$Number, [string]$Message) { Write-Host "[$Number] $Message" }
    function Verify([string]$Path, [string]$Sha) {
        if ((Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash -ne $Sha) {
            throw "SHA-256 mismatch: $(Split-Path -Leaf $Path)."
        }
    }
    function Download([string]$Url, [string]$Path) {
        $previous = [Net.ServicePointManager]::SecurityProtocol
        try {
            if ($PSVersionTable.PSVersion.Major -lt 6) {
                [Net.ServicePointManager]::SecurityProtocol = $previous -bor [Net.SecurityProtocolType]::Tls12
            }
            $headers = @{}
            if ($env:GITHUB_TOKEN -and $Url.StartsWith('https://raw.githubusercontent.com/')) {
                $headers['Authorization'] = "Bearer $($env:GITHUB_TOKEN)"
            }
            if ($headers.Count -gt 0) {
                Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers $headers -OutFile $Path -TimeoutSec 300
            } else {
                Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Path -TimeoutSec 300
            }
        } finally { [Net.ServicePointManager]::SecurityProtocol = $previous }
    }
    function PathMatches([string]$Entry) {
        [Environment]::ExpandEnvironmentVariables($Entry.Trim().Trim('"')).TrimEnd('\') -ieq $bin.TrimEnd('\')
    }
    function SetUserPath([string]$Value, [Microsoft.Win32.RegistryValueKind]$Kind) {
        $registry.SetValue('Path', $Value, $Kind)
    }
    function NotifyEnvironment {
        try {
            if (-not ('FourWords.EnvironmentNotice' -as [type])) {
                Add-Type -Namespace FourWords -Name EnvironmentNotice -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr window, uint msg, System.UIntPtr wparam,
    string lparam, uint flags, uint timeout, out System.UIntPtr result);
'@
            }
            $result = [UIntPtr]::Zero
            $null = [FourWords.EnvironmentNotice]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 2000, [ref]$result)
        } catch { Write-Warning 'If needed, sign out and back in to Windows to reload PATH.' }
    }
    function AssertNotReparsePoint([string]$Path) {
        $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Managed path is a symlink or junction: $Path."
        }
    }

    try {
        try { $locked = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
        if (-not $locked) { throw 'Another installation or uninstallation of 4w is already in progress.' }
        foreach ($path in @((Split-Path -Parent $base), $base, $bin, $exe, $marker)) { AssertNotReparsePoint $path }
        $registry = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
        $userPath = [string]$registry.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $pathKind = [Microsoft.Win32.RegistryValueKind]::ExpandString
        if ($registry.GetValueNames() -contains 'Path') { $pathKind = $registry.GetValueKind('Path') }
        if ($pathKind -notin @([Microsoft.Win32.RegistryValueKind]::String, [Microsoft.Win32.RegistryValueKind]::ExpandString)) {
            throw 'User PATH has an unexpected Registry value type.'
        }
        $userEntries = @($userPath -split ';')
        $matching = @($userEntries | Where-Object { PathMatches $_ })

        if ($Uninstall) {
            Step '1/2' 'Removing 4w executable.'
            if (Test-Path -LiteralPath $exe) { [IO.File]::Delete($exe) }
            foreach ($file in @('config.json', 'history.json')) {
                $target = Join-Path $base $file
                if (Test-Path -LiteralPath $target) { [IO.File]::Delete($target) }
            }
            Step '2/2' 'Cleaning PATH registered by the installer.'
            if (Test-Path -LiteralPath $marker) {
                $owned = [IO.File]::ReadAllText($marker)
                if ($owned -ceq $bin) {
                    $updated = [Collections.Generic.List[string]]::new()
                    $updated.AddRange([string[]]$userEntries)
                    $index = $updated.LastIndexOf($bin)
                    if ($index -ge 0) { $updated.RemoveAt($index); SetUserPath ($updated -join ';') $pathKind }
                    [IO.File]::Delete($marker)
                    NotifyEnvironment
                }
            }
            $env:Path = (@($env:Path -split ';' | Where-Object { -not (PathMatches $_) }) -join ';')
            foreach ($dir in @($bin, $base, (Split-Path -Parent $base))) {
                if ((Test-Path -LiteralPath $dir -PathType Container) -and
                    -not (Get-ChildItem -LiteralPath $dir -Force | Select-Object -First 1)) {
                    [IO.Directory]::Delete($dir)
                }
            }
            Write-Host '4w uninstalled from this user profile.'
            return
        }

        Step '1/7' 'Detecting Windows version and architecture.'
        if ([Environment]::OSVersion.Version.Build -lt 17763) { throw 'Bun requires Windows 10 1809 or newer.' }
        $cpu = $env:PROCESSOR_ARCHITEW6432
        if (-not $cpu) { $cpu = $env:PROCESSOR_ARCHITECTURE }
        try {
            $native = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1
            if ($native.Architecture -eq 12) { $cpu = 'ARM64' }
            if ($native.Architecture -eq 9) { $cpu = 'AMD64' }
        } catch { Write-Verbose 'Using architecture reported by environment.' }
        switch ($cpu) {
            'AMD64' {
                $asset = 'bun-windows-x64'
                $bunSha = 'cd2c0fccc78f3ede1f50ca827a15f063eda13d4d150a3d0674f4f6e323d864a5'
            }
            'ARM64' {
                $asset = 'bun-windows-aarch64'
                $bunSha = '2d57a0eec0cb44d95c918c3f9734f60455a1306ae5085d76fc68f44e3ee30d09'
            }
            default { throw "Unsupported architecture for Bun binary: $cpu." }
        }
        Write-Host "      System: Windows · arch: $cpu · 4w: $version."
        $null = New-Item -Path $bin -ItemType Directory -Force
        $work = Join-Path $base ('.work.' + [Guid]::NewGuid().ToString('N'))
        $null = New-Item -Path $work -ItemType Directory
        $cli = Join-Path $work 'cli.ts'
        $zip = Join-Path $work 'bun.zip'
        $built = Join-Path $work '4w.exe'

        Step '2/7' 'Fetching and verifying 4w TypeScript source.'
        if ($Source) { Copy-Item -LiteralPath $Source -Destination $cli }
        else { Download "$release/releases/$version/cli.ts" $cli }
        Verify $cli $sourceSha

        Step '3/7' "Fetching Bun $bunVersion ($asset) and verifying SHA-256."
        if ($BunArchive) { Copy-Item -LiteralPath $BunArchive -Destination $zip }
        else { Download "https://github.com/oven-sh/bun/releases/download/bun-v$bunVersion/$asset.zip?4w=1" $zip }
        Verify $zip $bunSha
        Expand-Archive -LiteralPath $zip -DestinationPath $work
        $bun = Join-Path (Join-Path $work $asset) 'bun.exe'
        $actual = & $bun --version
        if ($LASTEXITCODE -ne 0 -or $actual -ne $bunVersion) { throw 'Downloaded Bun binary failed to run or returned an unexpected version.' }

        Step '4/7' 'Compiling 4w.exe into a standalone executable.'
        Push-Location -LiteralPath $work
        try {
            & $bun build --compile ./cli.ts --outfile ./4w.exe
            if ($LASTEXITCODE -ne 0) { throw "Compilation failed (exit code $LASTEXITCODE)." }
        } finally { Pop-Location }

        Step '5/7' 'Running self-test and verifying compiled version.'
        $test = & $built --self-test
        if ($LASTEXITCODE -ne 0 -or $test -ne "4w $version OK") { throw 'Self-test failed. Previous installation preserved.' }
        Remove-Item -LiteralPath (Split-Path -Parent $bun) -Recurse -Force
        Remove-Item -LiteralPath $zip, $cli -Force

        Step '6/7' 'Activating executable for current user.'
        if ([IO.File]::Exists($exe)) { [IO.File]::Replace($built, $exe, (Join-Path $work 'previous.exe')) }
        else { [IO.File]::Move($built, $exe) }

        Step '7/7' 'Cleaning temporary files and checking PATH.'
        if ($matching.Count -eq 0) {
            try {
                $next = if ($userPath.Length -eq 0) { $bin } else { "$userPath;$bin" }
                if ($next.Length -ge 32767) { throw 'User PATH reached the Windows length limit.' }
                [IO.File]::WriteAllText($marker, $bin)
                try { SetUserPath $next $pathKind } catch { [IO.File]::Delete($marker); throw }
                NotifyEnvironment
            } catch {
                Write-Warning "Persistent PATH unavailable: $($_.Exception.Message). Direct path: $exe"
            }
        }
        if (-not @($env:Path -split ';' | Where-Object { PathMatches $_ }).Count) { $env:Path = "$bin;$env:Path" }
        Write-Host "4w $version installed at $exe."
        Write-Host 'First use: 4w --help | switch language: 4w lang ptbr | online check: 4w doctor.'
        Write-Host 'Uninstall: & ([scriptblock]::Create((irm https://raw.githubusercontent.com/4words/4w-cli/main/install.ps1))) -Uninstall'
    } catch {
        throw "4Words: $($_.Exception.Message)"
    } finally {
        if ($work -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Continue }
        if ($registry) { $registry.Dispose() }
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}
