$response = Invoke-RestMethod -Uri "http://localhost:3000/command" -Method POST -ContentType "application/json" -Body '{"cmd":"screenshot"}'
$base64 = $response.dataUrl -replace '^data:image/jpeg;base64,', ''
[System.IO.File]::WriteAllBytes('C:\CLAUDE_CODE\canvas-browser\screenshot_test.jpg', [Convert]::FromBase64String($base64))
Write-Host "OK"
