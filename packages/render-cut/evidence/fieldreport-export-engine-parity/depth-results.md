# Depth animation capture

Neutral CSS depth fixture, `akari capture --engine auto --separate`, OSR selected (`GPU ineligible`). Stamp matched at frames 9, 30, 75, each with zero retries.

| Time | Frame | MD5 |
|---|---:|---|
| 0.3 s | 9 | 4ecdbd11a5f59a71b22bdb28744b6523 |
| 1.0 s | 30 | 2fe71ccf4595ed32944e7e9e7da40b87 |
| 2.5 s | 75 | eb98c61b9b172757f8ba3d15a8f1a858 |

All three frames differ. The full capture receipt stays in temporary output because it embeds machine paths; this summary records its engine and verification fields.

Round-2 rerun after narrowing eligibility to authored animation/inline style produced the same three md5 values, resolved `auto → osr`, and matched all three stamps with zero retries.
