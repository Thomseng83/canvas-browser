$id  = if ($env:CB_ID)  { [int]$env:CB_ID }  else { 1 }
$sel = if ($env:CB_SEL) { '"' + $env:CB_SEL + '"' } else { 'null' }
$body = '{"cmd":"getPageText","payload":{"id":' + $id + ',"selector":' + $sel + '}}'
$r = Invoke-RestMethod -Uri "http://localhost:3000/command" -Method POST -ContentType "application/json" -Body $body
[System.IO.File]::WriteAllText("C:\CLAUDE_CODE\canvas-browser\page_text.txt", $r.text, [System.Text.UTF8Encoding]::new($false))
Write-Host "OK:$($r.text.Length) Zeichen (Panel $id)"
