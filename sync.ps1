<#
.SYNOPSIS
  Executes 9router-auto-free remotely on the Kubernetes 9router pod and synchronizes state JSONs locally.

.DESCRIPTION
  Connects to the active 9router pod in Kubernetes, streams local code and configuration directly
  to persistent storage (/app/data/9router-auto-free), executes the model sync or test suite remotely
  against the live SQLite database and 9router HTTP proxy, and pulls updated state JSONs back to the
  local Windows workspace.

.PARAMETER Namespace
  The Kubernetes namespace where 9router is running. Defaults to 'router' (or $env:ROUTER_NAMESPACE).

.PARAMETER Pod
  Optional specific pod name. If not specified, dynamically detects the ready 9router pod.

.EXAMPLE
  .\sync.ps1
  Runs full daily sync remotely and pulls updated state files locally.

.EXAMPLE
  .\sync.ps1 --fast
  Runs quick sync remotely, skipping external catalog harvesting.

.EXAMPLE
  .\sync.ps1 --refresh
  Runs hourly watchdog refresh remotely.

.EXAMPLE
  .\sync.ps1 --test
  Runs the full test suite remotely on the pod.
#>
[CmdletBinding()]
param(
  [string]$Namespace = $(if ($env:ROUTER_NAMESPACE) { $env:ROUTER_NAMESPACE } else { 'router' }),
  [string]$Pod = '',
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ScriptArgs
)

$ErrorActionPreference = 'Stop'
$TargetDir = '/app/data/9router-auto-free'

Write-Host "`n====================================================" -ForegroundColor Cyan
Write-Host "  9router-auto-free -> Kubernetes Remote Runner     " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# 1. Discover ready 9router pod
$PodName = $Pod
if (-not $PodName) {
  Write-Host "[-] Waiting for healthy 9router pod (app=router) in namespace '$Namespace'..." -ForegroundColor DarkGray
  kubectl wait --for=condition=Ready pod -l app=router -n $Namespace --timeout=60s 2>$null | Out-Null
  $PodsOutput = (kubectl get pods -n $Namespace -l app=router -o jsonpath='{.items[?(@.status.containerStatuses[0].ready==true)].metadata.name}' 2>$null)
  if (-not $PodsOutput) {
    # Fallback to general running pod in namespace
    $PodsOutput = (kubectl get pods -n $Namespace --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>$null)
  }
  if ($PodsOutput) {
    $PodName = ($PodsOutput.Trim() -split '\s+')[0]
  }
}

if (-not $PodName) {
  Write-Error "[✗] No ready 9router pod found in namespace '$Namespace'. Check cluster connection and deployment status."
  exit 1
}

Write-Host "[✓] Target Pod: $PodName (namespace: $Namespace)" -ForegroundColor Green

# 2. Ensure persistent directory and convenience symlink exist on the pod
kubectl exec -n $Namespace $PodName -- sh -c "mkdir -p $TargetDir && ln -sfn $TargetDir /app/9router-auto-free 2>/dev/null || true" 2>$null

# 3. Stream local code & configuration directly to persistent PVC
Write-Host "[-] Streaming local code and state JSONs to $TargetDir..." -ForegroundColor DarkGray
$SyncCandidates = @(
  'sync.js', 'storage.js', 'providers.js', 'tester.js', 'scheduler.js',
  'update-benchmarks.js', 'fetch-external-models.js', 'web.js', 'test.js',
  'test-tester.js', 'test-persist-guard.js', 'package.json', 'package-lock.json',
  'index.html', 'provider-registry.json', 'exclusions.json', 'priorities.json', 'custom-providers.json',
  'dead-models.json', 'benchmarks.json', 'external-models.json', 'candidates-state.json'
)

$ExistingFiles = $SyncCandidates | Where-Object { Test-Path -Path $_ }
$FileList = $ExistingFiles -join ' '

$PushCmd = "tar -czf - $FileList | kubectl exec -i -n $Namespace $PodName -- tar -xzf - -C $TargetDir"
cmd.exe /c $PushCmd
if ($LASTEXITCODE -ne 0) {
  Write-Error "[✗] Failed to sync files to pod (tar exit code: $LASTEXITCODE)."
  exit $LASTEXITCODE
}
# Normalize permissions across container images/users
kubectl exec -n $Namespace $PodName -- chmod -R ugo+rw $TargetDir 2>$null
Write-Host "[✓] Synchronized $($ExistingFiles.Count) files to $TargetDir on pod." -ForegroundColor Green

# 4. Determine command to execute
$IsTest = $ScriptArgs -contains '--test'
$CleanArgs = ($ScriptArgs | Where-Object { $_ -ne '--test' }) -join ' '

if ($IsTest) {
  $RemoteCmd = "NODE_PATH=/app/node_modules node test.js && node test-tester.js && node test-persist-guard.js"
  Write-Host "[*] Executing test suite remotely on pod..." -ForegroundColor Yellow
} else {
  $RemoteCmd = if ($CleanArgs) { "NODE_PATH=/app/node_modules node sync.js $CleanArgs" } else { "NODE_PATH=/app/node_modules node sync.js" }
  Write-Host "[*] Executing remote command: $RemoteCmd" -ForegroundColor Cyan
}

# 5. Execute remotely with live output
kubectl exec -i -n $Namespace $PodName -- sh -c "cd $TargetDir && $RemoteCmd"
$ExitCode = $LASTEXITCODE

# 6. Guarded state retrieval
if ($ExitCode -eq 0) {
  Write-Host "`n[-] Pulling updated state JSONs from pod to local workspace..." -ForegroundColor DarkGray
  $StateFiles = "dead-models.json benchmarks.json external-models.json candidates-state.json"
  $PullCmd = "kubectl exec -i -n $Namespace $PodName -- sh -c ""cd $TargetDir && tar -czf - $StateFiles 2>/dev/null"" | tar -xzf -"
  cmd.exe /c $PullCmd
  Write-Host "====================================================" -ForegroundColor Cyan
  Write-Host "[✓] Remote execution and bidirectional state sync completed successfully." -ForegroundColor Green
  Write-Host "====================================================`n" -ForegroundColor Cyan
} elseif ($ExitCode -eq 137) {
  Write-Host "`n====================================================" -ForegroundColor Red
  Write-Host "[!] Remote process was terminated by Kubernetes (Exit 137: SIGKILL / OOM / Pod Rollout)." -ForegroundColor Red
  Write-Host "[!] Local state was preserved untouched." -ForegroundColor Yellow
  Write-Host "====================================================`n" -ForegroundColor Red
} else {
  Write-Host "`n====================================================" -ForegroundColor Yellow
  Write-Host "[!] Remote execution completed with exit code $ExitCode." -ForegroundColor Yellow
  Write-Host "====================================================`n" -ForegroundColor Yellow
}

exit $ExitCode
