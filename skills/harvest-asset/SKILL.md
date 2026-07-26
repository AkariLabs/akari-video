---
name: harvest-asset
description: 案件で作った高コスト・再利用価値の高いオーバーレイ、3D、モーション、テロップ、サムネ構図、音源、B ロールを AKARI Video の assets ライブラリへ素材化するときに発動する。入庫判定、meta.json 下書き、preview、INDEX 更新、検証を行う。
---

# 素材化ワークフロー

> **Language**: Respond in the user's language — 対話・質問・承認確認・レポートはユーザーの使用言語に合わせる（例: 英語で話しかけられたら英語で応答する）。

順序を変えず、導出できる情報を人へ質問しない。

## 1. 入庫基準を判定する

**「生成コストが高い、または生成不能なものだけ」を入れる。** 次のどちらも満たさなければ収穫を中止し、理由を報告する。

- 自然言語から毎回すぐ再生成できない。例: license 済み 3D model、多要素の複雑 motion、完成度の高い telop / thumbnail 構図、音源、B-roll。
- 再利用時に、保存・検索・license 管理の価値が生成コストを上回る。

単純字幕、色違いだけ、素朴な fade / slide、案件固有文言を差し替えただけの断片は入れない。既存 asset と本質的に同じ場合も variant を増やさず、既存 asset の knob で表せるかを先に確認する。

## 2. 作業用 package と `meta.json` 下書きを作る

source fragment と同階層の依存 asset を読み、作業用一時ディレクトリへ自己完結した package を組む。最終配置前に次を自動抽出する。

### CSS 変数 → `knobs`

1. fragment 内の `--name: value` と `var(--name, fallback)` を列挙する。
2. 重複を除き、runtime 所有の `--x`、`--y`、`--scale`、`--rotate` と素材固有 knob を区別する。
3. default は宣言値または fallback から取り、fragment と preview の確認に使う。schema v0 にない `default` field は `meta.json` へ追加せず、値を発明しない。
4. 型を次の語彙へ機械的に寄せる。
   - 色値 → `color`
   - 数値 + 単位 → `slider`。`min` / `max` は根拠が抽出できる場合だけ付ける
   - media URL / `src` → `media`
   - boolean の表示切替 → `checkbox`
   - 有限の選択肢がコードから読める → `dropdown`
   - それ以外の置換可能文字列 → `text`
5. `group` と `label` は variable 名と利用箇所から生成する。曖昧な推論は下書きに注記し、人へ新しい質問を増やさない。

### 依存 → `requires` と同梱対象

- `<script src>`、module import、`@import`、`url()`、`src` / `href`、Three.js addon / decoder、font、model、texture、audio、video を走査する。
- package / runtime 名は `requires` へ、相対 file は copy 対象へ分ける。
- CDN / remote URL はそのまま採用せず、license を確認して local 化するか入庫を止める。
- file が存在しない参照、fragment 外へ抜ける相対 path、未使用依存を残さない。

### その他の自動導出

- `id`: source 名と内容から kebab-case で生成する。
- `category`: `3d` / `motion` / `telop` / `audio` / `broll` / `font` / `thumbnail` から単一カテゴリを内容から選ぶ。横断軸は `tags` にする。サムネイルの HTML 文字組テンプレは `thumbnail`（背景差し替え前提で、文字組レイヤーだけを素材化する）。
- `title` / `description` / `tags`: 見た目、役割、aspect、scene を source と利用文脈から要約する。
- `provenance`: origin project、元 path、生成手、prompt、日時を既存情報から埋める。分からない値を捏造しない。
- media の寸法、duration、codec、model 情報は `sips`、`ffprobe`、利用可能な GLB inspector などで読める場合だけ確認し、description / tags / preview 判断へ使う。schema にないトップレベル field は追加しない。
- `author` は既知の project / git 情報から、`price` は現行契約どおり `null` とする。

`meta.json` は `docs/contract-2026-07-13-asset-library.md` の schema v0 に合わせ、正式 key `when_to_use` を使う。依頼文中の `when_use` はこの key の意味と扱う。

## 3. 人間判断が必要な 4 項目だけを聞く

自動抽出結果を短く見せ、次の 4 項目を一度に質問する。それ以外は質問しない。

