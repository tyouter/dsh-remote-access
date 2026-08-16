<#
.SYNOPSIS
  Patches a DeepSeek Harness source checkout with the remote-access UI plugin.

.DESCRIPTION
  Copies dsh-plugin/ into packages/client/ui-remote-access, wires it into the
  web-app bundle and the client TypeScript project, installs dependencies and
  builds the plugin bundle. Restart `dsh web` afterwards.

.PARAMETER DshRoot
  Path to the deepseek-harness checkout. Defaults to the current directory.

.EXAMPLE
  .\patch-dsh.ps1 -DshRoot D:\src\deepseek-harness
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$DshRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$DshRoot = (Resolve-Path $DshRoot).Path
$pluginName = '@deepseek-ai/dsh-client-ui-remote-access'
$pluginSource = Join-Path $PSScriptRoot 'dsh-plugin'
$pluginTarget = Join-Path $DshRoot 'packages\client\ui-remote-access'

if (-not (Test-Path (Join-Path $DshRoot 'packages\client'))) {
  throw "Not a deepseek-harness checkout: $DshRoot"
}
if (-not (Test-Path (Join-Path $pluginSource 'package.json'))) {
  throw "Missing plugin source at $pluginSource"
}

Write-Host '[1/5] Copying plugin source...'
if (Test-Path $pluginTarget) { Remove-Item $pluginTarget -Recurse -Force }
Copy-Item $pluginSource $pluginTarget -Recurse

Write-Host '[2/5] Patching web-app bundle and client tsconfig...'

function InsertAfter($path, $needle, $addition) {
  $content = Get-Content $path -Raw
  if ($content.Contains($addition)) { Write-Host "  already patched: $path"; return }
  $index = $content.IndexOf($needle)
  if ($index -lt 0) { throw "Could not find insertion anchor in $path" }
  $index += $needle.Length
  $updated = $content.Substring(0, $index) + "`r`n" + $addition + $content.Substring($index)
  Set-Content -Path $path -Value $updated -Encoding UTF8 -NoNewline
  Write-Host "  patched: $path"
}

$webAppPackage = Join-Path $DshRoot 'packages\bundle\web-app\package.json'
$webAppPatch = Join-Path $DshRoot 'packages\bundle\web-app\cordis.patch.yml'
$clientTsconfig = Join-Path $DshRoot 'tsconfig.client.json'

$pkgContent = Get-Content $webAppPackage -Raw
if (-not $pkgContent.Contains($pluginName)) {
  $anchor = '"@deepseek-ai/dsh-client-ui-settings-models": "workspace:^",'
  $replacement = $anchor + "`r`n    `"$pluginName`": `"workspace:^`","
  $pkgContent = $pkgContent.Replace($anchor, $replacement)
  Set-Content -Path $webAppPackage -Value $pkgContent -Encoding UTF8 -NoNewline
  Write-Host "  patched: $webAppPackage"
} else {
  Write-Host "  already patched: $webAppPackage"
}

$cordisAnchor = "    - id: ui-sidebar`r`n      name: '@deepseek-ai/dsh-client-ui-sidebar'"
$cordisAddition = @"
    # Remote access: sidebar QR launcher (Tailscale + Cloudflare tunnel).
    - id: ui-remote-access
      name: '@deepseek-ai/dsh-client-ui-remote-access'
"@
InsertAfter $webAppPatch $cordisAnchor $cordisAddition

$tsconfigAnchor = '    { "path": "./packages/client/ui-sidebar" },'
$tsconfigAddition = '    { "path": "./packages/client/ui-remote-access" },'
InsertAfter $clientTsconfig $tsconfigAnchor $tsconfigAddition

Write-Host '[3/5] Installing workspace dependencies (pnpm install)...'
Push-Location $DshRoot
try {
  pnpm install
  if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }

  Write-Host '[4/5] Type-checking plugin...'
  pnpm --filter $pluginName exec tsc -b --pretty false
  if ($LASTEXITCODE -ne 0) { throw 'plugin type-check failed' }

  Write-Host '[5/5] Building plugin bundle...'
  pnpm --filter $pluginName run bundle
  if ($LASTEXITCODE -ne 0) { throw 'plugin bundle build failed' }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'Done. Restart DSH Web to activate the plugin:'
Write-Host "  cd $DshRoot"
Write-Host '  pnpm dsh web'
Write-Host ''
Write-Host 'Then click the "远程连接" action above Settings and scan the QR codes.'
