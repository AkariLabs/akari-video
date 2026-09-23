# B-1 GPU BEFORE capture (round 2)

The same neutral depth-animation fixture was captured through the GPU route with `force: true` and `AKARI_EXPORT_ALLOW_DESKTOP=0`. Launcher resolution selected tier 2, and the observed child command used the worktree's npm Electron GPU entry. The child run recorded `status: completed` and frame-engine readback matched frames 9, 30, 75. Its eligibility record retained `degraded: 1` with `forced-dom:css-3d-transform`.

| Timeline time | Frame | PNG MD5 |
|---|---:|---|
| 0.3 s | 9 | a05a67a7f64ae25b7f3d2fbc7839d739 |
| 1.0 s | 30 | 83c0903a14a5ad837161634cfae6870c |
| 2.5 s | 75 | 1855be399befaa951adb57818611b806 |

The three frames differ and show the panel rotating. This neutral fixture did **not** reproduce the reported frozen GPU frame. The exact cause of the report therefore remains unverified. The child did not exit after writing its completed run, so no parent receipt containing `launcher_tier` was produced; tier 2 is backed by launcher resolution and the observed child command. Complete logs remain in temporary output, not here.
