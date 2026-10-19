[English](./export.md) | **日本語**

# 書き出す

承認済みの `edit.json` から最終 MP4 をレンダリングします。スキルは `render-cut`。

## 前提

- `edit.json` が確定していること
- [edit-lint](./review-and-fix.ja.md) が PASS していること（`.akari/lint.json` の
  `verdict: pass` を render-cut が確認します）

## 頼み方

「書き出して」「納品用に MP4 にして」

アプリでは、上の帯の書き出しボタン（「書き出し」）からも始められます。押すと書き出しの
画面が開き、書き出し中は進み具合が出ます。書き出せないときは理由が出ます。

## 流れ — 承認してから走る

1. **validate** — 入力の妥当性確認
2. **plan** — 何をどうレンダリングするかの計画を提示（予測尺・処理内容・使うエンジン）
3. **承認** — 人間が OK を出す（ここが 2 つ目のチェックポイント）
4. **render** — ローカルで ffmpeg レンダリング。映像は原本からカット・エンコード、
   表現（テロップ・字幕・動く部品・3D）はプレビューと同一の HTML から合成
5. **verify** — ffprobe で容器を検査し、宣言と出力の実測（音量・カメラワーク・空白フレーム）を照合

## 書き出しエンジン — `--engine`

| 指定 | 動き |
|---|---|
| `auto`（既定） | GPU で描ける内容なら GPU、それ以外は OSR。macOS・Windows・Linux で同じ規則 |
| `gpu` | GPU 直結（速い）。描けない内容があれば、理由を出して止まる |
| `osr` | ページ全体をオフスクリーンで描く。自由な HTML も描ける |

**GPU で描ける内容**は、書き出しの前に宣言（HTML・字幕・編集の宣言）から機械的に判定します。

- 静的な HTML、CSS アニメーション / transition / `@keyframes` / Web Animations / `@property` だけで動く HTML
- 宣言型の 3D（回転などのキーフレームで動く 3D も含む）と、WebGPU のレイヤー
- 字幕の動き（カラオケ・ポップ・リビール・語ごとのリビール）と語ごとの強調

外部の URL を読む HTML、スクリプトで動く HTML、同じ字幕にカラオケの色補間と幾何変形を重ねたものなどは
GPU では描けません。`auto` なら OSR に切り替わり、`gpu` を明示した場合は理由つきで止まります。
どちらで描いたかは `.akari/render.json` の `engine_requested`（指定）と `engine`（実際）に残り、
切り替えた場合は `engine_fallback` に理由が残ります。

書き出す前に edit-lint を `--engine auto`（または `gpu` / `osr`）で走らせると、選んだエンジンが
読まない項目を先に見つけられます。契約は
[GPU 直結書き出し](../contract-2026-08-28-gpu-export-v0.md)・
[OSR 書き出し](../contract-2026-08-28-osr-export-v0.md)（いずれも日本語）。

## 書き出した後の検証

容器の検査（尺・フレーム数・全フレームのデコード・解像度・fps・codec）に加えて、
宣言した内容が出力に現れたかを最終 MP4 から実測します。

| 検査 | 内容 |
|---|---|
| `verify.audio-level` | 宣言した音声が全サンプル区間で無音、または測定不能なら FAIL |
| `verify.motion-static` | 宣言したカメラワークが出力でほとんど動いていなければ警告 |
| `verify.blank-frames` | 0.3 秒以上の空白フレームを探す。その区間に宣言した部品があれば警告（判定は変えない） |

OK になったら、場面の代表コマを並べたコンタクトシート（`.akari/reports/contact-sheet.png`）が作られ、
エージェントが目で確かめます。先頭にタイトルカードがあっても、映像・音声・字幕の時刻は揃ったまま出ます。
仮枠（まだ素材が入っていない枠）が残っていると、書き出しにも「素材を入れると置き換わります」のカードが入ります。
契約は [宣言 vs 実測](../contract-2026-09-02-export-verify-declared-vs-measured-v0.md)（日本語）。

## 生成されるもの

| ファイル | 内容 |
|---|---|
| `exports/<name>.mp4` | 最終出力 |
| `.akari/render.json` | 書き出し計画・実行結果の正本（コマンド列・使ったエンジン・provenance） |
| `.akari/reports/render-report.html` | 人間向けレポート（検証結果込み） |
| `.akari/reports/contact-sheet.png` | 代表コマのコンタクトシート |

アプリの左のパネルの **出力** の帯には、書き出したものが新しい順に 3 件まで並び、
「開く」「Finder で表示」がその場でできます。帯の上端をドラッグして高さを変えられます。

## 他の編集ソフトへ — NLE 書き出し（BETA）

> **BETA** — 実装とテストは済んでいますが、実際の Final Cut Pro / DaVinci Resolve / Premiere Pro への
> 取り込みはまだ確かめていません。取り込めない・ずれるときは issue で教えてください。

スキル `export-nle` が `edit.json`（v2）を、プロの道具で仕上げたい人の出口として片道で書き出します。
「Premiere で開きたい」「Resolve 用に出して」「SRT がほしい」で頼めます。

| 形式 | 行き先 | ファイル |
|---|---|---|
| FCPXML 1.11 | Final Cut Pro / DaVinci Resolve | `<project>.fcpxml` |
| FCP7 XML（xmeml v5） | Premiere Pro | `<project>.premiere.xml` |
| SRT | どの NLE でも（字幕があるときだけ） | `<project>.srt` |

- 出力先は `exports/nle/`。素材は参照（絶対パス）で書かれるので、プロジェクトを動かしたら NLE の再リンクで繋ぎ直す
- 移らないもの（ダッキング・マスターの音量処理・LUT・クロマキー・字幕の見た目など）は
  `exports/nle/export-report.json` の `dropped[]` に全部出ます。黙って落とすことはありません
- NLE から `edit.json` へ戻す方向はありません

## プレビューと出力が一致する理由

プレビューはプロキシ + ライブ DOM（即時・触れる）、書き出しは原本 + フレーム毎
の合成（フレーム正確）。**同じ HTML・同じセーブデータ**を両方に通すので、
見ていたものがそのまま出てきます。

## うまくいかないとき

- **lint FAIL で始まらない** → [QA・レビューして直す](./review-and-fix.ja.md)。
  FAIL 理由はレポートに件数付きで出ます
- **verify FAIL** → レポートの stderr 要約を確認。「render の失敗を調べて」で診断まで頼めます
- **`verify.audio-level` FAIL** → 宣言した音声が全サンプル区間で無音、または音量を測定不能。
  宣言した BGM / SFX / narration / 素材音声とレポートを確認します
- **`--engine gpu` で止まる** → 理由に描けない HTML や字幕の動きが出ます。直すか `--engine auto` にします
- **`OSR Electron` / `GPU Electron` と `SIGABRT`** → ログイン中の画面（GUI セッション）に接続できない環境から起動した可能性があります。ログイン中のターミナルか AKARI Video のアプリ内から書き出してください。
- **`node` が PATH に無い** → `akari doctor` に表示される実パスを使い、ログイン中のターミナルで `ELECTRON_RUN_AS_NODE=1 "<Electron 実行体>" "<render-cut.mjs のパス>" <project-root>` と実行します。この設定は親を Node として起動するためのもので、GUI セッション無しの問題は解消しません。

## 次のステップ

- よくできた成果物を次回のために保存 → [素材ライブラリを育てる](./asset-library.ja.md)

<!-- BEGIN GENERATED facts:stamp -->
この文書は AKARI Video v1.5.1（2026-10-19 公開）時点の説明です。
<!-- END GENERATED facts:stamp -->
