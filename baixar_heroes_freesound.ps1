<#
HEROES OF THE BORDERLANDS - Freesound auto downloader (previews)
- Downloads preview-hq-mp3 files from Freesound API v2 search results
- Saves into ./audio/<folder>/
- Uses FREESOUND_API_KEY env var

Usage:
  1) setx FREESOUND_API_KEY "YOUR_KEY"
  2) Run RUN_HEROES_DOWNLOAD.bat
#>

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$configPath = Join-Path $root "heroes_queries.json"
if (!(Test-Path $configPath)) { throw "Nao achei heroes_queries.json" }

$cfg = Get-Content $configPath -Raw | ConvertFrom-Json

$apiKey = [Environment]::GetEnvironmentVariable("FREESOUND_API_KEY", "User")
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  $apiKey = [Environment]::GetEnvironmentVariable("FREESOUND_API_KEY", "Process")
}
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  throw 'FREESOUND_API_KEY nao definido. Rode: setx FREESOUND_API_KEY "SUA_CHAVE"'
}

$audioRoot = Join-Path $root "audio"
New-Item -ItemType Directory -Force -Path $audioRoot | Out-Null

function Sanitize-FileName([string]$name) {
  $name = $name -replace '[\\/:\*\?"<>\|]', '_'
  $name = $name -replace '\s+', ' '
  $name = $name.Trim()
  if ($name.Length -gt 120) { $name = $name.Substring(0,120).Trim() }
  return $name
}

function Invoke-FreesoundSearch([string]$query, [int]$pageSize) {
  $base = $cfg.api_base
  $filterParts = @()
  if ($cfg.license_filter) { $filterParts += $cfg.license_filter }
  $filterParts += ("duration:[" + $cfg.min_duration + " TO " + $cfg.max_duration + "]")
  $filter = [string]::Join(" ", $filterParts)

  $qs = @{
    query = $query
    filter = $filter
    fields = "id,name,previews,license,duration,username,url"
    page_size = $pageSize
    sort = "rating_desc"
  }

  $pairs = @()
  foreach ($kv in $qs.GetEnumerator()) {
    $pairs += ([System.Uri]::EscapeDataString($kv.Key) + "=" + [System.Uri]::EscapeDataString([string]$kv.Value))
  }
  $uri = "$base/search/text/?" + ($pairs -join "&")

  $headers = @{ Authorization = "Token $apiKey" }
  return Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
}

function Download-File([string]$url, [string]$outPath) {
  $headers = @{ Authorization = "Token $apiKey" }
  Invoke-WebRequest -Uri $url -Headers $headers -OutFile $outPath -UseBasicParsing
}

$credits = @()
$downloaded = 0

foreach ($cat in $cfg.categories) {
  $folder = [string]$cat.folder
  $destDir = Join-Path $audioRoot $folder
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null

  Write-Host ""
  Write-Host ("=== " + $folder + " ===") -ForegroundColor Cyan

  $count = 0
  foreach ($q in $cat.queries) {
    if ($count -ge $cfg.max_per_category) { break }

    Write-Host ("Searching: " + $q) -ForegroundColor DarkGray
    $res = Invoke-FreesoundSearch -query $q -pageSize 12

    foreach ($item in $res.results) {
      if ($count -ge $cfg.max_per_category) { break }

      $prev = $null
      if ($item.previews.'preview-hq-mp3') { $prev = $item.previews.'preview-hq-mp3' }
      elseif ($item.previews.'preview-lq-mp3') { $prev = $item.previews.'preview-lq-mp3' }
      else { continue }

      $safeName = Sanitize-FileName([string]$item.name)
      if (![string]::IsNullOrWhiteSpace($safeName) -and -not $safeName.ToLower().EndsWith(".mp3")) {
        $safeName = $safeName + ".mp3"
      }
      $outPath = Join-Path $destDir $safeName

      if (Test-Path $outPath) { continue }

      try {
        Download-File -url $prev -outPath $outPath
        $downloaded += 1
        $count += 1

        $credits += [PSCustomObject]@{
          folder = $folder
          file = $safeName
          title = $item.name
          username = $item.username
          license = $item.license
          duration = $item.duration
          freesound_url = $item.url
        }

        Write-Host ("Downloaded: " + $safeName) -ForegroundColor Green
      } catch {
        Write-Host ("Failed: " + $item.name) -ForegroundColor Yellow
      }
    }
  }

  Write-Host ("Total em '" + $folder + "': " + $count) -ForegroundColor Magenta
}

$creditsPath = Join-Path $root "credits.json"
($credits | ConvertTo-Json -Depth 6) | Out-File -FilePath $creditsPath -Encoding utf8

Write-Host ""
Write-Host ("OK. Baixados: " + $downloaded + " arquivos") -ForegroundColor Green
Write-Host "Agora rode generate_playlist.bat (ou use TUDO_EM_UM.bat)." -ForegroundColor Green
