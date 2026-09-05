#!/bin/bash
# macOS: brew install librsvg; run this script after editing background.svg.
# CI uses the committed Retina TIFF and does not run this generator.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
resource_dir="$script_dir/../resources/dmg"
rsvg_bin="${RSVG_CONVERT:-rsvg-convert}"
if ! command -v "$rsvg_bin" >/dev/null 2>&1; then
  rsvg_bin=/opt/homebrew/bin/rsvg-convert
fi
scratch_dir="$(mktemp -d "${TMPDIR:-/tmp}/akari-dmg-background.XXXXXX")"
trap 'rm -rf "$scratch_dir"' EXIT
"$rsvg_bin" --width 660 --height 400 --output "$scratch_dir/background.png" "$resource_dir/background.svg"
"$rsvg_bin" --width 1320 --height 800 --output "$scratch_dir/background@2x.png" "$resource_dir/background.svg"
tiffutil -cathidpicheck "$scratch_dir/background.png" "$scratch_dir/background@2x.png" -out "$scratch_dir/background.tiff"
mv "$scratch_dir/background.tiff" "$resource_dir/background.tiff"
