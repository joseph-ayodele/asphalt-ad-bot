# Stops only the bots in this folder; any other AutoHotkey script keeps running.
$dir = $PSScriptRoot
$bots = Get-CimInstance Win32_Process -Filter "Name LIKE 'AutoHotkey%'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($dir, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
foreach ($b in $bots) { Stop-Process -Id $b.ProcessId -Force }

$msg = if ($bots) { "Stopped $(@($bots).Count) bot(s)." } else { "No bots were running." }
(New-Object -ComObject WScript.Shell).Popup($msg, 3, "Asphalt ad bots", 64) | Out-Null
