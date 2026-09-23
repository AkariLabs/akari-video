# Shell preview entrance boundary (round 2)

The rebuilt shell output preview and OSR used the same neutral pseudo-element entrance fixture. The preview was sought through `akari.preview.seekOutput` to frame 0 and frame 1 at 30 fps. Stage-only screenshots are 332×186 px, each under 500 KB.

| Frame | Preview MD5 | Preview center RGB | OSR center RGB | State |
|---:|---|---|---|---|
| 0 | 0e913d7f572e754060f6298759595e32 | 27, 40, 62 | 24, 40, 64 | 0% / hidden |
| 1 | bed6c84efba4a8811ed12911a8d8fe90 | 30, 42, 63 | 27, 42, 64 | slightly visible |

The difference in RGB is the shell screenshot/display path. Both preview and OSR show the entrance at 0% on frame 0 and a small change on frame 1. The existing one-frame negative-delay guidance is therefore retained.
