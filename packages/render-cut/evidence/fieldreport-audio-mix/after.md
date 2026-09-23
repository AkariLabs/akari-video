# AFTER

Neutral 136 item fixture (15 narration, 1 bed, 120 effects). Command length uses a conservative quoted UTF-16 upper bound.

- shared: 618 characters, 19 inputs; BGM at narration start -12 dB; QC INCONCLUSIVE; tool ffmpeg version 8.1.1 Copyright (c) 2000-2026 the FFmpeg developers
- distinct: 2962 characters, 138 inputs; BGM at narration start -12 dB; QC INCONCLUSIVE; tool ffmpeg version 8.1.1 Copyright (c) 2000-2026 the FFmpeg developers

ffmpeg options: -/filter_complex=true, -filter_complex_script=true.
The BEFORE option_probe values reflect a later direct remeasurement with the same installed binary.

Version cases:
- ffmpeg version n8.1.2-34-g9b6c8969e0 Copyright (c) ... → ffmpeg version n8.1.2-34-g9b6c8969e0 Copyright (c) ...; -/filter_complex
- ffmpeg version 9.0-full_build-www.gyan.dev Copyright ... → ffmpeg version 9.0-full_build-www.gyan.dev Copyright ...; -/filter_complex
- ffmpeg version 2026-09-01-git-abcdef1234-full_build-www.gyan.dev Copyright ... → ffmpeg version 2026-09-01-git-abcdef1234-full_build-www.gyan.dev Copyright ...; -/filter_complex
- ffmpeg version N-12345-gabcdef Copyright ... → ffmpeg version N-12345-gabcdef Copyright ...; -/filter_complex
- ffmpeg version 7.1.1-tessus Copyright ... → ffmpeg version 7.1.1-tessus Copyright ...; -/filter_complex
- ffmpeg version 7.1 Copyright ... → ffmpeg version 7.1 Copyright ...; -/filter_complex
- ffmpeg version 6.1.1 Copyright ... → ffmpeg version 6.1.1 Copyright ...; -filter_complex_script
- (null) → (null); inline graph

Audio phase: exit 0, 4s output, 1 audio stream(s).
