# AFTER

Neutral tones: BGM 1 = 440 Hz; BGM 2 = 880 Hz; narration = 1200 Hz. Intervals in seconds. JSON contains measured RMS, zero-crossing frequencies, per-tone amplitudes, and preview schedule outputs. In the adjacent case, BGM 1 falls from 0.12404 to 0.03124 and BGM 2 from 0.12472 to 0.03133 during narration (both about -12 dB). Source media and rendered media were generated under a temporary directory and are not retained.

- adjacent: lint pass; projected 2 BGM(s); selected one.wav; plan 7 audio input(s); rendered success; windows 0.5s:435Hz/0.08773, 1.25s:1200Hz/0.09124, 2.5s:435Hz/0.08839, 3.5s:880Hz/0.0882, 4.25s:1195Hz/0.09101, 4.5s:880Hz/0.02666, 5.5s:875Hz/0.08847
- gap: lint pass; projected 2 BGM(s); selected one.wav; plan 7 audio input(s); rendered success; windows 0.5s:435Hz/0.08773, 1.25s:1200Hz/0.09124, 2.5s:0Hz/0, 3.5s:0Hz/0, 4.25s:1195Hz/0.09106, 4.5s:880Hz/0.02665, 5.5s:875Hz/0.08834
- overlap: lint fail; projected 2 BGM(s); selected one.wav; plan 7 audio input(s); rendered success; windows 0.5s:435Hz/0.08773, 1.25s:1200Hz/0.09124, 2.5s:435Hz/0.08839, 3.5s:875Hz/0.12486, 4.25s:1195Hz/0.09105, 4.5s:880Hz/0.02665, 5.5s:875Hz/0.08824