1. **when_use** → `when_to_use`: どの scene / 目的で使うか。
2. **ai_usage**: AI が変えてよい部分、守る部分、禁止する改変。
3. **license**: SPDX、commercial scope、attribution 要否、AI training 可否。license 不明を既定許可にしない。
4. **登録先スコープ**: `local`（そのプロジェクトのみ）/ `shared`（上位ディレクトリの `.akari/assets/`、事業・組織単位）/ `user`（`~/.akari/assets/`、全プロジェクト共通の定番）/ `builtin`（製品リポ。昇格は PR 経路）。目安を添えて聞く: プロジェクト固有の文言・素材が残るなら `local`、汎用化できたなら `user`。黙って `builtin` に入れない。

回答を `meta.json` に反映する。license が確定しない asset はどの層にも入れない。

## 4. `preview.png` を生成する

- HTML / CSS: 単一の preview harness へ fragment を置き、local font / image の load を待って headless Chrome で撮る。動画 timing は代表時刻へ seek する。
- 3D: model、material、texture が読める代表 pose を使う。現行 Three.js live runtime が未整備でも、実物ではない代替画像を model preview と偽らない。
- B-roll / video: `ffmpeg` で内容を代表する frame を選ぶ。
- audio: waveform と title / duration を読める preview を作る。
- thumbnail / still: 元 asset を aspect を壊さず preview canvas へ収める。

preview は中身を識別するためのものとし、source と違う架空の完成図を生成しない。schema または category INDEX に寸法規約が追加されていたら、それを優先する。

## 5. 選ばれたスコープの `assets/<category>/` へ配置する

配置先は**登録先スコープ（手順 3 で確定）の** `assets/<category>/<id>/` とし、階層を増やさない。スコープの実ディレクトリ（`local` = プロジェクト内 / `shared` = 上位の `.akari/assets/` / `user` = `~/.akari/assets/`）が無ければ category と INDEX.md ごと新設する。層が違っても構造・meta.json v0・validator は同一。最低限、次をそろえる。

- `meta.json`
- `preview.png`
- 実体。HTML 表現は `fragment.html`、ほかは model / media 本体
- fragment が参照する local dependency

同名 directory が既にあれば上書きしない。内容を比較し、更新か新 ID かの明示判断を得る。採用時は library 外への symlink を残さず、package を自己完結させる。

## 6. category `INDEX.md` を更新する

`assets/<category>/INDEX.md` に、ID 順または既存の並び規則を守って 1 行追加する。

```text
<id> — <何で、どんな場面向けかを一文で>
```

重複行を作らない。新 category のときだけ `assets/INDEX.md` にもカテゴリ説明を追加する。

## 7. validator で検証する

まず `packages/schemas/bin/validate-asset.mjs` と `packages/schemas/asset-meta.schema.json` の存在、script 内の usage を確認する。現行 usage では、次のように対象 package を渡す。

```sh
node packages/schemas/bin/validate-asset.mjs "assets/<category>/<id>"
```

将来 usage が変わっていれば script を正とし、引数を推測しない。失敗時は `meta.json`、最小 3 点、category 一致、relative dependency、INDEX を直し、成功するまで再実行する。

script または schema がまだない場合、成功扱いにせず成果報告へ次をそのまま残す。

```text
後で実行: node packages/schemas/bin/validate-asset.mjs（validator / schema 作成後）
```

## よくある間違い

- 「きれいにできた」だけで、毎回生成できる単純表現を入庫する。
- CSS 変数や依存を人へ転記させる。
- `when_to_use` を `when_use` という非 schema key で保存する。
- slider の min / max、license、provenance を推測で埋める。
- CDN や案件 directory への相対参照を残す。
- 1 asset を複数 category へ複製する。
- 登録先スコープを聞かず、黙って `builtin`（製品リポ）へ入庫する。
- プロジェクト固有の文言・画像が残ったまま `user` / `builtin` へ入れて、他プロジェクトで使えない資産を作る。
- preview を作らず、または実体と違う mock を preview にする。
- INDEX を更新せず、grep で発見不能にする。
- validator がない状態を validation pass と報告する。

## 根拠

- 入庫基準、schema、構造、収穫: `docs/contract-2026-07-13-asset-library.md`
- authoring hard rules: [../overlay-authoring/SKILL.md](../overlay-authoring/SKILL.md)
