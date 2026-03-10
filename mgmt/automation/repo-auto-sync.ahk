#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent

SetTimer(SyncTick, 300000) ; 5 minutes
SyncTick()

SyncTick(*) {
    tickScript := A_ScriptDir "\..\scripts\auto-sync-tick.ps1"
    cmd := 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' tickScript '"'
    Run(cmd, A_ScriptDir, "Hide")
}
