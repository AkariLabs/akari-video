[English](./README.md) | **日本語**

# 解説ショート（kaisetsu-short）テンプレート

3面構成（タイトル / 図解 / エンディング）の縦ショート解説動画テンプレート。
「台本 JSON を差し替えるだけで次が作れる」が合格条件。

キャラクターが口パク + 表情 + 気持ち揺れで話しながら、図解カードを段階表示していく
VOICEVOX ナレーション駆動の決定論レンダリング（ブラウザ合成 → フレームキャプチャ → mux）。

## 1コマンドでの使い方

```bash
node tools/build.mjs <projectDir>
```

- `<projectDir>/project.json` を起点に、(1) narration が無ければ VOICEVOX で合成
  (2) `timeline.json` を生成 (3) レンダー (4) QA スクショ撮影、を1コマンドで実行する
- 合成をスキップ: `--no-synthesize`（narration が既にある場合は自動でスキップされる）
- QA/レンダーのみ個別にスキップ: `--no-qa` / `--no-render`
- 別アスペクト構成: `--project project.landscape.json` のようにファイル名を明示できる

まず試すなら同梱の `sample-project/`（ダミー台本 + プレースホルダキャラ。narration 同梱の
ため VOICEVOX 不要）:

```bash
node tools/build.mjs sample-project --no-synthesize
```

個別ツール（`tools/` 配下）は単体でも呼べる:

- `synthesize.mjs <projectDir> [--only <beatId>] [--speaker <id>]` — VOICEVOX 合成
- `generate-timeline.mjs <projectDir> [--out <path>] [--project <file>]` — timeline.json 生成
- `render.mjs <projectDir> [--timeline <path>] [--out <path>] [--spotframes t1,t2,...]` — mp4 レンダー
- `qa-capture.mjs <projectDir> [--safezone] [--times t1,t2,...]` — QA スクショ（`qa/CHECKLIST.md` 参照）

## 前提

- Node.js + ffmpeg
- Puppeteer: 環境変数 `KAISETSU_PUPPETEER_PKG`（puppeteer を持つ package.json への絶対パス）
  → 無ければテンプレ設置位置から上方向に `node_modules/puppeteer` を探索（本リポ直下の
  node_modules がそのまま見つかる）
- VOICEVOX（合成する場合のみ。ローカルエンジン `http://127.0.0.1:50021`）
- ImageMagick（プレースホルダキャラを再生成する場合のみ）

## ディレクトリ構成

```
composition/index.html   固定層のテンプレシェル（個人・動画固有の直書きゼロ）
tools/                   CLI 一式（lib/ に共有ロジック）
qa/CHECKLIST.md          QA チェック全8項目の正本
channel-sample/          ダミーチャンネル資産（プレースホルダキャラ8態・手続き生成）
sample-project/          ダミー台本のサンプルプロジェクト（samples/ = 同梱サンプルレンダー。
                         out*/ はビルド出力で git 管理外）
```

## 層の切り分け

| 層 | ファイル | 変更頻度 |
|---|---|---|
| 固定（テンプレ本体） | `composition/index.html`, `tools/`, `qa/CHECKLIST.md` | テンプレ改版時のみ |
| チャンネル資産 | `<project>/channel.json` + 画像アセット | チャンネル単位 |
| 可変 | `<project>/script.json` + `<project>/project.json` | 動画ごと |

## project.json スキーマ

```jsonc
{
  "aspect": "portrait" | "landscape",   // 既定 portrait
  "fps": 30,
  "script": "./script.json",
  "channel": "./channel.json",           // 他プロジェクト/channel-sample を指してもよい
  "narrationDir": "./narration",         // <beat.id>.wav + <beat.id>.query.json を期待
  "outDir": "./out",
  "timing": { "leadIn": 0.8, "beatGap": 1.4, "tailHold": 4.5 }  // 省略可
}
```

## channel.json スキーマ

```jsonc
{
  "character": {
    "assetsDir": "./assets",             // channel.json からの相対パス
    "files": {                            // 8態のファイル名規約
      "neutral-closed": "fullbody-neutral-closed.png",
      "neutral-half": "fullbody-neutral-half.png",
      "neutral-open": "fullbody-neutral-open.png",
      "happy": "fullbody-happy.png", "sad": "fullbody-sad.png",
      "angry": "fullbody-angry.png", "surprised": "fullbody-surprised.png",
      "laugh": "fullbody-laugh.png"
    },
    "sourceSize": { "width": 1024, "height": 1536 },
    "personBBox": { "x": 0, "y": 0, "w": 0, "h": 0 }  // 8態で同一の人物シルエット bbox（ImageMagick 等の trim で実測する）
  },
  "background": { "src": "./assets/bg.png" },
  "brand": { "accent": "#..", "accentDark": "#..", "ink": "#..", "inkSoft": "#..", "line": "#.." },
  "sns": [ { "icon": "x" | "instagram" | "youtube", "caption": "@handle または誘導文言(\\nで改行)" } ]
}
```

## script.json スキーマ（要点）

