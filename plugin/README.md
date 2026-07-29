# AKARI Video プラグイン（配布の背骨）

Claude Code のプラグイン形式で、AKARI Video の編集スキル一式と「続きから」体験を 1 つに束ねる。

## 中身

| コンポーネント | 場所 | 役割 |
|---|---|---|
| スキルパック | `skills/`（`../skills` へのシンボリックリンク。正本を**コピーせず参照**する） | `analyze-footage` / `edit-plan` / `overlay-authoring` などの編集スキル一式 |
| SessionStart hook | `hooks/hooks.json` + `hooks/scripts/session-start.mjs` | カレントに `.akari/` プロジェクトがあれば、intake 状態・直近イベントから「次の一手」をセッション開始時にコンテキスト注入する。無ければ何もしない |
| `/akari` スラッシュコマンド | `commands/akari.md` | doctor 判定 → 状態に応じた案内（未セットアップなら create-project / manage-connections への導線、セットアップ済みなら続きの提示） |

## なぜシンボリックリンクか

Claude Code のプラグインマニフェスト（`plugin.json`）のコンポーネントパスは
`../` による親ディレクトリ参照を許可しない（「コンポーネントパスは常にプラグイン
ルートからの相対パスで、`./` 始まり・`..` 不可」が実仕様）。一方でスキル正本を
プラグイン配下へ**コピー**すると、正本が 2 箇所に分岐し drift のリスクを生む。

そこで `plugin/skills` をリポジトリ直下 `skills/` へのシンボリックリンクにした。
`plugin.json` 側はデフォルトの `./skills` 探索パスをそのまま使うだけで、
ファイルシステム越しに正本を参照できる（`packages/project-scaffold` が
`.agents/skills` / `.cursor/skills` / `.codex/skills` を `.claude/skills` へのシンボリックリンクに
する既存の流儀と同じ考え方）。

**既知の制約**: この方式はプラグインが本リポジトリの checkout と同じ場所に置かれて
いることを前提にする。マーケットプレイス経由でのリモート配布・npm 経由の単体配布
（プラグインだけを別ディレクトリへコピーする配布形態）では、シンボリックリンクの
参照先が失われる。マーケットプレイス公開・配布チャネル整備は本タスクのスコープ外
（上位契約 §7）のため、現状は「モノレポ checkout 内で有効なプラグイン」として設計
している。

## 有効化（ローカル検証）

このプラグインは `npm publish` されない（本タスクのスコープは器の実装まで）。
ローカルで試す場合は、Claude Code のプラグイン機構（`/plugin` 系コマンド、または
プロジェクトの `.claude/settings.json` でこのディレクトリを指す）でこのリポジトリの
`plugin/` を指定する。
