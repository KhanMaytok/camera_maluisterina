param(
    [ValidateSet("both", "backend", "viewer")]
    [string]$App = "both",
    [string]$AppNamePrefix = "grabadora"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command caprover -ErrorAction SilentlyContinue)) {
    throw "El CLI de CapRover no esta instalado. Ejecuta: npm install -g caprover"
}

function Deploy-Folder {
    param([string]$Folder, [string]$AppName)
    Write-Host "== Desplegando $AppName desde $Folder ==" -ForegroundColor Cyan
    Push-Location $Folder
    try {
        caprover deploy -a $AppName
        if ($LASTEXITCODE -ne 0) { throw "Fallo el deploy de $AppName" }
    }
    finally {
        Pop-Location
    }
}

switch ($App) {
    "backend" { Deploy-Folder (Join-Path $PSScriptRoot "backend") "$AppNamePrefix-backend" }
    "viewer" { Deploy-Folder (Join-Path $PSScriptRoot "viewer") "$AppNamePrefix-viewer" }
    default {
        Deploy-Folder (Join-Path $PSScriptRoot "backend") "$AppNamePrefix-backend"
        Deploy-Folder (Join-Path $PSScriptRoot "viewer") "$AppNamePrefix-viewer"
    }
}

Write-Host "Deploy completado." -ForegroundColor Green
