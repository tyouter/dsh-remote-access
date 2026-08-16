<#
.SYNOPSIS
  One-click installer for the DSH remote-access network layer.

.DESCRIPTION
  Downloads Caddy and cloudflared into a user-level directory, creates a
  cookie-token auth proxy in front of the local DSH web server, starts a
  Cloudflare quick tunnel, and installs a logon startup item so the tunnel
  comes back after reboot.

  No secrets are committed anywhere: the access token is generated locally and
  only stored in <InstallDir>/access-token.txt and tunnel-url.txt.

.PARAMETER InstallDir
  State directory. Defaults to ~/.dsh-remote-access.

.PARAMETER DshPort
  DSH web port (normally 3080).

.PARAMETER ProxyPort
  Local auth proxy port that cloudflared forwards to (normally 8080).

.PARAMETER NoStartup
  Skip the startup shortcut.

.EXAMPLE
  .\install.ps1
#>
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:USERPROFILE '.dsh-remote-access'),
  [int]$DshPort = 3080,
  [int]$ProxyPort = 8080,
  [switch]$NoStartup
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$binDir = Join-Path $InstallDir 'bin'
$caddyDir = Join-Path $InstallDir 'caddy'
$logDir = Join-Path $InstallDir 'logs'
$caddyExe = Join-Path $binDir 'caddy.exe'
$cloudflaredExe = Join-Path $binDir 'cloudflared.exe'
$caddyCfg = Join-Path $caddyDir 'Caddyfile'
$tokenFile = Join-Path $InstallDir 'access-token.txt'
$urlFile = Join-Path $InstallDir 'tunnel-url.txt'

New-Item -ItemType Directory -Force -Path $binDir, $caddyDir, $logDir | Out-Null

Write-Host '[1/5] Downloading binaries...'
if (-not (Test-Path $caddyExe)) {
  Invoke-WebRequest -Uri 'https://caddyserver.com/api/download?os=windows&arch=amd64' -OutFile $caddyExe -TimeoutSec 300
}
if (-not (Test-Path $cloudflaredExe)) {
  Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cloudflaredExe -TimeoutSec 300
}
& $caddyExe version
& $cloudflaredExe --version

Write-Host '[2/5] Generating access token...'
$bytes = New-Object byte[] 16
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
Set-Content -Path $tokenFile -Value $token -Encoding ASCII

Write-Host '[3/5] Writing Caddy auth proxy config...'
$caddyFile = @"
:$ProxyPort {
    @enter path /enter-$token
    header @enter Set-Cookie "dsh_auth=1; Path=/; HttpOnly; SameSite=Lax"
    redir @enter / 302

    @authed header Cookie *dsh_auth=1*
    handle @authed {
        encode zstd gzip
        reverse_proxy 127.0.0.1:$DshPort {
            header_up -Origin
            header_up Host 127.0.0.1:$DshPort
        }
    }

    handle {
        respond "Unauthorized" 401
    }
}
"@
Set-Content -Path $caddyCfg -Value $caddyFile -Encoding UTF8

Write-Host '[4/5] Starting auth proxy and Cloudflare tunnel...'
Copy-Item (Join-Path $PSScriptRoot 'start-cloud-access.ps1') (Join-Path $InstallDir 'start-cloud-access.ps1') -Force
& (Join-Path $InstallDir 'start-cloud-access.ps1') -InstallDir $InstallDir -DshPort $DshPort -ProxyPort $ProxyPort

if (-not (Test-Path $urlFile)) {
  throw 'Cloudflare quick tunnel URL was not published. Check the logs under ' + $logDir
}

[Environment]::SetEnvironmentVariable('DSH_REMOTE_ACCESS_DIR', $InstallDir, 'User')
[Environment]::SetEnvironmentVariable('DSH_REMOTE_AUTH_PROXY', "http://127.0.0.1:$ProxyPort", 'User')

Write-Host '[5/5] Installing startup shortcut...'
if (-not $NoStartup) {
  $startup = [Environment]::GetFolderPath('Startup')
  $shortcut = Join-Path $startup 'DSH-Remote-Access.cmd'
  $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$InstallDir\start-cloud-access.ps1`" -InstallDir `"$InstallDir`" -DshPort $DshPort -ProxyPort $ProxyPort"
  Set-Content -Path $shortcut -Value $command -Encoding ASCII
}

$entryUrl = (Get-Content $urlFile -Raw).Trim()
Write-Host ''
Write-Host 'Installation complete.'
Write-Host "  Data dir : $InstallDir"
Write-Host "  Entry URL: $entryUrl"
Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1. Run .\patch-dsh.ps1 against your deepseek-harness checkout (if not done yet).'
Write-Host '  2. Restart DSH Web.'
Write-Host '  3. Click "远程连接" in the sidebar and scan the "外出高速通道" QR code.'
Write-Host ''
Write-Host 'The QR codes auto-login; do not share the entry URL or the QR code publicly.'
