# @akari-video/audio-library-setup

音源（BGM/SFX）初回セットアップの半自動ドロップフォルダ方式を実装する v0 ツール群。
外部 npm 依存ゼロ（Node.js 組み込みモジュールのみ、`packages/decision-cards` /
`packages/intake-form` と同じ流儀）。詳細な運用手順は
[`skills/setup-audio-library/`](../../skills/setup-audio-library/SKILL.md) を参照。

## 構成

| ファイル | 役割 |
|---|---|
| `shared/candidates.mjs` | `catalog/audio/candidates.json` の読み込み・ファイル名マッチング・既所有（ownership）判定・meta.json 組み立てを行う共有ロジック（`lib/` ではなく `shared/` にしているのはリポ直下 `.gitignore` の `lib/` パターンと衝突するため） |
| `shared/akari-sounds.mjs` | 自社（first-party）ライブラリ AKARI Sounds の URL 構築・catalog.json → パック登録プラン・meta.json 組み立て（純粋ロジックのみ） |
| `shared/waveform-preview.mjs` | 音声実体から preview.png（波形画像）を ffmpeg で生成する共有ロジック |
| `bin/fetch-akari-sounds.mjs` | AKARI Sounds を GitHub Release から**一括取得**し user スコープへ登録する CLI（first-party のみ許可。取得先は AkariLabs/akari-sounds に限定） |
| `shared/bgm-suggest.mjs` | BGM 自動提案の純粋ロジック — tone 語彙（表現選定と同じ 8 語）× 系統対応表 `FAMILY_TONE_RULES` × 体感 BPM で決定論ランキング |
| `bin/suggest-bgm.mjs` | BGM 自動提案 CLI。導入済みスナップショット（`.origin-catalog.json`）を読み、`--tone`（複数可）`--tempo` から候補 + ローカル実体パスを提示（`--json` あり）。`--declarations`（または env `AKARI_SOUNDS_DECLARATIONS`）で耳検証済み宣言を合流 — 実測 BPM 置換・耳検証ボーナス・**サビ頭出し（`audio.bgm.in` の推奨値）**・構成表示が付く。ネットワーク不使用 |
| `shared/beat-grid.mjs` | 宣言（bpm / 頭拍 / キメ / 構成）を timeline へ写す純粋ロジック。`musicGrid()` の秒グリッドは検査用の内部計算として維持し、`toFrameGrid()` / `snapToGrid()` / `cutCandidates()` が出力 fps 上の整数フレームを返す。`audio.bgm.in` とループ（**1 周目は in から・2 周目以降はファイル先頭から**。2026-08-04 に ffmpeg 実測で確定）を反映する |
| `shared/insert-level.mjs` | 挿入素材の計測値から役割別の `gain_db` と既定 fade を決める純関数。1 秒未満または LUFS 不明は sample peak、それ以外は integrated LUFS を基準にし、true peak ceiling と `[-60, 12]` dB の安全域を適用する |
| `bin/beat-grid.mjs` | 音楽グリッド CLI（`--edit` / `--track` + `--timeline`・`--fps`・`--snap`・`--json`）。`--edit` では `output.fps` を使い、拍・小節頭・キメ・スナップ・カット候補を整数フレームで返す。edit-plan の [beat-sync](../../skills/edit-plan/beat-sync.md) が発火位置を拍へ寄せるのに使う |
| `shared/sfx-suggest.mjs` | SFX / ジングル自動提案の純粋ロジック — 「場面の意味」14 語 × 宣言表 `MEANING_RULES`（候補順 = 優先順・外部補完の参照つき） |
| `bin/suggest-sfx.mjs` | SFX / ジングル自動提案 CLI（`--meaning` / `--list` / `--json`）。suggest-bgm の姉妹 |
| `bin/review-sfx-mapping.mjs` | 「意味 → 音」対応表の**耳レビュー面**を生成（全意味 × 候補の試聴プレイヤー + 判定 JSON 書き出し。既定出力 `~/.akari/reviews/sfx-mapping.html`） |
| `bin/generate-candidates-html.mjs` | 候補リストの静的自己完結 HTML を生成する CLI。ダウンロードは一切行わない |
| `bin/register-drop-folder.mjs` | ドロップフォルダを走査し、候補と照合して `~/.akari/assets/audio/<id>/`（user スコープ）へ実体配置 + `catalog/audio/<id>/meta.json`（remote 参照）を書く CLI。既定は plan-only、`--apply` で実行 |
| `gallery-server.mjs` + `gallery-template.html` | 登録済み音源の試聴 + keep/drop を記録するローカル HTTP サーバ（`127.0.0.1` のみ） |
| `bin/gallery-helper.mjs` | 試聴ギャラリーの起動 CLI |
| `declare-server.mjs` + `declare-template.html` | **宣言づけ**（サビ区間・キメのピン・ビートグリッドを人が耳で付ける）のローカル HTTP サーバ + タイムライン画面。保存先は `<ライブラリ>/declarations.json`（保存前にサーバ側で妥当性検査 = fail closed）。スキル: [`skills/declare-audio/`](../../skills/declare-audio/SKILL.md) |
| `bin/declare-helper.mjs` | 宣言づけ画面の起動 CLI |
| `test/*.test.mjs` | `node --test` によるユニット/統合テスト（`mkdtemp` で隔離、本リポや実ホームディレクトリには書き込まない） |

