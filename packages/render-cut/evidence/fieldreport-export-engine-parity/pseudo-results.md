# Pseudo-element entrance capture

Neutral `::before` opacity animation. OSR tier 2, stamp matched at frames 0, 1, 30. The pseudo-element is absent at frame 0 (0% opacity) and visible at frame 30 (50% opacity). The host panel remains visible at both times.

| Frame | MD5 |
|---:|---|
| 0 | cd33710abcf497904c78d9b3dc1d974b |
| 1 | f8b4b071becd7f96bc1f3a023962ef7a |
| 30 | 6a68486bfed8337bbf24ba00ff0336b6 |

The clone unit test confirms `pseudoElement: '::before'`, a 2000 ms item offset, and no host `animationName` mutation. Round-2 shell preview screenshots at frames 0 and 1 match the same boundary behavior; see `preview-entrance-r2.md`.
