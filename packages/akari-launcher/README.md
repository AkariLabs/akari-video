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
  └─ 4. 最後に opencode を exec する
        （PATH に opencode が無ければ、インストール案内を出して終了する）
```

`akari` に渡した引数はそのまま `opencode` に転送する（例: `akari --continue` は
`opencode --continue` を起動する）。

## 3 入口の対応表

AKARI Video は「同じファイル契約（`.akari/` 配下の JSON）に収束する 3 つの入口」を
持つ（上位契約 §5）。

| 入口 | 実体 | 発動方法 |
|---|---|---|
| ターミナル | この `akari` ランチャー CLI | `npm i -g akari-video` で導入し、シェルで `akari`（または `akari --opencode`）と打つ |
| セッション内 | opencode スキルの自動発見、またはプラグインの `/akari` スラッシュコマンド | opencode セッション内で「新しい動画プロジェクトを作りたい」と発話、または Claude Code セッション内で `/akari` と打つ |
| アプリ | 接続ボタン（AKARI Video アプリ） | アプリの「はじめる」画面から接続 → はじめかた選択 |

3 つとも最終的に同じもの（`.akari/connections.json` / `.akari/intake.json` /
`skills/create-project`）を読み書きするため、どの入口から始めても続きは他の入口から
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

`package.json` は `"private": true` のままにしてある（誤って publish されることを防ぐ
セーフティネット）。実際に npm へ配信する契約が別途 approve されたときに、まず
この 1 行を外すところから始める。

## 既知の制約

- **配布パッケージとしての自己完結性は未整備**: `akari` はスキル正本・
  `templates/project-default`・`packages/schemas` を、自分の checkout 位置からの
  相対パスで解決する（`skills/create-project/bin/create-project.mjs` と同じ方式）。
  これはこのリポジトリの checkout 内で実行される前提であり、npm レジストリ経由で
  単体インストールされた場合にこれらのアセットを同梱する build/vendor 手順はまだ
  実装していない（マーケットプレイス配布・審査は上位契約 §7 でスコープ外）。
- Windows での動作は未検証（`claude.exe` / `claude.cmd` の探索ロジックはあるが
  実機確認していない）。

## テスト

```sh
node --test test/*.mjs
```

`doctor` 分岐（セットアップ済み/未セットアップ）・scaffold 呼び出し（実 project-scaffold
を使った統合テストを含む）・`claude` 不在時の案内、の 3 系統 + 補助的な単体テストを含む。
