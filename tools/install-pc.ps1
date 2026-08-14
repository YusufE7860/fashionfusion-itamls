<#
.SYNOPSIS
    Bootstrap loader for the ITAMLS PC agent.
    Meant to be piped from a one-liner:

        iwr https://itamls/api/v1/tools/install-pc.ps1 -UseB | iex
        Install-ITAMLSAgent -Token 'XXXX' -Api 'https://itamls/api/v1'

    All this does is fetch Install-ITAMLSAgent.ps1 from the server and
    dot-source it so the Install-ITAMLSAgent function is defined in your
    session. Then you call it with your token.
#>
$ErrorActionPreference = 'Stop'

# Find the API base from the URL used to fetch this script.
# The tools.controller sets a header so we can pass it through; otherwise
# the user provides it via -Api on the Install-ITAMLSAgent call.
$scriptUrl = "$env:ITAMLS_INSTALLER_URL"
if (-not $scriptUrl) {
    # Best-effort: user may just call Install-ITAMLSAgent -Api manually.
    Write-Host 'ITAMLS agent installer loaded.' -ForegroundColor Cyan
    Write-Host ''
    Write-Host 'Next step: run' -ForegroundColor Yellow
    Write-Host '   Install-ITAMLSAgent -Token "<12-CHAR-TOKEN>" -Api "https://your-itamls/api/v1"' -ForegroundColor White
    Write-Host ''
}

# Pull the real installer from the same origin this bootstrap came from.
# If the user set $env:ITAMLS_API, use that; else assume same host.
$api = $env:ITAMLS_API
if (-not $api) {
    Write-Host 'Tip: set $env:ITAMLS_API = "https://your-itamls/api/v1" before running Install-ITAMLSAgent so the tools can be re-downloaded automatically on updates.' -ForegroundColor DarkGray
}

# Fetch and dot-source the real installer
$agentInstallerUrl = if ($api) { "$($api.TrimEnd('/'))/tools/install-itamlsagent.ps1" }
                    else       { 'https://raw.githubusercontent.com/YusufE7860/fashionfusion-itamls/main/tools/Install-ITAMLSAgent.ps1' }

try {
    $script = (Invoke-WebRequest -Uri $agentInstallerUrl -UseBasicParsing -TimeoutSec 30).Content
    $sb = [ScriptBlock]::Create($script)
    . $sb
    Write-Host 'Install-ITAMLSAgent function is now available.' -ForegroundColor Green
} catch {
    Write-Host "Could not load installer from $agentInstallerUrl : $($_.Exception.Message)" -ForegroundColor Red
    throw
}
