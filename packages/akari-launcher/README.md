# akari-launcher（`akari` コマンド）

「UI に依存したくない。opencode 単体でも、どんなディレクトリでも始められるように」を
実現する薄いラッパー CLI。npm パッケージ名は `akari-video`、提供するコマンド名は `akari`
（npm の `akari` は別プロダクトが取得済みのため。オーナー裁定 2026-07-21 §8-2）。

## やること

```
akari
  │
  ├─ 1. doctor: カレントディレクトリが AKARI Video プロジェクトかを判定する
  │     （.akari/connections.json の有無）
  │
  ├─ 2. 未セットアップなら:
  │     日本語で案内 → project-scaffold を呼んで雛形を作成
  │     （.akari/intake.json は status: "draft" で生成される）
  │
  ├─ 3. 接続状態を確認する:
  │     skills/manage-connections/bin/doctor.mjs を再利用して
  │     .akari/connections.json の doctor ブロックを更新・表示する
  │     （キーの値は一切表示しない）
  │
  ├─ 4. 公式音源ライブラリ（AKARI Sounds）の初回セットアップ（src/sounds-setup.mjs）:
  │     未導入かつ TTY のとき生涯 1 回だけ [Y/n]（既定 Yes）を聞き、Yes なら
  │     packages/audio-library-setup/bin/fetch-akari-sounds.mjs で一括ダウンロード。
  │     n は marker（~/.akari/assets/audio/.akari-sounds-declined.json）を書いて以後
  │     聞かない。再入口は `akari sounds`。失敗しても起動は止めない
  │
  └─ 5. 最後に opencode を exec する
        （PATH に opencode が無ければ、インストール案内を出して終了する）
```

サブコマンド: `akari update`（install.sh 経由インストールなら DL・sha256 検証・適用まで
実行。それ以外（npm グローバル / git checkout）や旧フィードでは更新案内のみ表示。
`--rollback` で直前 1 世代へ戻す。`src/self-update.mjs`）/ `akari init`（作業場の作成・確認のみ）/
`akari new <target-dir> [--template <path>]`（新規プロジェクト作成）/
`akari narration generate ...`（VOICEVOX / fal-qwen3 ナレーション生成）/
`akari internal beat-sync-<beatmap|probe-frame|render-when-idle> ...`（beat-sync-edit 内部実行物）/
`akari sounds [--variant wav] [--force]`（公式音源の一括ダウンロード。プロンプトなし・headless 可）/
`akari store <connect|status|download|disconnect>`（AKARI Store 連携。マイページで発行した
接続トークンを `~/.akari/store-credentials.json`（0600）に保存し、購入済み一覧の確認と
配布物の取得ができる。`src/store-command.mjs`）/
`akari assets <list|fetch|sync|...>`（素材カタログの一覧・取得・同期。
`packages/asset-resolver` の CLI への薄い委譲で、カタログ合成・entitlements 判定・
sha256 検証・fail-closed は resolver 側の責務のまま。`src/assets-command.mjs`）。

`akari` に渡した引数はそのまま `opencode` に転送する（例: `akari --continue` は
`opencode --continue` を起動する）。

## 状態・受理・能力検索

```sh
akari status [project-path] --json
akari status [project-path] --full --json
akari accept [project-path]                         # 実 TTY でのみ対話記録
akari capability <query> --json
akari capability <query> --record-miss --json      # 0 hit のときだけ absence receipt
```

fast status は現在工程を決定的に返すが、最終受理を true にしない。full status だけが immutable
render receipt の全 input / output と人間受理 event を再検証し、`release.accepted:true` を返せる。
`accept` が作るのは協調的ローカル運用の人間操作記録であり、暗号学的な本人署名ではない。
capability の 0 hit receipt は `approved_to_build:false` 固定で、新設許可を意味しない。

## 3 入口の対応表

AKARI Video は「同じファイル契約（`.akari/` 配下の JSON）に収束する 3 つの入口」を
持つ（上位契約 §5）。

| 入口 | 実体 | 発動方法 |
|---|---|---|
| ターミナル | この `akari` ランチャー CLI | `npm i -g akari-video` で導入し、シェルで `akari`（または `akari --opencode`）と打つ |
| セッション内 | opencode スキルの自動発見、またはプラグインの `/akari` スラッシュコマンド | opencode セッション内で「新しい動画プロジェクトを作りたい」と発話、または Claude Code セッション内で `/akari` と打つ |
| アプリ | 接続ボタン（AKARI Video アプリ） | アプリの「はじめる」画面から接続 → はじめかた選択 |

3 つとも最終的に同じもの（`.akari/connections.json` / `.akari/intake.json` /
`akari new` が使う共通 project-scaffold）を読み書きするため、どの入口から始めても続きは他の入口から
再開できる。

## インストール

npm publish 済み（v0.1.0 から・provenance 付き）。npm 版はランチャー + エージェント
ワークフロー（skills / 雛形 / schemas を vendor 同梱）のみで、ブラウザプレビュー
（`packages/preview-server`）は含まない。フル構成はリポジトリのインストーラー
（`install.sh` — リリースタグ固定配布）を使う。実行方法:

```sh
# モノレポ checkout 内から、bin を直接実行する（opencode モード）
node packages/akari-launcher/bin/akari.mjs --opencode

# Claude Code モード
node packages/akari-launcher/bin/akari.mjs

# 既定の導入（npm publish 済み）
npm i -g akari-video && akari
npx akari-video
```

## 既知の制約

- npm tarball は追跡済み skills・雛形・schemas と capability source set を `vendor/` に同梱する。
  Claude plugin の status は単体コピーでも動くが、skill symlink と CLI capability は checkout / CLI
  の有無に依存し、利用不能なら明示的に unsupported とする。
- Windows での動作は未検証（`claude.exe` / `claude.cmd` の探索ロジックはあるが
  実機確認していない）。

## テスト

```sh
node --test test/*.mjs
```

`doctor` 分岐（セットアップ済み/未セットアップ）・scaffold 呼び出し（実 project-scaffold
を使った統合テストを含む）・`claude` 不在時の案内、の 3 系統 + 補助的な単体テストを含む。
