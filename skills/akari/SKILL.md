---
name: akari
description: AKARI Video のプロジェクトを作る・開く・続きから再開する。`.akari/` の無いフォルダで動画を作りたいと言われたとき、または AKARI のプロジェクトの状態を知りたいときに使う。
---

# AKARI Video を始める・再開する

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

この入口は次の 3 分岐だけを担当する。本体スキルの手順はここに複製しない。
以下の `akari` は PATH 上の CLI を使う。無ければ
`node "${AKARI_HOME:-$HOME/.akari}/app/packages/akari-launcher/bin/akari.mjs"`、
それも無ければ実在するリポ checkout の `packages/akari-launcher/bin/akari.mjs` を
`node` で実行する。どれも無い場合は不足を伝えて止め、パスを捏造しない。

## 続きから

1. cwd から祖先方向へ `.akari/` を探す。見つかったプロジェクトを `<project>` とする。
   `.akari/root.json` の `schema: "creator-root/v1"` は作業場の印であり、作品の印ではない。
   作業場だけが見つかった場合は、依頼に応じて「作る」か「開く」へ進む。
2. `akari status "$PWD" --json` を実行する。`next_skill` / `waiting_on` を根拠に、
   次の一手を 1〜2 文で案内する。失敗や `state_health: inconclusive` は取得不能と伝え、
   ファイルの断片から工程を推測しない。
3. `next_skill` がある場合は `<project>/.claude/skills/<next_skill>/SKILL.md` を
   **パスで直接読む**。無ければ不足を伝え、別の手順を発明しない。
   `waiting_on` がある場合はその操作を案内し、本体スキルの待ち条件を飛ばさない。

## 作る

`.akari/` が無い、または新規作成を明示された場合に使う。

1. 作業場を次の 2 経路で検出する（どちらか一方でも見つかれば作業場あり）。
   - `<AKARI_HOME>/creator-root.json`（未設定時は `~/.akari/creator-root.json`）の
     `lastRoot` が実在するか確認する。
   - cwd から祖先方向へ `.akari/root.json` を探し、
     `schema` が `"creator-root/v1"` であることを確認する。
   見つかった作業場のマーカーも読む。JSON 破損・未知 schema は上書きせず報告する。
2. **1 問だけ**「作業場 `~/Akari/` に作りますか、このフォルダに作りますか？
   作業場が無ければ `akari init` で作成します」と尋ねる。
   既存の作業場が見つかった場合は、その実パスで `~/Akari/` を置き換える。
   作業場を選んだときの具体的な宛先も同じ質問に含める:
   `<作業場>/channels/<channel>/videos/<日付-スラッグ>/`。
   `<channel>` は `root.json` の `channels` の先頭、無ければ `my-channel`。
   日付と依頼内容から短いスラッグを提案し、既存の作品と同名なら別名を提案する。
   このフォルダを選んだ場合の `<target>` は cwd。
3. 同意後、作業場を選び未作成の場合だけ `akari init` を実行する。
   引数なしの ensure 動作は冪等で、既存作業場があれば stdout 1 行目にそのパスを返す。
   返された場所が同意済みの場所と異なる場合は、勝手に別の場所へ作らない。
4. `akari new "<target>"` を実行する。既存ファイルを上書きせず不足分だけ補完し、
   既存リポジトリの内側では git init しない F18 ガードを CLI に委ねる。
   本体スキルは実体コピーのまま、`AKARI-SKILLS-VERSION` で作成時点の版を記録する。
5. stdout の作成レポートのパスと「次は `edit-plan`」を案内し、
   `<target>/.claude/skills/edit-plan/SKILL.md` を**パスで直接読む**。
   セッション途中に作ったスキルは列挙に載らない場合がある。次回そのプロジェクトで
   エージェントを起動すれば列挙に載るため、今のセッションでは直接読む。

作業場が無いことを検出しても、**利用者の同意なしに作成しない**（提案 → 同意 → 作成の順）。
上の 1 問が同意取得を兼ねる。既に宛先まで明示して同意されている場合は再確認しない。
CLI が実行できない場合の作業場だけの手動生成は、同意済みの場所に限り、
`akari.md`、`channels/<channel>/videos/`、`library/`、`inbox/`、
`.akari/memory/`、`.akari/cache/` を作る。
`akari.md` は次のスタブを使う:

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

`.akari/root.json` は
`{"schema":"creator-root/v1","createdAt":<ISO8601>,"channels":[<channel>]}` とする。
フォールバックでは `<AKARI_HOME>/creator-root.json` を書かない。
CLI 不在のままプロジェクト生成まで済んだとは扱わず、`akari new` の不足を伝える。

## 開く

「作る」の検出手順だけで作業場を探し、`<作業場>/channels/*/videos/*` の実在する
プロジェクトディレクトリを列挙して選ばせる。見つからなければ、その旨と「作る」を案内する。
選んだプロジェクトを cwd にして「続きから」へ進む。読み取りだけで作業場を新設しない。
