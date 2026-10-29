param([string]$FilePath,[int]$Milliseconds=400)
$handle=[IO.File]::Open($FilePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
try { [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); Start-Sleep -Milliseconds $Milliseconds }
finally { $handle.Dispose() }
