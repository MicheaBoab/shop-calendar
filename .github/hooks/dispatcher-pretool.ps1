param()

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) {
  $result = @{
    hookSpecificOutput = @{
      hookEventName = 'PreToolUse'
      permissionDecision = 'ask'
      permissionDecisionReason = 'No hook payload; request manual confirmation.'
    }
  } | ConvertTo-Json -Depth 8 -Compress
  Write-Output $result
  exit 0
}

try {
  $payload = $raw | ConvertFrom-Json -Depth 30
} catch {
  $result = @{
    hookSpecificOutput = @{
      hookEventName = 'PreToolUse'
      permissionDecision = 'ask'
      permissionDecisionReason = 'Invalid hook payload; request manual confirmation.'
    }
  } | ConvertTo-Json -Depth 8 -Compress
  Write-Output $result
  exit 0
}

function Find-ToolName {
  param([object]$Node)
  if ($null -eq $Node) { return $null }

  if ($Node -is [string]) { return $null }

  if ($Node -is [System.Collections.IEnumerable] -and -not ($Node -is [System.Collections.IDictionary])) {
    foreach ($item in $Node) {
      $found = Find-ToolName -Node $item
      if ($found) { return $found }
    }
    return $null
  }

  $props = $Node.PSObject.Properties
  foreach ($prop in $props) {
    $nameLower = $prop.Name.ToLowerInvariant()
    if (($nameLower -eq 'toolname' -or $nameLower -eq 'tool_name' -or $nameLower -eq 'tool') -and ($prop.Value -is [string])) {
      return [string]$prop.Value
    }
  }

  foreach ($prop in $props) {
    $found = Find-ToolName -Node $prop.Value
    if ($found) { return $found }
  }

  return $null
}

$toolName = Find-ToolName -Node $payload
$allowed = @('runSubagent', 'agent', 'functions.runSubagent')

if ($toolName -and ($allowed -contains $toolName)) {
  $result = @{
    hookSpecificOutput = @{
      hookEventName = 'PreToolUse'
      permissionDecision = 'allow'
      permissionDecisionReason = 'Dispatcher may only invoke subagents.'
    }
  } | ConvertTo-Json -Depth 8 -Compress
  Write-Output $result
  exit 0
}

$toolLabel = if ($toolName) { $toolName } else { 'unknown-tool' }
$result = @{
  hookSpecificOutput = @{
    hookEventName = 'PreToolUse'
    permissionDecision = 'deny'
    permissionDecisionReason = "Dispatcher policy blocked direct tool call: $toolLabel"
  }
} | ConvertTo-Json -Depth 8 -Compress
Write-Output $result
exit 0
