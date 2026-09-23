# Shell preview video-texture comparison (round 2)

The rebuilt shell output preview was sought through `akari.preview.seekOutput` at timeline 2.5 and 3.5 seconds for a 3D screen item starting at second 2. The preview's detached video element reported `currentTime` 0.5 and 1.5 seconds with `readyState: 4`. Stage-only screenshots are retained at 332×186 px, each under 500 KB.

| Timeline | Preview video time | Preview screenshot MD5 | Preview center RGB | OSR center RGB | Content |
|---:|---:|---|---|---|---|
| 2.5 s | 0.5 s | 3a7c71ac0ed0da9ec9918f6815c9423e | 230, 67, 52 | 250, 43, 36 | red |
| 3.5 s | 1.5 s | 3514eee027d67427b96150b5195dd081 | 63, 141, 46 | 0, 143, 22 | green |

Preview and OSR show the same video quarter at each timeline time. The RGB offset is from the shell screenshot/display path; both are solid red then green. `packages/overlay-runtime/src/overlay-runtime.js` computes local time from timeline time minus overlay start, and its render call does not apply HTML overlay `in` or `speed`.
