---
description: AKARI Video の canonical status を確認し、記録された次の一手を案内する
allowed-tools: Bash(node:*), Bash(akari:*), Bash(ls:*), Bash(test:*), Bash(mkdir:*), Read, Write
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
  `create-project` skill を案内する。作業場を新規作成する前に必ず利用者へ確認する。
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

「新しいプロジェクトを作りたい」「作業場を作って」と明示されたとき、**または**
`project.scaffolded: false` のときにこの節を使う。明示要求は現在のフォルダーが既存プロジェクトでも
作業場 discovery・同意導線を発火させる。canonical status core は工程判定の正本のまま維持し、
この節はプロジェクト外での作業場 discovery と同意取得だけを補う。**作業場**は利用者 1 人のプロジェクト・素材・
設定をまとめる置き場（既定 `~/AkariVideo/`）。用語・構造の正本は公開契約
`docs/contract-2026-08-02-creator-root-v1.md` §3。

### 検出

次の 2 経路のどちらかで既存の作業場を探す（どちらか一方でも見つかれば作業場ありと判定）。

1. `<AKARI_HOME>/creator-root.json`（`AKARI_HOME` 環境変数、無ければ既定 `~/.akari`）を
   読み、`lastRoot` が指すパスが実在するか確認する
2. カレントディレクトリから祖先方向へ `.akari/root.json` を探し、見つかれば読んで
   `schema` が `"creator-root/v1"` であることを確認する

見つかった場合は「見つかった場合」へ、見つからなかった場合は「見つからない場合」へ進む。
どちらのファイルも壊れている（JSON が壊れている・`schema` が未知）場合は、上書きせず
利用者にそのまま報告する（読み取り拒否が正しい挙動）。

### 見つかった場合

新しいプロジェクトの作成先は `<作業場>/channels/<channel>/videos/<日付-スラッグ>/` とする。
`<channel>` は `root.json` の `channels` の先頭、無ければ `my-channel`。作業場の場所を利用者へ
1 行で伝えたうえで、下記「導線」に進む。

### 見つからない場合 — 勝手に作らない

作業場が無いことを検出しても、**利用者の同意なしに作成しない**（提案 → 同意 → 作成の順）。
「作業場（既定 `~/AkariVideo/`。変更したい場合は場所を聞く）を作ってよいか」を尋ね、同意が
得られてから次を実行する。

- **作成（第一手段）**: `akari init` を実行する（引数なし。既存の作業場があれば何も作らず
  そのパスを stdout 1 行目に返す ensure 動作・冪等）。`akari` が PATH に無ければリポ内
  `packages/akari-launcher/bin/akari.mjs init` を直接実行する。この経路はマシンポインタ
  `<AKARI_HOME>/creator-root.json` も更新する。

- **作成（フォールバック）**: 上記 2 経路を実行できない環境でのみ、利用者が承認した場所へ
  公開契約 §3 の正準構造を手で生成してよい。

  ```text
  <作業場>/
  ├── akari.md
  ├── channels/<channel>/videos/
  ├── library/
  ├── inbox/
  └── .akari/
      ├── root.json
      ├── memory/
      └── cache/
  ```

  `root.json` は
  `{"schema":"creator-root/v1","createdAt":<ISO8601>,"channels":[<channel>]}` とする。
  `akari.md` スタブの文面（新規作成時のみ・既存があれば触らない）:

  ```markdown
  # akari.md

  この作業場（CreatorRoot）の規約・好みを書く場所です。
  AKARI Video のエージェントは動画を作る前に、まずこのファイルを読みます。

  ## 好み

  （まだ何も書かれていません）
  ```

  手動生成では次の 2 規律を必ず守る。

  1. **既存ファイルを一切上書きしない**。`root.json` や `akari.md` があれば書かず「検出」に戻る
  2. **`root.json` は最後に書く**。全ディレクトリと `akari.md` の作成完了後に作業場マーカーを置く

  フォールバックでは `<AKARI_HOME>/creator-root.json` を書かない。以後は cwd 祖先探索に頼るため、
  可能な限り `akari init` を優先する。

### 導線（見つかった場合・見つからない場合 共通）

- ターミナルで `akari` ランチャーを実行すれば、作業場の確認・作成からプロジェクト作成へ進める
- このセッションのままなら `create-project` skill の `<target-dir>` に
  `<作業場>/channels/<channel>/videos/<日付-スラッグ>/` を渡す（リポ checkout なら
  `skills/create-project/SKILL.md`、プロジェクト内なら `.claude/skills/create-project/SKILL.md`）
- `claude plugin install` で導入したアプリ単体/copy 環境ではシンボリックリンク越しの skill 正本が
  届かないことがある。両方のパスが無い場合はその旨を伝え、`akari` CLI 経路を優先する
- どちらを選ぶか、または素材・テンプレ・過去プロジェクト・相談のどれから作るかを尋ねる
