# 素材ライブラリ契約 v0

- 日付: 2026-07-13
- 状態: 設計確定
- 前提: 本体（エンジン）は合成だけ。素材とその知識は全部外側に置く

## 思想

- **Pool 等の外部基盤に依存しない。ゼロベースのファイルベース**。git リポジトリが正典
- **LLM Wiki の単純さ**: AI は INDEX.md を読む → カテゴリを深掘る → meta.json を読む、で
  完結。人間も同じ道を歩ける。検索エンジンは当面持たない
- 実証済みの型を踏襲する: shadcn レジストリ方式（コピーして手元で改変・JSON スキーマ）。
  先行のコンポーネント配布エコシステムが動画コンポーネントで同型を実証済み

## 入庫基準（最重要）

**「生成コストが高い、または生成不能なものだけ」を入れる。**

- 入れる: 3D モデル（スマホモックアップ等）、多要素の複雑モーション、デザイン完成度の
  高いテロップ/サムネ構図、音源、B ロール素材
- 入れない: 単純な字幕スタイル・素朴なアニメーション（自然言語で毎回生成できるものは
  ライブラリを肥やさない）
- 数は増やしすぎない。INDEX.md ナビが成立する規模を保つ

## 構造

```
assets/                     ← 当面はローカルディレクトリ。コミュニティ化で独立リポへ昇格
  INDEX.md                  ← 背骨。カテゴリごと 1 行説明
  3d/
    INDEX.md                ← 「smartphone-mockup — 手に持てる iPhone 風。製品紹介向け」
    smartphone-mockup/
      meta.json
      fragment.html         ← 実体（Three.js + glTF 参照、authoring 規約準拠）
      model.glb
      preview.png
  motion/ …
  telop/ …
  audio/   （bgm / sfx を tags で区別）
  broll/
```

- **階層はカテゴリ → 素材の 2 段で打ち止め**（Fab がカテゴリ縮退した教訓）。
  横断軸（雰囲気・シーン種別・アスペクト）は tags に逃がす
- 1 素材 = 1 ディレクトリ。実体 + meta.json + preview.png が最小 3 点セット

## meta.json スキーマ v0

```jsonc
{
  "id": "smartphone-mockup",
  "category": "3d",                       // ディレクトリと一致（単一。複数カテゴリ禁止）
  "title": "スマホ 3D モックアップ",
  "description": "手に持てる iPhone 風モックアップ。画面に任意動画/画像を差し込める",  // 検索用
  "when_to_use": "アプリ紹介・製品デモ・UI 解説のシーン",   // AI 検索の主シグナル
  "tags": ["product-demo", "tech", "16:9", "9:16"],
  "knobs": [                              // .mogrt Essential Graphics の型システムを踏襲
    { "cssVar": "--screen-src", "type": "media", "group": "content", "label": "画面に映す動画" },
    { "cssVar": "--rotate-y", "type": "slider", "min": -45, "max": 45, "unit": "deg", "group": "pose" },
    { "cssVar": "--body-color", "type": "color", "group": "style" }
  ],
  "ai_usage": "画面テクスチャと角度・色は自由に変えてよい。ベゼル形状のジオメトリは崩さない",  // 先行例の AI Usage 節を踏襲
  "requires": ["three.js", "gltf"],
  "provenance": { "origin": "案件 xxx / 2026-07-01", "generator": null },  // 生成物なら手とプロンプト
  "author": "akari",
  "license": { "spdx": "MIT", "scope": "commercial-ok", "attribution_required": false,
               "ai_training_allowed": true },   // Fab の NoAI タグに相当する予約（市場化で必ず問われる）
  "price": null                           // 予約フィールド（null = 無料。将来のマーケットプレイス用）
}
```

