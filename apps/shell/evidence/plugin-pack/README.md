---
layer: wiki
tier: 30_products
type: product
status: active
updated: 2026-07-21
---

# plugin-pack 実機検証手法・証跡

タスク: プラグイン（スキルパック + SessionStart hook + `/akari`）+ `akari` ランチャー
（シェル UX v2 T5）の実機検証記録。

## 手法

### 1. `akari` ランチャー: リポ外の一時ディレクトリでの通し実行

- 作成先はいずれも `/tmp` 配下（このリポ・worktree の外）。ビルド済みの
  `packages/akari-launcher/bin/akari.mjs` を `node` で直接実行した
  （task 許容: 「bin 直接実行で可」）。
- **実 `claude` は実行しなかった。** このマシンでは `claude` はインタラクティブ
  シェルの alias（`cmux claude-teams --teammate-mode in-process`）経由でのみ動作し、
  かつ子プロセス起動は alias を解決しない（`type -a claude` で実体は
  `~/.local/bin/claude` 相当の実行ファイルとして存在するが、この検証エージェント
  自身が Claude Code セッション内で動いているため、そこから実 `claude` を再起動する
  ことは安全でない）。そこで task.md が明示的に許容する代替手順
  （「PATH 先頭にダミー claude を置いて exec 到達を実証」）を採用した。
  ダミーは「引数・cwd を echo して exit 0」だけの shell script。
- 3 パターンを検証した:
  1. **未セットアップの空フォルダ**: 案内 → `project-scaffold`（実物）を呼んで雛形を
     作成 → `.akari/intake.json`（`status: "draft"`）が生成される → 接続確認
     （`manage-connections/bin/doctor.mjs` を実際に子プロセスとして実行）→ ダミー
     `claude` に到達（cwd・引数が正しく渡っていることを確認）
  2. **既にセットアップ済みの同フォルダに再実行**（引数 `--continue` 付き）:
     scaffold は呼ばれず（`既存の AKARI Video プロジェクトを検出しました` の分岐）、
     ダミー `claude` に `--continue` がそのまま転送されることを確認
  3. **PATH に `claude` が全く無い状態**: 案内文（`https://claude.ai/install.sh`）
     を出して `exitCode 1` で終了し、ダミー `claude` にも到達しないことを確認
- 後片付け: 検証用の一時ディレクトリはすべて検証後に削除。コミットしていない。

### 2. SessionStart hook: スクリプト単体実行

`plugin/hooks/scripts/session-start.mjs` に、hook 入力（`cwd` を含む JSON）を stdin
から直接渡して 4 パターンを確認した:

1. `.akari/` が無いディレクトリ → stdout 出力なし（何もしない）
2. `.akari/intake.json` が `status: "draft"`・イベント無し →
   「進め方はまだ未確定です」+「まだ記録された節目はありません」を注入
3. `.akari/intake.json` が `status: "submitted"`（tasks 2 件）+
   `.akari/events/` に 2 件（`report-generated` → `edit-completed`）→
   tasks を日本語ラベル（`packages/schemas/intake.schema.json` の
   `x-akari-labels` から取得）で要約し、**最新**イベント（`edit-completed`）に
   応じた次の一手を注入することを確認（タイムスタンプ比較で新しい方を選ぶ実装）
4. `.akari/intake.json` が壊れた JSON → クラッシュせず、「intake.json がまだ
   ありません」の分岐にフォールバックして `exit 0` で終了

出力形式は実在プラグイン（`learning-output-style`）が使っている
`{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "..."}}`
の実例と同型であることを、ローカルの `~/.claude/plugins/` 配下の実物プラグインを
読んで確認した（読み取りのみ・変更なし）。

### 3. プラグイン構造の照合

`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/` の
`plugin-structure` / `hook-development` / `command-development` スキル（実仕様の
参照ドキュメント）と照合し、次を確認した:

- `plugin.json` は `.claude-plugin/` 直下・`name` は kebab-case 正規表現に適合
- コンポーネントパスは `../` による親ディレクトリ参照を許可しないため、
  スキル正本を**コピーせず参照**する手段として `plugin/skills` を
  リポジトリ直下 `skills/` への**シンボリックリンク**にした（デフォルトの
  `./skills` 探索パスがそのまま効く。`plugin.json` にパス指定は不要）
- `hooks/hooks.json` は plugin 形式（`{"description":..., "hooks": {...}}`）
- `commands/akari.md` は YAML frontmatter（`description` / `allowed-tools` /
  `disable-model-invocation`）付きの Markdown で、実例（`code-review` プラグインの
  `commands/code-review.md`）と同型

## 実測結果の要旨

| 項目 | 結果 |
|---|---|
| L0: `npm run build:ext` | exit 0（apps/shell、本タスクの変更は当該ディレクトリに触れていないため非退行確認） |
| L0: `npm run lint` | exit 0（同上） |
| `packages/akari-launcher` 自体のテスト | `node --test test/*.mjs` — 18 件 pass, 0 fail（doctor 分岐 2 件・実 scaffold 統合 1 件・claude 不在時の案内 1 件・scaffold 失敗時も claude まで到達する不変条件 1 件 + 単体テスト 13 件） |
| 実機通し（未セットアップ → scaffold → doctor → claude 到達） | `.akari/intake.json` が `status: "draft"` で生成・`.claude/skills/` にスキル一式が同梱・doctor が実際に `connections.json` を書き戻し・ダミー `claude` に空引数・正しい cwd で到達し `exit 0` |
| 実機通し（再実行・引数転送） | scaffold は再実行されず、`--continue` がダミー `claude` にそのまま転送される |
| 実機通し（claude 不在） | 案内文 + `exit 1`。ダミー `claude` は起動されない |
| doctor の副作用（想定内） | このマシンには `~/.config/akari-video/credentials.env` が実在するため、doctor が `fal` / `groq` / `elevenlabs` に対して実際に無償・読み取り専用の GET を行い `ok` と判定した（`manage-connections` の FORBIDDEN 級ハードルール #4 の範囲内の正規動作。キー値は一切表示されていないことを出力で確認済み） |
| SessionStart hook 単体実行 | 4 パターンとも想定どおり（無ければ無出力・draft 案内・submitted+最新イベントの要約・壊れた JSON でもクラッシュしない） |
| governance セルフ走査 | 4 パターンとも本タスクの新規・変更ファイルでヒット 0 件（`git grep` で確認。リポジトリ全体では pattern 4 に既存 allowlist 済みの 7 件のみ残存、いずれも本タスク外） |

## 未確認事項

- 実 `claude` バイナリを使った検証は行っていない（このマシンでは alias 経由でしか
  動かず、検証エージェント自身のセッションを壊すリスクがあるため。task.md 明記の
  ダミー CLI 代替を採用）
- `plugin/` を実際に Claude Code のプラグイン機構（`/plugin marketplace add` 等）で
  読み込ませた実地確認はしていない。プラグイン構造・hooks.json・commands の
  frontmatter は plugin-dev の参照ドキュメント（実仕様の一次情報）と照合済みだが、
  Claude Code 本体による実ロードは未実施
- Windows での `akari` 動作（`claude.exe` / `claude.cmd` 探索を含む）は未検証
  （macOS darwin-arm64 のみで検証）
- npm レジストリへの実配布（`npm publish` / グローバル install / `npx`）は本タスクの
  スコープ外のため未検証。`package.json` は `"private": true` のままにしてあり、
  実配布は別途の承認を要する
