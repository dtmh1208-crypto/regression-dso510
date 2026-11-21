param([string]$Repository, [switch]$IncludePlayground)
$ErrorActionPreference = 'Stop'

if (-not $Repository) { $Repository = Read-Host 'Paste the GitHub repository URL (or owner/repository)' }
$Repository = $Repository.Trim().TrimEnd('/') -replace '^https://github\.com/', '' -replace '\.git$', ''
if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Enter owner/repository or its GitHub URL.' }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI is required.' }

function Invoke-FixApi {
    param([string]$Endpoint, [string]$Method = 'GET', $Body = $null)
    $payloadPath = $null
    try {
        if ($null -ne $Body) {
            $payloadPath = Join-Path ([IO.Path]::GetTempPath()) ('fieldnotes-fix-' + [guid]::NewGuid().ToString('N') + '.json')
            [IO.File]::WriteAllText($payloadPath, (ConvertTo-Json -InputObject $Body -Depth 15 -Compress), [Text.UTF8Encoding]::new($false))
            $response = & gh api --method $Method $Endpoint --input $payloadPath
        } else { $response = & gh api --method $Method $Endpoint }
        if ($LASTEXITCODE -ne 0) { throw "GitHub request failed: $Method $Endpoint. Stopping." }
        return ($response -join "`n" | ConvertFrom-Json)
    } finally {
        if ($payloadPath -and (Test-Path -LiteralPath $payloadPath)) { Remove-Item -LiteralPath $payloadPath -Force }
    }
}

$sourcePath = Join-Path $PSScriptRoot '..\pyproject.toml'
if (-not (Test-Path -LiteralPath $sourcePath)) { throw 'The prepared pyproject.toml is missing beside the scripts folder.' }
$content = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $sourcePath).Path, [Text.Encoding]::UTF8)
$versionPath = Join-Path $PSScriptRoot '..\.python-version'
if (-not (Test-Path -LiteralPath $versionPath)) { throw 'The explicit .python-version file is missing.' }
$versionContent = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $versionPath).Path, [Text.Encoding]::UTF8)
if ($versionContent.Trim() -ne '3.12') { throw 'The prepared runtime must be Python 3.12.' }
$vercelPath = Join-Path $PSScriptRoot '..\vercel.json'
$vercelContent = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $vercelPath).Path, [Text.Encoding]::UTF8)
if (($vercelContent | ConvertFrom-Json).installCommand -ne 'npm install --include=dev') { throw 'The explicit frontend install command is missing.' }
$metadata = Invoke-FixApi "repos/$Repository"
$branch = [uri]::EscapeDataString($metadata.default_branch)
$reference = Invoke-FixApi "repos/$Repository/git/ref/heads/$branch"
$parentSha = $reference.object.sha
$parent = Invoke-FixApi "repos/$Repository/git/commits/$parentSha"
$tree = Invoke-FixApi "repos/$Repository/git/trees/$($parent.tree.sha)?recursive=1"
if ($tree.truncated) { throw 'Incomplete Git tree returned; stopping without changes.' }
foreach ($required in @('fieldnotes-vercel/package.json', 'fieldnotes-vercel/api/index.py')) {
    if (-not ($tree.tree | Where-Object { $_.path -ceq $required -and $_.type -eq 'blob' })) {
        throw "Expected application folder is missing: $required. Nothing was changed."
    }
}
$changes = @(
        @{path='fieldnotes-vercel/pyproject.toml'; mode='100644'; type='blob'; content=$content},
        @{path='fieldnotes-vercel/.python-version'; mode='100644'; type='blob'; content=$versionContent},
        @{path='fieldnotes-vercel/vercel.json'; mode='100644'; type='blob'; content=$vercelContent}
    )
if ($IncludePlayground) {
    foreach ($relativePath in @('src/main.tsx','src/VariablesNavigation.tsx','src/RegressionNavigation.tsx','src/CleaningPanel.tsx','src/ExploreCleaningSummary.tsx','src/cleaning.ts','src/style.css','server.py','api_service.py','test_service.py','README.md','DEPLOYMENT.md','scripts/Push-Deployment-Fix.ps1')) {
        $localPath = Join-Path $PSScriptRoot ('..\' + $relativePath.Replace('/', '\'))
        $fileText = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $localPath).Path, [Text.Encoding]::UTF8)
        $changes += @{path=('fieldnotes-vercel/' + $relativePath); mode='100644'; type='blob'; content=$fileText}
    }
}
$newTree = Invoke-FixApi "repos/$Repository/git/trees" 'POST' @{
    base_tree = $parent.tree.sha
    tree = $changes
}
if ($newTree.sha -eq $parent.tree.sha) { Write-Host 'The Python deployment fix is already committed. No change needed.'; return }
$commit = Invoke-FixApi "repos/$Repository/git/commits" 'POST' @{
    message=$(if ($IncludePlayground) {'Nest optional cleaning under Variables and simplify preview navigation'} else {'Use npm for frontend installation and retain Python 3.12 API pins'})
    tree=$newTree.sha
    parents=@($parentSha)
}
$null = Invoke-FixApi "repos/$Repository/git/refs/heads/$branch" 'PATCH' @{sha=$commit.sha; force=$false}
Write-Host "Pushed $($changes.Count) prepared application/configuration files to $($metadata.default_branch)."
Write-Host "Commit: https://github.com/$Repository/commit/$($commit.sha)"
Write-Host 'Deploy this latest commit in Vercel; disable the previous build cache if redeploying manually.'