- `license` / `author` / `price` は**最初から予約**（後の販売プラットフォーム化で再梱包不要に）
- `knobs.type` の語彙: `text` / `color` / `slider` / `dropdown` / `checkbox` / `media`
  （.mogrt と同じ心的モデル。世界中のモーションデザイナーが既に知っている語彙）
- `.mogrt` フォーマット自体は**採用しない**（AE ランタイム前提の専有コンテナ。実行不能）。
  型システムだけ借りる。将来「.mogrt → 本パッケージ」変換スキルの余地は残る

## 使用規律

- **コピーして使う。リンクしない**: 採用 = プロジェクトの `overlays/` へ複製 + 変数上書き。
  edit.json の自己完結（ライブラリが消えても過去案件が再現できる）を守る
- 使用時に provenance をプロジェクト側に記録（どのライブラリのどの版から来たか）

## 検索の段階計画

1. **今**: INDEX.md + grep（LLM ネイティブ。これで足りる規模を保つ）
2. **増えたら**: `catalog.json` を自動生成（Generated Wiki 層。機械フィルタ用）
3. **コミュニティ化**: 静的サイト + JSON インデックス（shadcn レジストリ同型）。
   MCP は**検索窓口としてのみ**後付け（正典は常に git リポ。Descript の
   「Don't ship your API as an MCP」の教訓）

## 収穫フライホイール（素材化スキル）

案件で作った良い成果物を、メタデータ付きパッケージにしてライブラリへ収穫する
「素材化」スキルを用意する。使うほどライブラリが肥える。これがスタイル学習の前段。

- **導出可能な値は自動抽出する**（Fab が 3D ファイルから頂点数等を自動抽出するのと同型）:
  fragment 内の CSS 変数一覧 → knobs 候補、`<script>` 依存 → requires、サイズ等は
  スキルが解析して埋め、人間/エージェントには判断が要る欄（when_use / ai_usage）だけ書かせる
- 将来の単一ファイル配布は dotLottie 方式（ZIP + manifest、仕様公開）を手本に
  `.akari-asset` として検討（今はディレクトリのまま）

## コミュニティ（将来。今は作らない）

- 投稿 = PR（git がそのまま受け皿）。品質はレビューステータス可視化 + 採用実績の自然選別

## カタログと取得スキル（2026-07-14 追記）

### 素材の3層モデル

```
① assets/   ローカル・個人ライブラリ（本書の本文）。実体をコピーして使う
② catalog/  クラウド管理のカタログ。配布するのは「メタデータ + 取得先 URL」のみ。
             バイナリそのものはホストしない
③ setup / fetch スキル  catalog/ を読み、ユーザー自身に取得元から入手させて ① へ落とす
```

- `catalog/` は `assets/` と同じ meta.json v0 契約を使う。バイナリを持たない代わりに
  `source` ブロックと `remote: true` を持つ
- 取得の実行主体は常にユーザー（またはユーザーに代わって動くエージェント）。カタログ自身は
  素材を配布・保管しない

### catalog エントリのスキーマ

meta.json v0 の必須フィールド一式に加えて、以下を持つ:

```jsonc
{
  // ...meta.json v0 の必須フィールドはそのまま...
  "remote": true,
  "source": {
    "url": "https://example.com/asset/123",       // 取得先ページ、または直接ファイル URL
    "acquisition": "direct",                        // direct | login | purchase
    "license_at_source": "CC0 1.0",                  // 取得元が明示するライセンス表記（原文ベース）
    "attribution_required": false,                   // 取得元での帰属表示要否
    "preview_url": "https://example.com/asset/123/preview.jpg"  // 任意。外部ホストのプレビュー画像
  }
}
```

- `source.acquisition` の語彙: `direct`（そのまま DL 可能）/ `login`（会員登録が要る）/
  `purchase`（購入が要る）
- `remote: true` のエントリは実体ファイル（fragment.html / preview.png / バイナリ等）を
  一切持たない。`source` ブロックが実体の代わりに立つ
