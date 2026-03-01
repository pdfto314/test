@echo off
setlocal
REM Gera playlist.json a partir da pasta /audio (subpastas viram temas)
REM Requisitos: Windows com PowerShell (já vem por padrão)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$root = Join-Path (Get-Location) 'audio';" ^
  "if(!(Test-Path $root)){ throw 'Pasta audio/ não encontrada.' }" ^
  "$themes = @();" ^
  "Get-ChildItem -Path $root -Directory | Sort-Object Name | ForEach-Object {" ^
  "  $tname = $_.Name;" ^
  "  $items = @();" ^
  "  Get-ChildItem -Path $_.FullName -File | Where-Object { $_.Extension -match '^\.(mp3|wav|ogg|m4a)$' } | Sort-Object Name | ForEach-Object {" ^
  "    $file = $_.Name;" ^
  "    $title = [Regex]::Replace([IO.Path]::GetFileNameWithoutExtension($file), '[_-]+', ' ');" ^
  "    $url = ('audio/{0}/{1}' -f $tname, $file);" ^
  "    $items += [pscustomobject]@{ title=$title; file=$file; url=$url };" ^
  "  };" ^
  "  $themes += [pscustomobject]@{ name=$tname; count=$items.Count; items=$items };" ^
  "};" ^
  "$out = [pscustomobject]@{ themes=$themes; generated=(Get-Date).ToString('s') };" ^
  "$json = $out | ConvertTo-Json -Depth 8;" ^
  "[IO.File]::WriteAllText('playlist.json', $json, [Text.Encoding]::UTF8);" ^
  "Write-Host 'OK: playlist.json gerado.'"

echo.
echo Agora: faça Commit + Push do playlist.json
echo (No iPad, vai funcionar sem bater no rate limit)
pause
