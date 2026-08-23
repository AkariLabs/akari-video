# Cross-track image overlap fixture

`edit.json` reproduces the cross-track still-image overlap that previously selected the
winner-take-all `cuts` engine:

- `v1` / photo A: red, full frame, `[0s, 12s)`
- `v4` / photo B: green, centered at 50% scale, `[4s, 8s)`

The track array is bottom-to-top, so photo B must appear in front of photo A during the overlap.
At `t=2s` and `t=10s`, the frame is red only. At `t=6s`, the center is green while the area outside
photo B remains red; no black stage background may be exposed.
