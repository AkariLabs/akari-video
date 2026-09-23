# OSR blend capture

Neutral 320×180, 30 fps fixture. OSR launcher tier 2; stamp matched at frame 30 for normal, screen, add. Sample pixel: (100, 60), RGB.

| Mode | MD5 | RGB |
|---|---|---|
| normal | a990c0d38e731ee55f87009bd2694772 | 128, 64, 32 |
| screen | 50fc07c3aa840955edcbb71051ea7b09 | 152, 124, 144 |
| add | ca2b1c3dd694ddbff0f2e187a62f2795 | 176, 144, 160 |

The screen result equals `1 - (1 - background) * (1 - source)` per channel to rounding; add equals saturated channel addition. The three PNGs are retained here. Temporary capture output is excluded. Unknown blend values now emit a build warning through the OSR warnings path and use normal composition.

The shell's read-only layer blend map uses the same ten CSS mode spellings, including `add → plus-lighter`, `hardlight → hard-light`, and `softlight → soft-light`. Its HTML overlay preview did not apply that map; see `preview-blend-r2.md` for actual shell screenshots and the boundary-limited mismatch.
