# BEFORE audio QC measurement

## in_range

- render exit: 0; verdict: INCONCLUSIVE
- configured: {"integrated_lufs":-14,"true_peak_dbtp":-1.5}
- decoded: {"metric":"ffmpeg-loudnorm-input-v1","normalized":{"input_i":-14.01,"input_tp":-12.68},"raw":{"input_i":"-14.01","input_tp":"-12.68"}}
- QC warnings: []
- render warnings: ["render-cut warning: audio_qc is INCONCLUSIVE and requires human acceptance review"]
- status warnings: ["audio_qc is INCONCLUSIVE; configured target, filter report, and decoded measurement require human review"]
- accept exit: 0; WARNING lines: ["WARNING: audio_qc is INCONCLUSIVE; this is not an audio conformance PASS."]
- accept output:

```text
Artifact: exports/final.mp4
Artifact SHA-256: 1696aee3c758d166a12d3b51f5d1c6c8ba597f9ccafdc84bc1b9cc7b3d841d1a
Receipt: .akari/reports/render-receipts/105847938d6dbbc0920ac734427ef90176126ba7f0e7cabba80475a44797f217.json
Receipt SHA-256: 105847938d6dbbc0920ac734427ef90176126ba7f0e7cabba80475a44797f217
WARNING: audio_qc is INCONCLUSIVE; this is not an audio conformance PASS.
Configured: {"integrated_lufs":-14,"true_peak_dbtp":-1.5}
Filter report: {"normalized":{"output_i":-13.99,"output_tp":-12.52},"raw":{"output_i":"-13.99","output_tp":"-12.52"}}
Decoded artifact measurement: {"metric":"ffmpeg-loudnorm-input-v1","normalized":{"input_i":-14.01,"input_tp":-12.68},"raw":{"input_i":"-14.01","input_tp":"-12.68"}}
[1G[0JHuman identity for this cooperative local record: [51Gfixture-reviewer
[1G[0JYour final acceptance statement for this artifact: [52GFixture acceptance observation.
[1G[0JType exactly “ACCEPT 1696aee3c758d166a12d3b51f5d1c6c8ba597f9ccafdc84bc1b9cc7b3d841d1a” to confirm this artifact checksum: [23GACCEPT 1696aee3c758d166a12d3b51f5d1c6c8ba597f9ccafdc84bc1b9cc7b3d841d1a
Recorded cooperative local acceptance event 1616d557-a8e6-4d49-924d-d3886f5e7cb6 at .akari/events/20260923T175058959Z-1616d557-a8e6-4d49-924d-d3886f5e7cb6-final-acceptance.json. This record is not a cryptographic human-identity proof.

```

## true_peak_exceeded

- render exit: 0; verdict: INCONCLUSIVE
- configured: {"integrated_lufs":-5,"true_peak_dbtp":-1.5}
- decoded: {"metric":"ffmpeg-loudnorm-input-v1","normalized":{"input_i":-12.99,"input_tp":-1.37},"raw":{"input_i":"-12.99","input_tp":"-1.37"}}
- QC warnings: ["TRUE_PEAK_EXCEEDED: decoded_measurement.normalized.input_tp (-1.37) exceeds configured.true_peak_dbtp (-1.5) by 0.13 dB"]
- render warnings: ["render-cut warning: audio_qc is INCONCLUSIVE and requires human acceptance review"]
- status warnings: ["audio_qc is INCONCLUSIVE; configured target, filter report, and decoded measurement require human review"]
- accept exit: 0; WARNING lines: ["WARNING: audio_qc is INCONCLUSIVE; this is not an audio conformance PASS."]
- accept output:

```text
Artifact: exports/final.mp4
Artifact SHA-256: 768a1283a41756b15eafee08c703e3f3b5a8056b0d6b1e1222545e080a116df7
Receipt: .akari/reports/render-receipts/1da9948267279cf82eb604ef5e0cdc0b459334a45524768f8aa043719277efc9.json
Receipt SHA-256: 1da9948267279cf82eb604ef5e0cdc0b459334a45524768f8aa043719277efc9
WARNING: audio_qc is INCONCLUSIVE; this is not an audio conformance PASS.
Configured: {"integrated_lufs":-5,"true_peak_dbtp":-1.5}
Filter report: {"normalized":{"output_i":-12.95,"output_tp":-1.5},"raw":{"output_i":"-12.95","output_tp":"-1.50"}}
Decoded artifact measurement: {"metric":"ffmpeg-loudnorm-input-v1","normalized":{"input_i":-12.99,"input_tp":-1.37},"raw":{"input_i":"-12.99","input_tp":"-1.37"}}
[1G[0JHuman identity for this cooperative local record: [51Gfixture-reviewer
[1G[0JYour final acceptance statement for this artifact: [52GFixture acceptance observation.
[1G[0JType exactly “ACCEPT 768a1283a41756b15eafee08c703e3f3b5a8056b0d6b1e1222545e080a116df7” to confirm this artifact checksum: [23GACCEPT 768a1283a41756b15eafee08c703e3f3b5a8056b0d6b1e1222545e080a116df7
Recorded cooperative local acceptance event cc2f74ad-40e7-43cf-90e9-af13065bc7d0 at .akari/events/20260923T175141790Z-cc2f74ad-40e7-43cf-90e9-af13065bc7d0-final-acceptance.json. This record is not a cryptographic human-identity proof.

```

