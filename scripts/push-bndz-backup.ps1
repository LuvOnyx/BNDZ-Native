# Creates a private GitHub backup repo and pushes BNDZ 1.0.
# Prerequisites: GitHub CLI logged in (gh auth login)
param(
    [string]$RepoName = "BNDZ-1.0",
    [string]$Description = "BNDZ 1.0 private backup of unified file manager and launcher",
    [switch]$Public
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Split-Path -Parent $Root)

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) not found. Install: winget install GitHub.cli"
}

$auth = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Not logged into GitHub. Run: gh auth login" -ForegroundColor Yellow
    gh auth login
}

$visibility = if ($Public) { "--public" } else { "--private" }

if (git remote get-url origin 2>$null) {
    Write-Host "Remote 'origin' already exists. Pushing..." -ForegroundColor Cyan
    git push -u origin main
    exit 0
}

Write-Host "==> Creating $RepoName on GitHub ($($visibility.TrimStart('-')))" -ForegroundColor Cyan
gh repo create $RepoName $visibility --source=. --remote=origin --description=$Description --push

Write-Host "==> Done. Remote:" -ForegroundColor Green
git remote -v
