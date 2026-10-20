**English** | [日本語](./geo-terrain.ja.md)

# Make terrain assets from GSI tiles

`akari geo terrain` downloads elevation tiles (`dem_png`) and photo tiles (`seamlessphoto`) from
the Geospatial Information Authority of Japan (GSI), stitches and crops them to a bounding box, and
writes the three files a 3D terrain declaration reads.

GSI Tiles are free and need no authentication. Their terms require **attribution**; the command
always writes the credit into `terrain.json` and prints it in the CLI output.

## Command

```sh
akari geo terrain \
  --bbox 139.3445,35.5960,139.3555,35.6050 \
  --zoom 14 \
  --out assets/terrain/sagamihara
```

| Option | Meaning |
|---|---|
| `--bbox <west,south,east,north>` | Area in WGS84 degrees (required). `west < east` and `south < north` |
| `--out <dir>` | Output directory (required) |
| `--zoom <1-14>` | Tile zoom (default `14`). Larger is more detailed and uses more tiles |
| `--max-tiles <n>` | Upper bound on tiles per layer (default `64`) |
| `--cache-dir <dir>` | Tile cache (default `~/.akari/cache/geo`) |
| `--json` | Print the result as JSON |

If the bbox needs more tiles than the limit, the command stops **before downloading anything** and
tells you which lower zoom fits. It never lowers the zoom silently.

## Output

| File | Contents |
|---|---|
| `heightmap.png` | Elevation tiles stitched as-is in the `gsi-dem` encoding (8-bit RGB: `R*65536 + G*256 + B`, in 1/100 m). Invalid `(128,0,0)` pixels are filled from the nearest valid pixel. A missing (`404`) elevation tile is treated as all-invalid and filled the same way |
| `texture.png` | Photo tiles stitched and cropped to the same rectangle. A missing (`404`) photo tile is filled with a solid sea color (`#2a4d69`) |
| `terrain.json` | Bounds, zoom, real-world size, elevation range, encoding, missing tile counts, and attribution |

```json
{
  "bbox": [139.3445, 35.596, 139.3555, 35.605],
  "zoom": 14,
  "size_m": [1002.2, 1009.9],
  "elevation_m": [124.19, 170.33],
  "encoding": "gsi-dem",
  "missing_tiles": { "dem": 0, "photo": 0 },
  "attribution": "出典: 国土地理院（地理院タイル）"
}
```

`size_m` is `[width, depth]` in meters. It uses the cropped pixel count and the ground resolution at
the bbox center latitude, so it matches the image rather than the unrounded bbox. `elevation_m` is
`[minimum, maximum]` over the valid elevation pixels inside the crop (filled pixels do not change
the range).

`missing_tiles` counts the tiles that returned `404`. GSI returns `404` for tiles that are ocean or
out of range. A bbox that includes water still succeeds: the elevation is interpolated and the photo
is filled with the sea color. When **every** elevation tile in the bbox is missing, the command
stops before writing outputs and asks for a bbox that includes land. `404` is the only status handled
this way; other `4xx` errors fail immediately and `5xx` errors are retried.

## Attribution rules

- Keep the `attribution` field in `terrain.json`; do not strip or rewrite it.
- When the terrain appears in a video, show the credit **"出典: 国土地理院（地理院タイル）"**
  (Source: Geospatial Information Authority of Japan, GSI Tiles) on screen or in the credits /
  description. The CLI prints the same line after every successful run.
- The elevation encoding and the credit are part of the GSI tile terms. If you convert or
  redistribute the outputs, carry the credit with them.

## Cache and network

Downloaded tiles are cached under `~/.akari/cache/geo/` (`AKARI_GEO_CACHE_DIR` overrides it) and
are never fetched again. A second run with the same bbox and zoom works offline. Tiles are
requested one at a time from `cyberjapandata.gsi.go.jp`; only tile numbers are sent.

Tests never touch the network. They replace the fetch function and use small tile fixtures to check
tile numbering, stitching and cropping, invalid-pixel filling, `404` handling (partial and
all-missing), the terrain.json values, the tile limit, and cache reuse. A small committed JPEG
fixture checks ffmpeg-based photo decoding; that test is skipped (with a message) when ffmpeg is not
available.

## Related

- Photo tiles are JPEG. The command decodes them with the ffmpeg that AKARI already resolves for
  media work; no extra image library is added.
- The `terrain` declaration itself (how a 3D scene reads the heightmap, texture, size, and
  exaggeration) is owned by the 3D authoring path, not by this command.
