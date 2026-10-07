# One full speedrun to watch: a brand-new world on serverdell, then the bot plays it from the first log to the ender
# dragon, printing its progress and splits in this window. Ctrl+C stops it. Needs the Ollama app running.
#   powershell -ExecutionPolicy Bypass -File pc-runner\run-once.ps1
# Watch it in game: join 192.168.1.144 (Minecraft 1.21.6), then /gamemode spectator and /spectate andy (both need op).
# Or the bot's own view at http://localhost:3000.
Set-Location (Split-Path -Parent $PSScriptRoot)

# a bot left over from an earlier run holds the MindServer's port, and the new one would crash at once
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'tasks/basic/beat_game\.json|init_agent\.js andy ' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Write-Host 'Making a new world on serverdell (takes about 30 seconds)...'
ssh -o BatchMode=yes kieron@192.168.1.144 mindcraft-speedrun/new-world.sh

$env:MINDCRAFT_STATUS_SECONDS = '10'
$env:MINDCRAFT_VIEWER_HOST = '127.0.0.1'
$env:MINDCRAFT_VIEWER_THIRD_PERSON = '1'
$env:PROFILES = '["./pc-runner/andy.json"]'
$env:SETTINGS_JSON = '{"host": "192.168.1.144", "port": 25565, "init_message": "", "auto_open_ui": false, "render_bot_view": true, "allow_insecure_coding": true, "load_memory": false}'
# the whole game, not just into the nether: the kit makes the chestplate and golden boots too
Remove-Item Env:MINDCRAFT_NETHER_ONLY -ErrorAction SilentlyContinue

node main.js --task_path tasks/basic/beat_game.json --task_id beat_the_game
