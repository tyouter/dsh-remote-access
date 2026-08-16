<#
.SYNOPSIS
  Starts the Caddy auth proxy and the Cloudflare quick tunnel, then publishes
  the auto-login tunnel URL for the DSH remote-access plugin.

.DESCRIPTION
  All runtime state lives under InstallDir (default ~/.dsh-remote-access):
    caddy\Caddyfile         - generated auth proxy config
    bin\caddy.exe           - Caddy binary
    bin\cloudflared.exe     - Cloudflare Tunnel binary
    access-token.txt        - random cookie-entry token
    tunnel-url.txt          - current https://.../enter-<token> URL
#>
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:USERPROFILE '.dsh-remote-access'),
  [int]$DshPort = 3080,
  [int]$ProxyPort = 8080
)

$ErrorActionPreference = 'SilentlyContinue'

$caddyExe = Join-Path $InstallDir 'bin\caddy.exe'
$cloudflaredExe = Join-Path $InstallDir 'bin\cloudflared.exe'
$caddyCfg = Join-Path $InstallDir 'caddy\Caddyfile'
$caddyOut = Join-Path $InstallDir 'logs\caddy.out.log'
$caddyErr = Join-Path $InstallDir 'logs\caddy.err.log'
$cfOut = Join-Path $InstallDir 'logs\cloudflared.out.log'
$cfErr = Join-Path $InstallDir 'logs\cloudflared.err.log'
$tokenFile = Join-Path $InstallDir 'access-token.txt'
$urlFile = Join-Path $InstallDir 'tunnel-url.txt'

New-Item -ItemType Directory -Force -Path (Split-Path $caddyOut), (Split-Path $caddyCfg) | Out-Null

if (-not (Get-Process caddy -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath $caddyExe -ArgumentList @('run','--config',$caddyCfg,'--adapter','caddyfile') -WorkingDirectory (Split-Path $caddyExe) -WindowStyle Hidden -RedirectStandardOutput $caddyOut -RedirectStandardError $caddyErr
  Start-Sleep -Seconds 2
}

if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
  Remove-Item $cfOut, $cfErr -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $cloudflaredExe -ArgumentList @('tunnel','--url',"http://127.0.0.1:$ProxyPort",'--no-autoupdate','--protocol','http2','--compression-quality','1') -WorkingDirectory (Split-Path $cloudflaredExe) -WindowStyle Hidden -RedirectStandardOutput $cfOut -RedirectStandardError $cfErr
}

for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 2
  $content = ((Get-Content $cfOut -Raw -ErrorAction SilentlyContinue) + (Get-Content $cfErr -Raw -ErrorAction SilentlyContinue))
  $match = [regex]::Match($content, 'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($match.Success) {
    $token = (Get-Content $tokenFile -Raw -ErrorAction SilentlyContinue).Trim()
    $entry = if ([string]::IsNullOrEmpty($token)) { $match.Value } else { "$($match.Value)/enter-$token" }
    Set-Content -Path $urlFile -Value $entry -Encoding ASCII
    return
  }
}

Write-Warning 'Cloudflare quick tunnel URL was not observed within 3 minutes.'