## ハードルール（詳細は SKILL.md）

- **第三者配布元**からの自動・一括ダウンロードは実装しない。取得は常にユーザーの手動クリック
  （自社の AKARI Sounds だけは配布主体が自社のため `fetch-akari-sounds.mjs` で一括取得可 —
  2026-08-03 オーナー裁定。取得先を AkariLabs/akari-sounds 以外へ広げない）
- 候補リストのリンクは必ずダウンロードページ URL（音声ファイルへの直リンク禁止）
- 音声実体は本リポにコミットしない（常にリポジトリ外の user スコープへ配置）
- `ai_training_allowed` は明示許可がない限り `false`

## 使い方

```sh
# AKARI Sounds（BGM/効果音/ジングル）を一括取得して登録
# （ユーザー向けには `akari sounds` が同じ処理を呼ぶ。2026-08-04 以降、初回起動での
#   一括取得は行わない — 既定は asset-resolver による必要曲だけのオンデマンド取得）
node packages/audio-library-setup/bin/fetch-akari-sounds.mjs

# BGM 自動提案（tone → AKARI Sounds 候補 + ローカルパス。編集エージェントの素材計画用）
node packages/audio-library-setup/bin/suggest-bgm.mjs --tone 親しみ --tempo ゆったり

# 補完分（拍手・失敗音など）の候補リスト HTML を生成
node packages/audio-library-setup/bin/generate-candidates-html.mjs

# ドロップフォルダを確認だけする（既定・安全）
node packages/audio-library-setup/bin/register-drop-folder.mjs \
  --drop-dir ~/.akari/audio-drop

# 実際に登録する
node packages/audio-library-setup/bin/register-drop-folder.mjs \
  --drop-dir ~/.akari/audio-drop --apply

# 試聴ギャラリーを起動
node packages/audio-library-setup/bin/gallery-helper.mjs \
  --library-root ~/.akari/assets/audio

# 宣言づけ（サビ・キメ・拍を自分の耳で付ける）画面を起動
node packages/audio-library-setup/bin/declare-helper.mjs
```

## テスト

```sh
node --test packages/audio-library-setup/test/*.mjs
```

## 挿入時レベル計算

`computeInsertLevel()` は計測済みの I / true peak / sample peak / duration と役割を受け取り、
`gain_db`、`fade_in`、`fade_out`、採用基準（`lufs` / `peak` / `none`）を返す。
ファイルアクセスやネットワークアクセスは行わない。既定目標は narration -16 LUFS、SFX / jingle
-18 LUFS、music -20 LUFS、ambience / BGM -26 LUFS、true peak ceiling は -1 dBTP である。
role が narration / bgm / jingle / music / ambience なら明示値を使い、sfx・未知・未指定は
collection の bgm / narration を確認してからファイル名と尺による SFX ヒューリスティクスへ流す。
詳細は [挿入時レベル契約](../../docs/contract-2026-09-02-audio-insert-level-v1.md) を参照。

## 実装ノート

- 依存ゼロ・Node.js 組み込みモジュール（`node:http` / `node:fs` / `node:path` /
  `node:child_process` / `node:crypto`）のみ
- ドロップフォルダ登録は plan-only が既定。`--apply` を渡すまでファイルもカタログも
  一切変更しない
- 「既所有」判定は毎回 `catalog/audio/*/meta.json` を動的に読んで計算する
  （候補 id をハードコードしたリストに依存しない設計。audio-import 等、他レーンの
  登録が増えても再実行するだけで反映される）
- ギャラリーの状態書き込みは一時ファイル + `rename` によるアトミック置換
  （decision-cards / intake-form と同じ安全策）