- スキーマは `schemas/asset-meta.schema.json` に後方互換で追加済み。`source` / `remote` は
  任意フィールドなので、既存の `assets/` 側 meta.json は無改修で有効なまま

### catalog/ の構造

`assets/` と同型（カテゴリ→エントリの2段 + INDEX.md 背骨）:

```
catalog/
  INDEX.md              ← 背骨。カテゴリごと1行説明
  3d/
    INDEX.md
    <id>/
      meta.json          ← 実体ファイルは持たない
  font/
    INDEX.md
    <id>/
      meta.json
  ...
```

- 階層は `assets/` と揃えてカテゴリ→エントリの2段で打ち止め（同じ心的モデルで辿れることを
  優先する）
- **font カテゴリを新設する**: 特定の書体は入庫基準（「生成コストが高い、または生成不能な
  ものだけ」）に厳密に適合する。自然言語生成では特定フォントのグリフそのものは再現できない
  ため、常に取得元からの入手が前提になる。フォントはバイナリを直接同梱せず、常に
  `remote: true` として扱う（再配布ライセンスは取得元次第のため）
- category enum は `3d` / `motion` / `telop` / `audio` / `broll` / `font` に拡張する
  （後方互換。既存カテゴリの意味は変えない）

### パッケージマネージャ同型

catalog は「取得先の索引」であって「配布そのもの」ではない。Homebrew の formula や npm の
`package.json` が実体を持たず取得手順だけを記述するのと同じ型を踏襲する。各自の環境に
「取らせる」ことで、バイナリの再配布・著作権の問題を構造的に回避する。

### CC0 ファースト方針

catalog に載せる素材は、取得元のライセンスが CC0 相当（帰属表示不要・商用利用可・改変可）の
ものを優先する。帰属表示が必要な素材も載せてよいが、その場合は必ず
`source.attribution_required: true` を立てる。

### attribution_required → 将来のクレジット自動挿入

`source.attribution_required` は現時点では表示用のフラグに留まるが、将来は書き出し時の
クレジット欄（エンドロール等）へ自動挿入する仕組みへ接続する設計余地として予約する。

### remote エントリでの preview の扱い

`remote: true` のエントリは実体もサムネイルも同梱しない。かわりに `source.preview_url`
（任意フィールド）に、取得元がホストするプレビュー画像の URL を記録できる。ビューワー /
エージェントはこの URL を参照専用で表示し、AKARI Video 側では画像を保持・再配布しない。
`preview_url` を欠くエントリは `source.url` のページ自体をプレビュー代わりに開く運用でよい。

## アセットのスコープ階層（2026-07-14 追記）

素材はディレクトリなので、設定ファイルの階層探索（プロジェクト → 上位 → ユーザーグローバル）と
同じスコープモデルが成立する。層ごとに生存範囲を分ける。

| 層 | 場所 | 生存範囲 |
|---|---|---|
| `local` | `<プロジェクト>/assets/` | そのプロジェクトのみ |
| `shared` | プロジェクトから上位へ辿った各ディレクトリの `.akari-video/assets/`（2026-07-25 再裁定で維持確定） | そのディレクトリ配下の全プロジェクト（事業・組織単位。複数層可） |
| `user` | `~/.akari-video/assets/`（2026-07-25 再裁定で維持確定） | そのマシンの全プロジェクト |
| `builtin` | 本リポの `assets/` | 製品出荷デフォルト |
| `catalog` | 本リポの `catalog/`（remote） | 取得して任意の層へ入庫 |

- **検索順序**: `local` → `shared`（近い順）→ `user` → `builtin` → `catalog`。
  同一 id が複数層にあるときは**近い層が勝つ**（shadowing）
- 全層が**同じ構造**（`<category>/<id>/` + 層直下の `INDEX.md`）と同じ meta.json v0 を使う。
  `validate-asset.mjs` も層を問わず同じものを使う
