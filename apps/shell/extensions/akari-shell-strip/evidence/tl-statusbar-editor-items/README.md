# 証跡: ステータスバーにテキストエディタの標準項目を出さない（tl-statusbar-editor-items）

検証はラッパーが実施（実機 = CDP ポート 9479・名前に `tl-statusbar-editor-items` を含む一時ディレクトリの
`--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`・一時 workspace。起動した Electron の PID だけを止める）。
記録物（スクリーンショット・JSON）はリポの外に置き、ここには再現スクリプトと要約だけを残す。

## スクリプト（`scripts/`）

| ファイル | 用途 |
|---|---|
| `cdp-lib.mjs` / `l1-lib.mjs` | `akari-annotations/evidence/placed-text-own-row/scripts/` の写し（`launch` に起動前フック `beforeSpawn` を足した） |
| `probe.mjs` | BEFORE: 起動 → 無題のテキスト文書 → 案件の `CLAUDE.md` を開き、最下段バーの項目（id・文言・幅）を採る |
| `l1-run.mjs` | AFTER: 課題 1 件の fixture（存在しない静止画を `sources[0]` に持つ）→ タイムラインでクリップを動かして課題チップ → 無題のテキスト文書 → `CLAUDE.md` → ルーラーのクリックで一過性の報告。第 3 引数に Claude Code 拡張の展開済みディレクトリを渡すと、隔離した設定ディレクトリの `deployedPlugins/` へ複製して読み込ませる |

使い方（`apps/shell` を build 済みにしてから）:

```sh
AKARI_REPO=<リポ> AKARI_SCRATCH=<一時ディレクトリ> node scripts/probe.mjs before <記録先>
AKARI_REPO=<リポ> AKARI_SCRATCH=<一時ディレクトリ> node scripts/l1-run.mjs after <記録先> [<Claude Code 拡張のディレクトリ>]
```

## 原因（BEFORE・基点ビルド）

テキストエディタ（`@theia/editor` / `@theia/monaco` の Monaco エディタ）が現在のエディタになると、Theia が次の項目を `StatusBar.setElement` で登録する。
無題のテキスト文書でも、案件のファイル（`CLAUDE.md`）でも同じ 6 項目が右側に出た。

| 表示 | 項目 id（DOM は `status-bar-<id>`） | 登録元 |
|---|---|---|
| Ln 1, Col 1 | `editor-status-cursor-position` | `@theia/editor` editor-contribution |
| LF | `editor-status-eol` | `@theia/monaco` monaco-status-bar-contribution |
| UTF-8 | `editor-status-encoding` | `@theia/editor` editor-contribution |
| Spaces: 4 | `editor-status-tabbing-config` | `@theia/monaco` monaco-status-bar-contribution |
| {} | `editor-language-status-items` | `@theia/editor` editor-language-status-service |
| Plain Text | `editor-status-language` | `@theia/editor` editor-language-status-service |

（ピン留めした書式設定の項目 `editor-formatter-status` も同じ経路で出るので一緒に抑止する。）

## AFTER（本タスクのビルド）

`AkariStatusBar`（`StatusBarImpl` のサブクラス）が上の 7 つの id の `setElement` を `removeElement` に置き換える。
`StatusBarImpl` と `StatusBar` を同じシングルトンへ rebind し、ApplicationShell のレイアウトに乗る実体と各 contribution が呼ぶ実体を揃えた。

| 状態 | 現在のエディタ | 最下段バーの項目（左 → 右） | エディタ項目 |
|---|---|---|---|
| タイムラインを開いた直後 | なし | アカウント・問題数・リソース・✻ Claude Code・通知ベル・下パネル | 0 |
| クリップを動かして保存 | なし | 上 + 中央に「⚠ 課題 1」（left 666.1・幅 53.9） | 0 |
| 無題のテキスト文書がアクティブ | `Untitled-1` | 上と同じ（課題チップ・✻ Claude Code あり） | **0** |
| `CLAUDE.md` をアクティブにしてクリック | `CLAUDE.md` | 上と同じ | **0** |
| ルーラーをクリック（報告表示中） | `CLAUDE.md` | 上 + 「00:00:09.313 にプレビューをシークしました。」（課題チップの右） | **0** |

右パネルの Claude Code（「Untitled」のセッション）を開いたままでも同じ。
「✻ Claude Code」は拡張の項目（id `plugin-status-bar-item:<uuid>`）で、抑止の対象外。
