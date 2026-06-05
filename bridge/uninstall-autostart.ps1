# Canvas Browser Bridge – Autostart entfernen
Unregister-ScheduledTask -TaskName "CanvasBrowserBridge" -Confirm:$false
Stop-Process -Name "node" -ErrorAction SilentlyContinue
Write-Host "✅ Autostart entfernt." -ForegroundColor Green
