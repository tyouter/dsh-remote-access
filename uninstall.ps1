<#
.SYNOPSIS
  Stops and removes the DSH remote-access network layer.

.PARAMETER RemoveData
  Also delete the InstallDir state directory. Use with care; the access token
  and generated config live there.

.EXAMPLE
  .\uninstall.ps1
  .\uninstall.ps1 -RemoveData
#>
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:USERPROFILE '.dsh-remote-access'),
  [switch]$RemoveData
)

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process caddy -ErrorAction SilentlyContinue | Stop-Process -Force

$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'DSH-Remote-Access.cmd'
Remove-Item $startup -Force -ErrorAction SilentlyContinue

[Environment]::SetEnvironmentVariable('DSH_REMOTE_ACCESS_DIR', $null, 'User')
[Environment]::SetEnvironmentVariable('DSH_REMOTE_AUTH_PROXY', $null, 'User')

if ($RemoveData) {
  Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Removed data dir: $InstallDir"
}

Write-Host 'Remote-access network layer stopped.'
Write-Host 'The DSH plugin remains installed; remove packages/client/ui-remote-access from your DSH checkout if you want to uninstall the UI as well.'