```jsonc
{
  "titleCard": { "kicker": "...", "main": "1行目\\n2行目", "sub": "..." },
  "beats": [
    {
      "id": "b1", "scene": "title" | "diagram" | "ending",
      "text": "ナレーション全文（synthesize.mjs がそのまま VOICEVOX に渡す）",
      "expression_plan": [
        { "expr": "surprised", "holdCap": 1.2 },  // 既定キャップ 2.5s。反応表情の保持上限
        { "expr": "neutral" },
        { "expr": "happy", "at": { "sentence": 3, "offset": 0.5 } }  // 文アンカーで明示指定も可
      ],
      "diagram": { /* scene: "diagram" のみ。後述 */ },
      "endingReveal": { "at": { "sentence": 1 }, "dur": 0.5 },  // scene: "ending" のみ（SNS行の reveal）
      "sentenceOverride": [ { "text": "...", "t0": 12.75, "t1": 19.7 } ]  // 省略可。実測値を直接指定したい場合のみ
    }
  ]
}
```

### 文アンカー方式

段階表示・表情切替の絶対秒は直書きしない。`{"sentence": n, "offset": 0.1}` で
「ビート内の第 n 文（0始まり）の発話開始 + offset 秒」を宣言し、`generate-timeline.mjs` が
narration 実測（VOICEVOX audio_query のモーラ時刻から求めた文境界）から絶対秒へ解決する。

文分割は既定で `text` から自動導出される（決定論的アルゴリズム。`tools/lib/sentences.mjs`）。
実測タイムスタンプを直接使いたい場合は `sentenceOverride` で上書きできる。

### diagram スキーマ（図解コンポーネント語彙）

```jsonc
"diagram": {
  "align": "start" | "center",          // .dg の justify-content。既定 start
  "gap": 22,                             // .dg-stack の gap px。省略時 CSS 既定 22
  "stackTop": 0,                         // .dg-stack の top px 上書き（省略時 CSS 既定 100）
  "eyebrow": { "text": "...", "reveal": { "at": {...}, "dur": 0.4 } },
  "blocks": [ Block, ... ],              // layout "stack"（既定）
  // または crossfade レイアウト（2グループ限定で動作確認済み）:
  "groups": [ { "id": "g1", "blocks": [Block,...] }, { "id": "g2", "blocks": [Block,...] } ],
  "crossfade": { "at": {...}, "dur": 0.5 }
}
```

Block 共通フィールド: `id`, `type`, `reveal?: {at, dur}`, `fadeOut?: {at, dur}`,
`collapseWhenHidden?: bool`（true で display none/on 切替・false で visibility 切替）,
`display?: string`（collapseWhenHidden 時の表示値）, `preRevealOpacity?: number`
（reveal 前の最低不透明度。「本 reveal の前から薄く予告表示しておく」用途）。

型ごとの語彙（詳細は `tools/lib/diagram.mjs`）:

| type | 固有フィールド |
|---|---|
| `eyebrow` | `text` |
| `tier-ladder` | `rows: [{variant: "small"\|"medium"\|"large"\|"highlight", text, tag?, reveal?, preRevealOpacity?}]`（variant は段階サイズの汎用語彙。`tag` は `highlight` 行のみ対応） |
| `date-badge` / `dg-note` / `view-badge` / `disclaimer` | `text` |
| `note-strip` | `text`, `position?: "flow" \| "absolute-bottom"` |
| `shot-card` | `frames: [{src, width, height, at?}]`（frames[0] が既定・以降は swap） |
| `mini-timeline` | `nodes: [{label, state: "neutral"\|"bad"\|"good"}]` |
| `big-emph` | `texts: [{text, at?}]`（texts[0] が既定・以降はテキスト swap） |
| `vs-card` | `left:{title,desc,variant}`, `right:{...}`, `bridge` |
| `cond-row` | `tag:{text,variant}`, `desc` |
| `bullet-row` | `text`, `mark?`（既定 "✓"） |

画像 `src` は script.json からの相対パスでよい（`generate-timeline.mjs` が project dir 基準の
絶対 `file://` URL に解決し、preload リストも自動構築する）。

## レイアウトプロファイル

`tools/lib/layout-profiles.mjs` に `portrait`（1080×1920）/ `landscape`（1920×1080）の2種を
定義。landscape は現時点でジオメトリの器 + 16:9 スモーク実証まで（デザイン調整は今後の実走で）。

## 決定論契約

`composition/index.html` は `window.__TIMELINE_DATA__`（generate-timeline.mjs が生成した
timeline.json）を注入されて初めて動く。`window.akariSetTime(t)` は t の純関数、
`window.__akariReady` で preload 完了を待ち、`window.akariSetSafeZoneGuide(bool)` は
QA 専用（レンダー経路からは呼ばれない）。レンダーは JPEG フレーム + 200フレーム毎の
ページ再生成 + mux 分離（中断してもフレーム資産は既定で温存され、mux だけ再実行できる）。

## クレジット

- `sample-project/narration/` の音声は VOICEVOX で合成したものです — **VOICEVOX:玄野武宏**
  （再合成・差し替えの際は使用キャラクターの利用規約に従いクレジットを表記してください）
- プレースホルダキャラクター画像は ImageMagick による手続き生成（`channel-sample/generate-placeholder.mjs`）
