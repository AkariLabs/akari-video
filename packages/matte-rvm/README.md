# Robust Video Matting integration policy
Robust Video Matting (RVM) upstream is licensed under GPL-3.0, while this product is distributed under MIT.
The product therefore bundles neither RVM code nor model weights; an opt-in command downloads weights from upstream onto the user's machine.
The upstream URLs and sha256 checksums are pinned in `src/model-manifest.mjs`.
`scripts/release/check-no-gpl-redistribution.mjs` enforces this distribution boundary mechanically.
