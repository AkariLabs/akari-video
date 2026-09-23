# Oversize plane investigation

Both fixtures use 1920×1080 output and extend a patterned plane beyond the full frame. The CSS perspective plane measures 3200×1900 CSS px. The GLB plane is 10×6 world units with repeated checker texture and depth varying across the surface.

| Fixture | Midpoint seek | Continuous 20-frame output |
|---|---|---|
| CSS perspective | frame 10 stamp matched, 1 retry | 20/20 frames encoded, 2.000 s and 1920×1080 verified |
| Textured GLB plane | frame 10 stamp matched, 1 retry, no renderer warnings; PNG MD5 d01a904e6afaeada976877deb525bd75 | child run completed 20/20, stamp mode with 9 retries total; ffprobe matched 20 frames, 2.000 s, 1920×1080; no renderer warnings |

The retained GLB seek screenshot has a continuous checker pattern with no black area or missing tiles. Neither fixture reproduced the reported stamp failure or texture loss. The GLB continuous run wrote a verified intermediate video, but its launcher remained alive after the child recorded completion; stopping only that run's Electron PID caused the wrapper to remove the intermediate. A final video and a visual check of every continuous frame remain unverified.

The report may depend on a particular model, texture size, GPU, or seek/paint timing. The seek receipt needed one retry; the continuous run needed nine retries across 20 frames, so delayed OSR paint is plausible. This fixture does not justify changing the stamp retry or texture limits. The current stamp path already fails with an explicit error after its retry budget; a texture that is black without a failed render status would still need a separate detection signal.
