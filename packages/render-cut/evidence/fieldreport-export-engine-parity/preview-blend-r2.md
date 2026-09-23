# Shell preview blend comparison (round 2)

The rebuilt shell ran in an isolated Electron profile with CDP on port 9479. Its output preview was opened from a neutral v2 edit, then `akari.preview.seekOutput` sought to timeline second 1 after each edit variant was loaded. Stage-only screenshots are retained at 332×186 px. Each is under 500 KB.

| Edit blend | Preview screenshot MD5 | Preview center RGB | OSR overlap RGB |
|---|---|---|---|
| normal | f65e8b796e97d3816530c845bd9c63b3 | 120, 68, 39 | 128, 64, 32 |
| screen | f65e8b796e97d3816530c845bd9c63b3 | 120, 68, 39 | 152, 124, 144 |
| add | f65e8b796e97d3816530c845bd9c63b3 | 120, 68, 39 | 176, 144, 160 |

The preview DOM gave both HTML overlay roots computed `mix-blend-mode: normal` in all three cases. The shell's `LAYER_BLEND_TO_CSS` map is used in `buildLayerSummaryBase` for `layers[]`; this HTML overlay route does not apply the item's `blend`. Thus the new OSR screen/add result does **not** match this shell preview. The preview-side fix is outside this task's file boundary; no shell source was edited. The small normal-versus-OSR normal RGB offset reflects the shell screenshot's display/color pipeline and does not affect the equality across its three preview variants.
