---
description: AKARI Video の canonical status を確認し、記録された次の一手を案内する
allowed-tools: Bash(node:*), Bash(akari status:*), Bash(akari capability:*), Bash(akari init:*), Bash(ls:*), Bash(test:*), Bash(mkdir:*), Read, Write
disable-model-invocation: false
---

AKARI Video の状態を確認し、利用者の言語で短く案内する。

## 状態取得（唯一の工程判定）

最初に次を実行する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.mjs" --status-json "$PWD"
```

この出力が工程・review 集計・次の skill・待ち相手・release 状態の正本である。独自の工程表を
作らず、`workflow_stage`、`next_skill`、`waiting_on`、`review`、`release`、`problems` をそのまま
根拠にする。`state_health: inconclusive` またはコマンド失敗時は状態取得不能と明示し、旧イベント
推測や `.akari/intake.json` だけの判定へフォールバックしない。

最終受理の確認を依頼された場合は、CLI があれば次も実行する。

```bash
akari status "$PWD" --full --json
```

CLI が無い copied-plugin 環境では、同じ生成 core を使う次のコマンドで full status を取得する。

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.mjs" --status-json "$PWD" --full
```

`release.accepted: true` は full status だけが返せる。fast status の受理記録表示を最終受理と解釈しない。

## 案内

- `project.scaffolded: false`: このフォルダーは未セットアップと伝え、`akari` ランチャーまたは
  `akari` 入口スキルを案内する（下記の委譲先を読む）。
- `state_health: valid`: `next_skill` があればその skill、`waiting_on` があればその人間操作を
  次の一手として 1〜2 文で案内する。
- `state_health: inconclusive`: `problems` を短く示し、推測で作業を進めない。

`.akari/connections.json` がある場合は `manage-connections` skill の doctor を追加で実行してよい。
キー値や HTTP 応答本文は表示しない。doctor は接続診断であり、工程判定を上書きしない。

## capability

能力検索を求められた場合は `akari capability <query> --json` を使う。copied-plugin 環境で
`akari` CLI が無い場合、capability はこの surface では unsupported と明示する。skill 一覧を
推測して別の検索結果を作らない。

## 作業場（CreatorRoot）の検出・作成・案内
作る・開く・続きからの手順は `skills/akari/SKILL.md` に委譲する。
`${CLAUDE_PLUGIN_ROOT}/skills/akari/SKILL.md` をパスで直接読み、その手順に従う。
