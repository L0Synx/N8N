$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputFile = Join-Path (Split-Path $projectRoot -Parent) 'outputs\Endomec_Inbox_v1.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$parent = Split-Path $outputFile -Parent
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$archive = [System.IO.Compression.ZipFile]::Open($outputFile, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $files = Get-ChildItem -LiteralPath $projectRoot -Recurse -File -Force | Where-Object {
        $relative = [System.IO.Path]::GetRelativePath($projectRoot, $_.FullName)
        $relative -notmatch '^(node_modules|dist|\.local|\.git)[\\/]' -and
        $_.Name -ne '.env' -and ($_.Name -notlike '.env.*' -or $_.Name -eq '.env.example') -and
        $_.Extension -ne '.zip'
    }
    foreach ($file in $files) {
        $relative = [System.IO.Path]::GetRelativePath($projectRoot, $file.FullName).Replace('\','/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file.FullName,"endomec-inbox/$relative") | Out-Null
    }
    Write-Output "Archivos incluidos: $($files.Count)"
} finally { $archive.Dispose() }
Write-Output $outputFile
