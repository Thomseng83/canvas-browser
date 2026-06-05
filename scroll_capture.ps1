param(
    [int]$id        = 1,
    [int]$step      = 700,
    [int]$maxScrolls = 8
)
$body = '{"cmd":"scrollAndCapture","payload":{"id":' + $id + ',"step":' + $step + ',"maxScrolls":' + $maxScrolls + '}}'
$response = Invoke-RestMethod -Uri "http://localhost:3000/command" -Method POST -ContentType "application/json" -Body $body
if ($response.error) { Write-Host "Fehler: $($response.error)"; exit 1 }
$i = 0
foreach ($sc in $response.screenshots) {
    $base64 = $sc.dataUrl -replace '^data:image/jpeg;base64,', ''
    $path = "C:\CLAUDE_CODE\canvas-browser\scroll_$i.jpg"
    [System.IO.File]::WriteAllBytes($path, [Convert]::FromBase64String($base64))
    $i++
}
Write-Host "OK:$i"