- **「コピーして使う」原則は不変**: どの層から採用してもプロジェクトの `overlays/` へ複製する。
  スコープは検索範囲の話であり、層をまたぐ参照・symlink は作らない
- **harvest（素材化）は登録先の層を必ず人間に確認する**。判断の目安:
  プロジェクト固有の文言・素材が残る → `local` / 事業・チーム内で再利用 → `shared` /
  どのプロジェクトでも使う自分の定番 → `user`。`builtin` への昇格は PR 経路
  （コミュニティ化と同じ道）
- ~~ディレクトリ名 `.akari-video/` は初期案（要オーナー確認。`.akari` 等への変更余地あり）~~
  → **2026-07-25 の同日再裁定で `.akari-video` のまま確定**（末尾「ディレクトリ名の裁定」追記を参照）
- 編集後のフィードバックが入口になる: 「このテロップよかった、登録して」→ harvest スキルが
  発動し、スコープを聞いて入庫する。コーナーキャプションやサムネ構図
  （HTML 文字組テンプレ）も同様に登録できるよう、category に `thumbnail` を追加する

## ディレクトリ名の裁定（2026-07-25 追記・同日再裁定で確定）

**確定裁定（2026-07-25 再裁定）: プロジェクト外の置き場所は `~/.akari-video/` をベースに
統一する。** 初期案保留（旧「`.akari-video/` は初期案」項）はこれで解消。

経緯（同日中の 2 段裁定。訂正は追記で残す）:

1. **第一裁定（同日・撤回）**: recipe v0 が新設した `~/.akari/recipes/` と揃えるため
   「`~/.akari/` をベースに統一（user 層 `~/.akari/assets/` へ移設）」と裁定した
2. **実査による前提崩壊**: 移設タスク起票前の実測で、`~/.akari/` は**空き名前空間ではなく
   Akari-OS 系アプリの稼働中 home** と判明（`tauri-updater.key`・`apps/`・`device-link-*`・
   `secrets/`・`vaults.toml` が存在し、`device-link-settings.json` は当日更新 = 現役）。
   同居は誤削除事故・サブディレクトリ衝突・2026-07-13 の製品分離方針との矛盾を生む
3. **再裁定（確定）**: 基底は `~/.akari-video/`。**recipe v0 側が誤り**（占有を知らずに
   `~/.akari/` を新設した）であり、訂正の向きを反転する。`~/.akari/recipes/` の実体は
   未作成のため、データ移設は一切発生しない

確定事項:

- `user` 層: `~/.akari-video/assets/`（現状維持。移設なし）
- `shared` 層: 上位ディレクトリの `.akari-video/assets/`（現状維持）
- レシピ: `~/.akari-video/recipes/`（recipe v0 の `~/.akari/recipes/` を訂正）
- ドロップフォルダ既定: `~/.akari-video/audio-drop/`（`~/.config/akari-video/audio-drop`
  から変更。XDG 系ツリーも基底へ寄せる裁定は維持し、向き先のみ再裁定に追従）
- 以後のプロジェクト外置き場所（styles 等）もすべて `~/.akari-video/` 配下に置く。
  **`~/.akari/` には何も新設しない**（Akari-OS 系の領域として不可侵）

残作業（別タスク `2026-07-25-akari-home-base-alignment` で一括実施）:

1. recipe v0 のパス参照一括訂正: `docs/contract-2026-07-25-recipe-v0.md` /
   `packages/schemas/recipe.schema.json`（description・$comment）/
   `skills/edit-plan/{recipe.md, workflow.md, SKILL.md}` /
   `skills/research-plan/{SKILL.md, ideate.md}`
2. `register-drop-folder.mjs` の `dropDir` 既定値を `~/.akari-video/audio-drop/` へ
3. 射程外（現状維持）: `~/.config/akari-video/` の `credentials.env` / `voice-profiles`
   （認証情報の置き場は別論点。本裁定では動かさない）
