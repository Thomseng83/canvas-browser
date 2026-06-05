' Startet den Bridge-Server unsichtbar im Hintergrund (kein Konsolenfenster)
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run "node """ & WScript.Arguments(0) & """", 0, False
