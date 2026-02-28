$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$audioDir = Join-Path $root "audio"
$outFile = Join-Path $root "playlist.json"

if (!(Test-Path $audioDir)) {
  Write-Host "Pasta 'audio' não encontrada em: $audioDir" -ForegroundColor Red
  exit 1
}

function UrlEncodePart([string]$s){
  return [System.Uri]::EscapeDataString($s)
}

$categories = @()

Get-ChildItem -Path $audioDir -Directory | Sort-Object Name | ForEach-Object {
  $theme = $_.Name
  $mp3s = Get-ChildItem -Path $_.FullName -File -Filter "*.mp3" | Sort-Object Name
  if ($mp3s.Count -eq 0) { return }

  $items = @()
  foreach ($f in $mp3s){
    $title = [System.IO.Path]::GetFileNameWithoutExtension($f.Name) -replace "_"," "
    $url = "audio/" + (UrlEncodePart $theme) + "/" + (UrlEncodePart $f.Name)
    $items += [PSCustomObject]@{
      title = $title
      type = "ambience"
      url = $url
      loop = $true
      volume = 0.8
      tags = @($theme.ToLower())
    }
  }

  $categories += [PSCustomObject]@{
    name = $theme
    items = $items
  }
}

$data = [PSCustomObject]@{ categories = $categories }
$json = $data | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($outFile, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "OK: gerado playlist.json com $($categories.Count) tema(s)." -ForegroundColor Green
