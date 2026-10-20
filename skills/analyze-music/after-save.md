

# Verify the saved declaration

The library normally lives in the workspace's `library/`. Without a workspace, use `~/.akari/assets/`. Confirm its actual path from the first line of `akari-assets list` or `akari assets list`. Below, `<ライブラリの置き場>` denotes that path; audio is under its `audio/` directory.

**Read the saved file** before calling a track declared.

## 1. Inspect saved values
```sh
# LIBRARY_ROOT に list の先頭行で確認した置き場を設定してから実行する
node -e "const d=require(process.env.LIBRARY_ROOT+'/audio/declarations.json');
for (const [id, v] of Object.entries(d)) {
  const drop = (v.sections ?? []).find((s) => s.label === 'drop');
  console.log(id, '| bpm', v.bpm, '| 区間', (v.sections ?? []).length, '| ピン', (v.hit_points ?? []).length,
    '| サビ頭', drop ? drop.start_sec + 's' : '（未指定）', '|', v.source);
}"
```
Check:

- Is the intended track ID present? Use the **track ID, not the library directory name**.
- Is there a `drop` section? Without one, no chorus cue is available; tell the person and ask whether they want to add one.
- Is `source` set to `analyze-music`? A `replaced_source` value records that a declaration from a pack was overwritten.

## 2. Confirm it affects BGM suggestions

Run a BGM suggestion for a tone that includes the track. Check that the measured BPM and chorus cue appear.
```sh
node packages/audio-library-setup/bin/suggest-bgm.mjs --tone 勢い --count 3
```
A declared track should show `実測BPM`, the `耳検証済み +1` scoring note, and a chorus-cue line, as in this CLI output:
```
1. bgm-beatslide-124-001 — Boots On Concrete
   系統: beatslide / 実測BPM: 123（標準） / 一致: 勢い◎ / スコア: 3（耳検証済み +1）
   宣言: サビ頭 9.29s（audio.bgm.in に指定でサビから敷ける） / キメ 1 点
   構成: intro 0-1.46 / build 1.46-9.26 / drop 9.29-17.1 / outro 17.07-24.87
```
If the track does not appear, check:

- Whether the key in `declarations.json` matches the ID used by the suggested track.
- Whether `suggest-bgm` can find `declarations.json` at its default `<ライブラリ>/declarations.json` path. For another location, pass `--declarations <path>` or set `AKARI_SOUNDS_DECLARATIONS`.

## 3. Explain how to use it

- During editing, `suggest-bgm` supplies the starting candidates for the media plan in [plan-edit](../plan-edit/SKILL.md). Declared tracks receive priority.
- To start BGM at the chorus, write the suggested chorus-start second to `audio.bgm.in` in `edit.json`. This is an offset within the BGM file; looping and fades retain their usual meaning.

## Report the verification (hard rule 2)
```text
宣言を保存しました: 3 曲（<ライブラリの置き場>/audio/declarations.json）
- bgm-lofi-085-001: ♩86.1（耳で確認済み）/ サビ 11.2s〜 / キメ 2 点
- my-song: ♩120（自動推定のまま・未確認）/ サビ 未指定
suggest-bgm で確認したところ、bgm-lofi-085-001 はサビ頭 11.2s 付きで提案に出ています。
```
**Distinguish ear-verified values from untouched estimates.** Do not label them all "verified."

## Common mistakes

- Reporting success from the UI message `保存しました` ("saved") without reading the file.
- Claiming a chorus cue is available when there is no drop section.
- Calling an automatically estimated BPM a measured value.
