param([string]$Src, [string]$Dst, [string]$SrcWt, [string]$DstWt)
New-Item -ItemType Directory -Force $Dst | Out-Null
function Link($srcItem, $dstPath) {
  if ($srcItem.Attributes -match 'ReparsePoint') {
    $t = [string]$srcItem.Target
    if ($t.StartsWith($SrcWt, [StringComparison]::OrdinalIgnoreCase)) { $t = $DstWt + $t.Substring($SrcWt.Length) }
    New-Item -ItemType Junction -Path $dstPath -Target $t | Out-Null
  } elseif ($srcItem.PSIsContainer) {
    New-Item -ItemType Junction -Path $dstPath -Target $srcItem.FullName | Out-Null
  } else { Copy-Item $srcItem.FullName $dstPath }
}
Get-ChildItem $Src -Force | ForEach-Object {
  $d = Join-Path $Dst $_.Name
  if ($_.Name.StartsWith('@') -and -not ($_.Attributes -match 'ReparsePoint')) {
    New-Item -ItemType Directory -Force $d | Out-Null
    Get-ChildItem $_.FullName -Force | ForEach-Object { Link $_ (Join-Path $d $_.Name) }
  } else { Link $_ $d }
}
"done $Dst"
