# test-project media fixtures

Binary fixtures in this directory were generated locally with **ffmpeg** for preview-server / Playwright tests.

## Regeneration

```bash
cd test-project

# Video (SMPTE test pattern + sine audio)
ffmpeg -y -f lavfi -i testsrc=size=640x360:rate=30:duration=10 \
  -f lavfi -i sine=frequency=440:duration=10 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac source.mp4
cp source.mp4 source2.mp4

# BGM (sine tone, ~3s)
ffmpeg -y -f lavfi -i sine=frequency=220:duration=3 \
  -c:a libmp3lame -q:a 4 bgm.mp3

# Narration placeholders (short sine tones)
ffmpeg -y -f lavfi -i sine=frequency=330:duration=1 -c:a libmp3lame -q:a 4 narration/n-0001.mp3
ffmpeg -y -f lavfi -i sine=frequency=440:duration=1 -c:a libmp3lame -q:a 4 narration/n-0002.mp3
```

License: synthetic test signals only (no third-party audio).
