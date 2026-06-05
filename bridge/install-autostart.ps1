# Canvas Browser Bridge – Autostart installieren
# Als Administrator ausfuehren: Rechtsklick → "Mit PowerShell ausführen"

$serverPath = "$PSScriptRoot\server.js"
$vbsPath    = "$PSScriptRoot\start-hidden.vbs"
$taskName   = "CanvasBrowserBridge"

# Node.js-Pfad ermitteln
$nodePath = (Get-Command node -ErrorAction Stop).Source

$action = New-ScheduledTaskAction `
  -Execute  "wscript.exe" `
  -Argument "`"$vbsPath`" `"$serverPath`""

$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit     ([TimeSpan]::Zero) `
  -RestartCount           3 `
  -RestartInterval        (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable     $true

$principal = New-ScheduledTaskPrincipal `
  -UserId    $env:USERNAME `
  -LogonType Interactive `
  -RunLevel  Highest

# Alten Task entfernen falls vorhanden
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
  -TaskName   $taskName `
  -Action     $action `
  -Trigger    $trigger `
  -Settings   $settings `
  -Principal  $principal `
  -Description "Canvas Browser WebSocket-Bridge (Port 3001/3000)"

Write-Host ""
Write-Host "✅ Autostart installiert: '$taskName'" -ForegroundColor Green
Write-Host "   Startet automatisch bei naechster Windows-Anmeldung." -ForegroundColor Gray
Write-Host ""
Write-Host "   Jetzt sofort starten:" -ForegroundColor Yellow
Write-Host "   Start-ScheduledTask -TaskName '$taskName'" -ForegroundColor White
