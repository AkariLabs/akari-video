# BEFORE

Neutral tones: BGM 1 = 440 Hz; BGM 2 = 880 Hz; narration = 1200 Hz. Intervals in seconds. JSON contains measured RMS, zero-crossing frequencies, per-tone amplitudes, and preview schedule outputs. This run uses the af19dd23 baseline. The legacy projection and preview schedule contain only the final BGM. Source media and rendered media were generated under a temporary directory and are not retained.

- adjacent: lint fail; projected 1 BGM(s); selected two.wav; plan 5 audio input(s); rendered success; windows 0.5s:0Hz/0, 1.25s:1195Hz/0.08832, 2.5s:0Hz/0, 3.5s:875Hz/0.08834, 4.25s:1195Hz/0.09106, 4.5s:880Hz/0.02665, 5.5s:875Hz/0.08834
- gap: lint fail; projected 1 BGM(s); selected two.wav; plan 5 audio input(s); rendered success; windows 0.5s:0Hz/0, 1.25s:1195Hz/0.08832, 2.5s:0Hz/0, 3.5s:0Hz/0, 4.25s:1195Hz/0.09106, 4.5s:880Hz/0.02665, 5.5s:875Hz/0.08834
- overlap: lint fail; projected 1 BGM(s); selected two.wav; plan 5 audio input(s); rendered success; windows 0.5s:0Hz/0, 1.25s:1195Hz/0.08832, 2.5s:0Hz/0, 3.5s:875Hz/0.08834, 4.25s:1195Hz/0.09106, 4.5s:880Hz/0.02665, 5.5s:875Hz/0.08834
