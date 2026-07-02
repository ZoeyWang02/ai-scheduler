param(
    [string]$EnvFile = ".env",
    [switch]$NoStopExisting,
    [switch]$Background
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$ResolvedEnvFile = if ([System.IO.Path]::IsPathRooted($EnvFile)) {
    $EnvFile
} else {
    Join-Path $ProjectRoot $EnvFile
}

if (-not (Test-Path -LiteralPath $ResolvedEnvFile)) {
    throw "Missing $ResolvedEnvFile. Copy .env.example to .env and fill in your local values."
}

Get-Content -LiteralPath $ResolvedEnvFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
        return
    }

    $key, $value = $line -split "=", 2
    if (-not $key) {
        return
    }

    [Environment]::SetEnvironmentVariable($key.Trim(), $value.Trim(), "Process")
}

Set-Location $ProjectRoot

function Stop-ExistingPortProcess {
    $port = [Environment]::GetEnvironmentVariable("SERVER_PORT", "Process")
    if (-not $port) {
        $port = "8081"
    }

    $processIds = @()
    $listeners = netstat -ano | Select-String ":$port\s+.*LISTENING"
    foreach ($listener in $listeners) {
        $parts = ($listener.ToString() -split "\s+") | Where-Object { $_ }
        $processId = $parts[-1]
        if ($processId -and $processId -match "^\d+$" -and $processId -ne $PID) {
            $processIds += $processId
        }
    }

    foreach ($processId in ($processIds | Select-Object -Unique)) {
        if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
            Write-Host "Stopping existing process on port $port (PID $processId)..."
            taskkill /PID $processId /F | Out-Null
            Start-Sleep -Seconds 1
        }
    }
}

if (-not $NoStopExisting) {
    Stop-ExistingPortProcess
}

if ($Background) {
    $envBlock = "set DB_URL=$env:DB_URL&& set DB_USERNAME=$env:DB_USERNAME&& set DB_PASSWORD=$env:DB_PASSWORD&& set SERVER_PORT=$env:SERVER_PORT&& set LLM_API_URL=$env:LLM_API_URL&& set LLM_API_KEY=$env:LLM_API_KEY&& set LLM_MODEL=$env:LLM_MODEL&& set GOOGLE_CLIENT_ID=$env:GOOGLE_CLIENT_ID&& set GOOGLE_CLIENT_SECRET=$env:GOOGLE_CLIENT_SECRET&& set GOOGLE_REDIRECT_URI=$env:GOOGLE_REDIRECT_URI"
    $cmd = "/c `"$envBlock&& mvn spring-boot:run > app.log 2> app.err.log`""
    $process = Start-Process -FilePath "cmd.exe" -ArgumentList $cmd -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath (Join-Path $ProjectRoot "app.pid") -Value $process.Id
    Write-Host "Started AI Scheduler in background. Launcher PID: $($process.Id)"
    Write-Host "Logs: app.log and app.err.log"
    return
}

mvn spring-boot:run
