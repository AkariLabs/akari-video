

# Open the declaration timeline

The library normally lives in the workspace's `library/`. Without a workspace, use `~/.akari/assets/`. Confirm the actual path from the first line of `akari-assets list` or `akari assets list`. Below, `<ライブラリの置き場>` denotes that displayed path; audio files are under its `audio/` directory.

## 1. Start the helper
```sh
node packages/audio-library-setup/bin/declare-helper.mjs
```
The default audio library is `<ライブラリの置き場>/audio`. Override it only when inspecting a different library.
```sh
node packages/audio-library-setup/bin/declare-helper.mjs \
  --port 0
```
At startup, the helper prints three lines. **Give the person the exact `HELPER:` URL and ask them to open it in their browser.** The person, not the agent, marks the timeline.
```
HELPER: http://localhost:<port>/
library-root: <ライブラリの置き場>/audio
保存先: <ライブラリの置き場>/audio/declarations.json
```


## 2. Understand the track list

The helper scans `library-root` and lists individual tracks:

- In a directory containing one audio file, the ID is the directory name (`my-song/my-song.mp3` → `my-song`).
- In a directory containing several files, such as `akari-sounds-bgm/`, each file stem becomes an ID (`bgm-lofi-085-001.mp3` → `bgm-lofi-085-001`). This matches the track IDs used by `catalog.json` and `suggest-bgm`.
- Audio remains eligible even without `meta.json`, so a personally added track can be declared.
- Ignore directories beginning with `_` or `.`, such as `_quarantine`.
- If no tracks are found, the screen explains how to install the official library with `akari sounds` or add a track at `<ライブラリ>/<曲名>/<曲名>.mp3`.

Badges mean: `宣言済み` ("declared") indicates at least one section or pin; `パック由来` ("from a pack") indicates a declaration from outside this tool, such as a purchased pack. Replacing it creates a new user declaration and records the prior source in `replaced_source`.

## 3. Explain the essential controls (this is all you need to say)

1. Selecting a track estimates **BPM and the first downbeat**. Treat the estimate as uncertain; it may be off by 1–2 BPM.
2. Turn on `🥁 クリック音で確認` ("confirm with click sound") and play the track. If clicks do not align with the kick, adjust BPM or the downbeat with `-10ms`, `+10ms`, `今の位置を頭拍に` ("set current position as downbeat"), or `タップでテンポ` ("tap tempo") at least four times.
3. Drag across the waveform to mark a section and choose its type with the colored buttons. **Always mark one chorus (drop).** The UI calls that section `サビ・見せ場` ("chorus/highlight").
4. Double-click the waveform to add an accent pin; double-click that position again to remove it.
5. Zoom with pinch, wheel, or the `ー ＋ 全体` controls. Pan with a two-finger horizontal gesture or the minimap above.
6. Press `保存` ("Save").


## 4. Example user guidance
```text
宣言づけの画面を開きました: http://localhost:<port>/
曲を選ぶと BPM と頭拍を自動で推定します（推定なので、まず「🥁 クリック音で確認」を ON にして
再生し、曲のキックと合っているか確かめてください。ズレていたら BPM か頭拍を直します）。
そのあと、サビの範囲を波形の上で横にドラッグしてください（種類は「サビ・見せ場」）。
キメの瞬間があればダブルクリックでピンを打てます。最後に「保存」を押してください。
打ち終わったら教えてください。保存内容を確認して、提案に効いているか一緒に見ます。
```


## Common mistakes

- Marking declarations on the person's behalf. The person decides by listening; the agent guides and verifies.
- Calling an automatic BPM estimate confirmed before the person checks it against the click; always guide them to verify it with the click sound.
- Binding the server to `0.0.0.0` or forcing a port that may conflict with another process. Keep the default `0` so an available port is assigned.
- Reporting a declaration before it is saved and checked using [after-save.md](after-save.md).
