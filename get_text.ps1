param(
    [int]$id       = 1,
    [string]$sel   = ''
)
$selJson = if ($sel) { '"' + $sel + '"' } else { 'null' }
$body = '{"cmd":"getPageText","payload":{"id":' + $id + ',"selector":' + $selJson + '}}'
$r = Invoke-RestMethod -Uri "http://localhost:3000/command" -Method POST -ContentType "application/json" -Body $body
[System.IO.File]::WriteAllText("C:\CLAUDE_CODE\canvas-browser\page_text.txt", $r.text, [System.Text.UTF8Encoding]::new($false))
Write-Host "OK:$($r.text.Length) Zeichen (Panel $id)"
