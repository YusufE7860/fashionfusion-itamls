<#
.SYNOPSIS
    Build + package the native RMM agent for distribution via the ITAMLS API.

.DESCRIPTION
    Builds ItamlsRmm.Service and ItamlsRmm.Helper as self-contained single-
    file Windows exes, then zips both plus the installer script into
    `itamls-rmm-native.zip`.

    Run this on any Windows box with the .NET 8 SDK installed. Drop the
    resulting .zip at `apps/api/public/rmm/itamls-rmm-native.zip` on the
    ITAMLS server. Technicians then run the one-line installer on each
    target PC — no SDK, no git, no manual copy.

.EXAMPLE
    .\build.ps1
    # produces .\itamls-rmm-native.zip
#>
param(
    [string]$Configuration = 'Release',
    [string]$OutZip        = "$PSScriptRoot\itamls-rmm-native.zip"
)
$ErrorActionPreference = 'Stop'

$dist = Join-Path $PSScriptRoot 'dist'
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Force -Path $dist | Out-Null

Write-Host '==> Publishing ItamlsRmm.Service'
dotnet publish "$PSScriptRoot\ItamlsRmm.Service\ItamlsRmm.Service.csproj" -c $Configuration -o $dist
if ($LASTEXITCODE -ne 0) { throw 'Service build failed — see errors above.' }

Write-Host '==> Publishing ItamlsRmm.Helper'
dotnet publish "$PSScriptRoot\ItamlsRmm.Helper\ItamlsRmm.Helper.csproj"   -c $Configuration -o $dist
if ($LASTEXITCODE -ne 0) { throw 'Helper build failed — see errors above.' }

# Copy the installer script alongside so the zip is self-contained.
Copy-Item "$PSScriptRoot\install\Install-ItamlsRmmNative.ps1" -Destination $dist

Write-Host "==> Packing $OutZip"
if (Test-Path $OutZip) { Remove-Item $OutZip }
Compress-Archive -Path "$dist\*" -DestinationPath $OutZip -Force

Write-Host ''
Write-Host "✅ Built. Upload $OutZip to apps/api/public/rmm/ on the ITAMLS server."
