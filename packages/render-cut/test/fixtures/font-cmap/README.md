# Font cmap fixtures

Run from the repository root with Python, fontTools 4.66.1, and brotli available:

```sh
python packages/render-cut/test/fixtures/font-cmap/generate.py
```

`expected.json` uses each bundled OFL font's `TTFont.getBestCmap()`. The digest is SHA-256 of sorted decimal code points, each followed by a newline. The sample TTF, WOFF, WOFF2, and TTC contain the same subset of the bundled Shippori Mincho. `retain-gids.woff2` is a six-character subset with glyph IDs retained. `LICENSE.txt` is its OFL license.
