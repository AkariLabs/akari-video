# AKARI Video プラグイン（配布の背骨）

Claude Code のプラグイン形式で、AKARI Video の編集スキル一式と「続きから」体験を 1 つに束ねる。

## 中身

| コンポーネント | 場所 | 役割 |
|---|---|---|
| スキルパック | `skills/`（`../skills` へのシンボリックリンク。正本を**コピーせず参照**する） | `analyze-footage` / `edit-plan` / `overlay-authoring` などの編集スキル一式 |
| status core | `runtime/status-core/`（generator output） | launcher 正本の byte-identical mirror。fast/full の工程・受理判定を共有する |
| SessionStart hook | `hooks/hooks.json` + `hooks/scripts/session-start.mjs` | canonical fast status と次の一手をコンテキスト注入する。無ければ何もしない |
| `/akari` スラッシュコマンド | `commands/akari.md` | canonical status を根拠に案内する。独自の工程表は持たない |

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

**配布時の挙動（2026-09-17 実測）**: Claude Code はプラグインをマーケットプレイスから導入するとき、
プラグインをキャッシュ（`plugins/cache/akari/akari/<version>/`）へコピーし、その際に
`plugin/skills → ../skills` のシンボリックリンクを解決して**実体**を置く（全スキルが実ファイルで入る）。
このため checkout と同じ場所に無いリモート配布でも、スキルの正本がそのまま届く
（symlink を解決しない単純コピーで `plugin/` だけを持ち出した場合は、この限りでない）。
ただしマーケットプレイスの clone はリポジトリ全体になる（約 1 GB。スキル本体は 1 MB 弱）。
軽量化が要る場合は `plugin/` の実体ミラーを置く専用マーケットプレイスを別途検討する。

capability 検索は `akari capability` CLI の責務である。単体コピー先で CLI が無ければ
明示的に unsupported とし、プラグイン独自カタログへフォールバックしない。

## 有効化

このプラグインは `npm publish` されない（本タスクのスコープは器の実装まで）。

**第一手段 — マーケットプレイスから**（リポジトリ直下の `.claude-plugin/marketplace.json` を使う）:

```sh
claude plugin marketplace add AkariLabs/akari-video
claude plugin install akari@akari
```

更新は `claude plugin update akari@akari`（マーケットプレイスの再取得 + 版の再コピー）。
プラグインが届けるのはスキル・`/akari`・SessionStart hook で、`akari` CLI は含まない
（CLI はインストーラーで入れる。`docs/getting-started.md` §B）。

**第二手段 — ローカル checkout を指す**（開発・検証用）: Claude Code のプラグイン機構
（`/plugin` 系コマンド、またはプロジェクトの `.claude/settings.json` でこのディレクトリを指す）で
このリポジトリの `plugin/` を指定する。
