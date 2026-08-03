# first-party 一括取得（AKARI Sounds・既定フロー）

## 0. これは何か・なぜ第三者ルールと違うのか

[AKARI Sounds](https://github.com/AkariLabs/akari-sounds) は AKARI Video と同じ運営による
**自社（first-party）音源ライブラリ**（全トラック AI 生成・生成記録公開・商用可・クレジット不要）。
`catalog/audio/candidates.json` の `first_party` に既定ソースとして宣言されている。

SKILL.md の「エージェントによる取得はユーザーの指示で行う」「一括・並列取得はしない」は
**第三者配布元のサーバとライセンスを守るための規律**であり、自社が配布主体の GitHub Release には
適用しない（2026-08-03 オーナー裁定: 初回セットアップで無料音源を一括ダウンロードできるようにする）。
ただし取得先は `AkariLabs/akari-sounds` の Release アセットと `catalog.json` だけに限る。
**他ホストへのアクセスをこのフローに混ぜない。**

## 1. いつ実行するか

- **初回セットアップ時（既定）**。BGM とジングルの既定ソースは AKARI Sounds なので、
  音源セットアップはまずこれを実行する。効果音もまず AKARI Sounds を見て、
  無い系統（拍手・歓声 / 失敗音 / 和風・バトル打撃）だけ候補リスト（第三者）で補完する
- **`akari` 起動時に自動で 1 回だけ聞かれる**（launcher の初回動線・既定 Yes。
  2026-08-03 オーナー裁定「質問は 1 回・項目ごとの選択はさせない」）。n を選んだ場合や
  失敗した場合の再入口は `akari sounds`
- AKARI Sounds の新しい Release タグが出たとき（`--tag` を差し替えて再実行）

## 2. 実行する

```sh
# ユーザー向けの入口（launcher 経由・引数はそのまま下記スクリプトへ渡る）
akari sounds
akari sounds --variant wav --force

# スクリプト直叩き（開発・検証時）
# 取得内容の確認（ダウンロードなし）
node packages/audio-library-setup/bin/fetch-akari-sounds.mjs --dry-run

# 一括取得（mp3・既定）
node packages/audio-library-setup/bin/fetch-akari-sounds.mjs

# WAV が欲しい場合（3 分割 zip・約 3GB 級。通常は mp3 で足りる）
node packages/audio-library-setup/bin/fetch-akari-sounds.mjs --variant wav
```

## 3. 何が起きるか

- `catalog.json` を取得 → kind ごとの 3 パック（`akari-sounds-bgm` / `akari-sounds-sfx` /
  `akari-sounds-jingle`）に分けて Release zip をダウンロード・展開し、
  `~/.akari/assets/audio/<パックid>/` （user スコープ、drop-folder 登録と同じ置き場）へ配置する
- 各パックに `meta.json`（schema v0・実体エントリ）+ `preview.png`（実波形。ffmpeg 必須）+
  `.origin-catalog.json`（取得時点の catalog.json スナップショット = プロンプト原文・生成日時・
  生成元 URL・sha256 の来歴）を書く
- 最後に欠品チェックと `validate-asset.mjs` を全パックに実行し、欠品/検証失敗があれば
  exit 1 で正直に報告する（「登録完了」の捏造をしない）
- 再実行は冪等: 全ファイル取得済みなら meta.json の更新だけ行う。再取得は `--force`

## 4. 利用条件（ユーザーに聞かれたら）

AKARI-Sounds-Terms-v0（Release 同梱 TERMS.md が正本）: 商用可・クレジット不要・編集加工可。
禁止は 3 点 — 単体再配布/販売・音楽配信サービス（Spotify 等）登録・Content ID 登録。
AS-IS 無保証。AI 学習利用は明示許可が無いため安全側で `ai_training_allowed: false`。

## よくある間違い

- 第三者配布元（効果音ラボ等）をこの一括フローに混ぜる（第三者は従来どおり
  candidate-list → drop-folder / assisted-fetch）
- Release zip を catalog/ や本リポ配下へ展開する（実体は常に user スコープ
  `~/.akari/assets/audio/` へ。音声実体を本リポにコミットしない規律は first-party でも同じ）
- `catalog.json` に無いファイル名を当て推量で組み立てて取得する
