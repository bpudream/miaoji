param(
  [Parameter(Mandatory = $false)]
  [int]$Port = 13636,

  [Parameter(Mandatory = $false)]
  [ValidateSet('ipv4','ipv6','both')]
  [string]$IpVersion = 'both',

  [Parameter(Mandatory = $false)]
  [ValidateSet('tcp')]
  [string]$Protocol = 'tcp'
)

$ErrorActionPreference = 'Stop'

function Get-ExcludedRanges {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('ipv4','ipv6')]
    [string]$Ver,

    [Parameter(Mandatory = $true)]
    [ValidateSet('tcp')]
    [string]$Proto
  )

  $lines = & netsh interface $Ver show excludedportrange protocol=$Proto 2>$null
  if (-not $lines) { return @() }

  $ranges = @()
  foreach ($l in $lines) {
    if ($l -match '^\s*(\d+)\s+(\d+)\s*$') {
      $start = [int]$Matches[1]
      $count = [int]$Matches[2]
      $end = $start + $count - 1
      $ranges += [pscustomobject]@{
        IpVersion = $Ver
        Protocol  = $Proto
        Start     = $start
        End       = $end
        Count     = $count
      }
    }
  }
  return $ranges
}

function Find-PortInRanges {
  param(
    [Parameter(Mandatory = $true)]
    [int]$P,

    [Parameter(Mandatory = $true)]
    [object[]]$Ranges
  )

  return $Ranges | Where-Object { $P -ge $_.Start -and $P -le $_.End }
}

Write-Host "Checking excluded port ranges for port: $Port (protocol: $Protocol, ip: $IpVersion)" -ForegroundColor Cyan

$allRanges = @()
if ($IpVersion -eq 'ipv4' -or $IpVersion -eq 'both') {
  $allRanges += Get-ExcludedRanges -Ver 'ipv4' -Proto $Protocol
}
if ($IpVersion -eq 'ipv6' -or $IpVersion -eq 'both') {
  $allRanges += Get-ExcludedRanges -Ver 'ipv6' -Proto $Protocol
}

if (-not $allRanges -or $allRanges.Count -eq 0) {
  Write-Host "No excluded port range entries found (or insufficient permission to query)." -ForegroundColor Yellow
  exit 0
}

$hit = Find-PortInRanges -P $Port -Ranges $allRanges
if ($hit -and $hit.Count -gt 0) {
  Write-Host "HIT: Port $Port is within excluded port range(s):" -ForegroundColor Red
  $hit | Sort-Object IpVersion, Start | Format-Table -AutoSize
  exit 2
}

Write-Host "OK: Port $Port is NOT in excluded port ranges." -ForegroundColor Green
exit 0

