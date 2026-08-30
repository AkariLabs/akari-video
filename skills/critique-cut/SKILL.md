---
name: critique-cut
description: 人間が先に組んだ edit.json を読み、使われている素材の使用区間だけを観察して所見を返す読み取り専用スキル。edit.json は変更しない。「今こんな感じどう？」「このカット見て」「今のタイムラインを講評して」で発動する。
---

# 組まれたタイムラインへ所見を返す

> **Language**: Respond in the user's language — 対話・質問・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

人間が方向性を決めて先に組んだタイムラインを観察し、直さずに所見だけを返す。詳細な導出、
既読判定、時刻選択、レポート雛形は [workflow.md](workflow.md) を読む。

## ハードルール

1. **`edit.json` / `captions.json` / `review.json` を書き換えない**。この 3 ファイルは常に
   読み取り専用とし、自動修正もチケットの自動作成もしない。書いてよい所見は
   `.akari/reports/critique/<stamp>/critique.md` だけである。`akari media` が観察結果を素材の
   `analysis.json` へ追記するのは、観察 CLI の帳面契約どおりの副作用として許可する。
   `akari migrate` は edit.json を書き換えるため、本スキルから実行しない。
2. **事実と読みを分ける**。CLI、帳面、実際に読んだ完成絵から確認できた内容を「事実」、
   そこから導く評価や提案を「読み」と明示する。
3. **見ていないものについて述べない**。画像は原則として完成絵のコンタクトシート 1 枚だけを
   読む。v0 / v1 で capture できない場合を含め、未取得・未視認の章は推測で埋めず
   「未観察」と書く。
4. **質問は最大 1 問**。所見を返すために不可欠な曖昧さだけを 1 問にまとめる。質問なしで
   読める場合は質問しない。
5. **帳面を先に読み、二度見ない**。既存 `analysis.json` の `probe` / `tracks.waveform` /
   `transcript[]` / `observations[]` が今回の使用区間を覆うなら再実行しない。未観察の範囲だけを
   CLI で補う。
6. 観察対象を、タイムラインで使われている `(src, source 秒)` に限定する。未使用区間を
   `transcribe` しない。source 秒と timeline 秒を混同せず、所見の場所は両方で指す。

## 実行順

`edit.json` / `captions.json` は全文 Read せず、id で grep して該当行だけ読む（[edit.json の読み方](../../docs/guides/edit-json-access.md)）。
本スキルは書き込まない。別工程で書く場合は、該当行の Edit か edit-store のスクリプト API を使う。

1. `grep -n '"version"' edit.json` で版の行を読み、v0 / v1 / v2 を判別し、対象 id を grep して
   該当行だけ読む。v0 / v1 は `source` / `sources[]`、
   `cuts[].src/in/out/at/track`、`overlays` / `layers` / `audio`、v2 は `sources[]`、
   `tracks[].lane/items[]/content`、`items[].at/duration/source`、`audio` / `captions` /
   `thumbnail` を把握する。次の補助 CLI で、重複・隣接を統合した使用区間と timeline 射影、
   素材以外の item 件数を得る。未対応の version は推測で読まず停止する。

   ```sh
   node skills/critique-cut/bin/used-ranges.mjs <project-root>/edit.json
   ```

2. [workflow.md](workflow.md#帳面の既読判定) の既読判定を素材ごとに行う。足りない観察だけを、
   プロジェクト root から次の順で実行する。`probe` と `waveform` は区間引数を持たないため
   素材ごとに最大 1 回、`transcribe` は `speech_likely: true` の素材について統合済み使用区間
   ごとに `--in/--out` を付ける。これが区間限定の L0 + L1 である。

   ```sh
   akari media probe <src-id-or-path>
   akari media waveform <src-id-or-path>
   akari media transcribe <src-id-or-path> --in <source-in> --out <source-out>
   ```

3. **edit.json が v2 のときだけ** `akari capture --auto` と、冒頭 3 秒内の時刻、依頼で指定された
   時刻を和集合で渡し、完成絵のコンタクトシートを撮る。出力されたシートから
   [workflow.md](workflow.md#capture-の時刻選び) の優先順で **1 枚だけ**を実際に読む。
   edit.json が v0 / v1 の場合、現行 `akari capture` は受け付けないため実行しない。人間に
   `akari migrate <project-root>` を勧めるが、**本スキル自身は migrate を実行しない**
   （edit.json を書き換えるため）。人間による移行後も撮れない、または移行されない場合は、
   ②「見えている絵」を「未観察」とし、絵の話をしない。
4. 下の固定形式で所見を組み立てる。指摘箇所は `timeline 4.2s / (s2, source 18.0s)` のように、
   timeline 秒と `(src, source 秒)` の両方で指す。
5. `.akari/reports/critique/<stamp>/critique.md` に所見と証跡（読んだシートのパス、観察した
   `(src, source range)`、各素材の帳面パスと再利用・追記の別、読んだ画像枚数）を書く。
   チャットには同じ ①〜⑥ の要約を返す。
6. 人間の返事に応じて必要な範囲だけ深掘りする。絵の追加観察は
   `akari media grab <target> -t <source-time...>` による L2、人物演出なら L3 の追加を提案する。
   **直しは本スキルで実行しない**。構成や方針に及ぶ大きい直しは
   [edit-plan](../edit-plan/SKILL.md) へ渡し、人間の方針が既にあるので Checkpoint 1 は追認で
   通せると伝える。点の直しは人間が `review.json` の注釈で場所を指した後、
   [address-review](../address-review/SKILL.md) へ渡す。注釈が無ければ「注釈で場所を指してください」
   と案内し、本スキルからチケットを作らない。

## 所見の型

章は ①〜⑥ の順を固定する。省略できる章も見出しを残し、根拠が無ければ「未観察」と書く。

1. **① 事実** — 尺、カット数、使用素材、喋りの有無、使用区間内の無音位置。
2. **② 見えている絵** — 実際に読んだ 1 枚のシートから確認できる重なり、字幕位置、見切れ、
   黒味。シート外は未観察とし、capture できなければ章全体を「未観察」とする。
3. **③ テンポと間** — カット長の分布、speed / freeze による実尺、使用区間内の無音から読む。
4. **④ 字幕の要否と方針** — 発話の事実と完成絵を根拠にした読み。`speech_likely` だけを字幕の
   根拠にしない。
5. **⑤ フックの位置** — 冒頭 3 秒に何があるかを、timeline 0〜3 秒の事実と完成絵から述べる。
6. **⑥ 次の一手 3 つまで** — 各案に `edit-plan 行き` / `address-review 行き` / `追加観察` の
   いずれかを明記する。
