# 保存後の検証（宣言が効いていることの確かめ方）

「宣言済み」と報告する前に、**保存されたファイルを読んで**次を確認する。

## 1. 保存内容を読む

```sh
node -e "const d=require(require('os').homedir()+'/.akari/assets/audio/declarations.json');
for (const [id, v] of Object.entries(d)) {
  const drop = (v.sections ?? []).find((s) => s.label === 'drop');
  console.log(id, '| bpm', v.bpm, '| 区間', (v.sections ?? []).length, '| ピン', (v.hit_points ?? []).length,
    '| サビ頭', drop ? drop.start_sec + 's' : '（未指定）', '|', v.source);
}"
```

確認する点:

- 目的のトラック id が入っているか（**ライブラリのディレクトリ名ではなくトラック id**）
- `drop` があるか（無ければサビ頭出しが使えない。ユーザーに知らせて付けるか確認する）
- `source` が `declare-audio` か（`replaced_source` があれば、パック由来を上書きした記録）

## 2. 提案に効いているか確かめる

宣言したトラックを含むトーンで自動提案を実行し、**実測 BPM とサビ頭出しが出る**ことを見る。

```sh
node packages/audio-library-setup/bin/suggest-bgm.mjs --tone 勢い --count 3
```

宣言済みトラックはこう出る（`実測BPM` 表記・`耳検証済み +1` の加点・サビ頭の行）:

```
1. bgm-beatslide-124-001 — Boots On Concrete
   系統: beatslide / 実測BPM: 123（標準） / 一致: 勢い◎ / スコア: 3（耳検証済み +1）
   宣言: サビ頭 9.29s（audio.bgm.in に指定でサビから敷ける） / キメ 1 点
   構成: intro 0-1.46 / build 1.46-9.26 / drop 9.29-17.1 / outro 17.07-24.87
```

出ない場合の切り分け:

- 宣言の id と、提案に出るトラック id が食い違っている（`declarations.json` のキーを確認）
- `declarations.json` が `suggest-bgm` の見る場所に無い（既定は `<ライブラリ>/declarations.json`。
  別の場所なら `--declarations <path>` か環境変数 `AKARI_SOUNDS_DECLARATIONS` で指す）

## 3. 使い方をユーザーへ返す

- 編集時は [edit-plan](../edit-plan/SKILL.md) の素材計画で `suggest-bgm` が起点になり、
  宣言済みトラックが優先候補として出る
- サビから敷きたいときは、提案に出た**サビ頭の秒を `edit.json` の `audio.bgm.in` に書く**
  （BGM ファイル内の開始オフセット。ループ・フェードの意味論は変わらない）

## レポートの書き方（ハードルール 2 の適用）

```text
宣言を保存しました: 3 曲（~/.akari/assets/audio/declarations.json）
- bgm-lofi-085-001: ♩86.1（耳で確認済み）/ サビ 11.2s〜 / キメ 2 点
- my-song: ♩120（自動推定のまま・未確認）/ サビ 未指定
suggest-bgm で確認したところ、bgm-lofi-085-001 はサビ頭 11.2s 付きで提案に出ています。
```

**耳で確認したもの / 推定のままのものを分けて書く**。全部を「検証済み」とまとめない。

## よくある間違い

- 画面の「保存しました」だけを見て完了報告する（ファイルを読み返す）
- サビ（drop）が無いのに「サビ頭出しが使える」と報告する
- 自動推定のままの BPM を「実測」と書く
