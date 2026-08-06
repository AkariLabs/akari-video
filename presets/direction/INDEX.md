# 演出レシピ プリセット（v0）

`edit.json` の複数レイヤー（LUT・画面 FX・画角操作・フリーズ・トランジション・文字モーション・
語レベル強調・SE 意味語彙）を**組み合わせた named 演出**の参照表です。「FX 単体は演出ではない。
字幕・音と組み合わせて初めて演出になる」（オーナーレビュー 2026-08-06）への回答として、
`presets/luts/` `presets/fx/` `presets/telop/` と同じ参照表方式（`index.jsonl`）で作りました。

技術仕様の正本は [`docs/contract-2026-08-06-direction-recipes-v0.md`](../../docs/contract-2026-08-06-direction-recipes-v0.md)
です。レシピの展開（既存 `edit.json` への機械的な追記パッチ生成）は
[`packages/direction/`](../../packages/direction/) が行います。

## 構造

```
presets/direction/
  index.jsonl   # 1 レシピ 1 行。id・label・category・layers・use_when・requires?・note? を持つ
  INDEX.md      # this file
```

レシピは「参照の束」であり、テロップ / LUT のように bake する実体を追加で持たないため
`<id>/` サブディレクトリはありません。

## レシピ schema（要約）

```jsonc
{
  "id": "neg-mono-popout", "label": "白黒＋飛び出し", "category": "negative",
  "layers": {
    "look":   { "lut": "...", "intensity": 1 },        // presets/luts/ の id 参照
    "fx":     [{ "id": "...", "intensity": 1 }],        // presets/fx/ の id 参照（配列=適用順）
    "transition_in": { "type": "dissolve", "duration": 0.5 }, // 1つ前のカットの transition_out に展開
    "framing": { "crop": {...} } | { "keyframes": [...] },     // cutFraming と同一語彙（生値）
    "freeze":  { "at_sec": 0, "duration_sec": 0 },              // cutFreeze と同一語彙（生値）
    "text":   { "style_hint": "...", "anim_in": "...", "anim_out": "...", "anim_loop": "..." },
    "audio":  { "se_meaning": "...", "se_default": "...", "se_loop": null, "bgm_change": null }
  },
  "use_when": { "beats": [...], "tone": [...], "strength_min": 0.6 },
  "requires": ["未実装レイヤー … "],  // あれば展開対象外（登録のみ）
  "note": "設計判断の注記（機械検証対象外）"
}
```

全フィールドの意味・「参照 id」と「生値」の使い分け・`transition_in` の展開規則は契約書
§2〜3 を参照してください。

## 一覧（34 本・展開対象 32 + requires のみ 2）

### ネガティブ（16 本・カズマル「ネガティブ演出16選」完コピ・展開対象 14）

| id | label | 備考 |
|---|---|---|
| `neg-fade-red` | フェード赤 | color-overlay(red) |
| `neg-noise` | ノイズ | fx noise |
| `neg-color-invert` | 色調反転 | **requires**（fx v0 に色反転 id が無い） |
| `neg-blue-tone` | 青色調 | LUT cool-clear |
| `neg-crop` | クロップ | framing.crop |
| `neg-mono-popout` | 白黒＋飛び出し | LUT mono + one-char-bang |
| `neg-dissolve` | クロスディゾルブ | transition_in: dissolve |
| `neg-mono-freeze` | 白黒＋動画停止 | LUT mono + freeze |
| `neg-mono-shrink` | 白黒＋画角縮小 | LUT mono + framing.keyframes（2 点） |
| `neg-person-cutout` | 演者切り抜き | **requires**（person_matte 未実装） |
| `neg-onechar` | 一文字ずつ | one-char-bang |
| `neg-color-matte-black` | カラーマット黒 | color-overlay(black, intensity=1) — §「requires の運用」参照 |
| `neg-mono-crop` | 白黒＋クロップ | LUT mono + framing.crop |
| `neg-mono-zoomin` | 白黒＋アップ | LUT mono + framing.keyframes（強めズーム） |
| `neg-fade-in` | フェードイン | transition_in: fade-black |
| `neg-shrink-shrink` | 縮小⇨縮小 | framing.keyframes（3 点・段階縮小） |

### ポジティブ（幸せ・キラキラ・5 本）

| id | label |
|---|---|
| `pos-gold-sparkle` | ゴールド煌めき |
| `pos-warm-glow` | 暖色ふわっと |
| `pos-bounce-pop` | バウンド強調 |
| `pos-white-vignette-cheer` | 白ビネット祝福 |
| `pos-hormozi-punch` | ハイライト断言 |

### 怒り・熱血（5 本）

| id | label |
|---|---|
| `anger-red-flash` | 赤フラッシュ怒り |
| `anger-glitch-shout` | グリッチ叫び |
| `hype-riser-zoomin` | 熱血ズームアップ |
| `hype-particles-burn` | 燃えたぎる粒子（単独カット限定 — 既知の罠） |
| `anger-shake-onechar` | 震え一文字 |

### 驚き・緊急（5 本）

| id | label |
|---|---|
| `surprise-flash-white-vignette` | 白閃光驚き |
| `surprise-jitter-jumble` | ジャンブル動揺 |
| `emergency-red-overlay-freeze` | 緊急停止 |
| `surprise-zoom-snap` | 驚き瞬間ズーム |
| `emergency-noise-flare` | 緊急ノイズ警告 |

### ノーマル（説明系・3 本）

| id | label |
|---|---|
| `normal-chapter-turn` | 章転換ディゾルブ |
| `normal-caption-standard` | 標準字幕（単純字幕フォールバックの見本） |
| `normal-cutaway-click` | カット送りクリック |

## requires の運用

`requires` を持つレシピは登録のみ（展開対象外）。`expand-direction` はこれらの展開を拒否します
（silent drop を避ける契約上の判断）。内部ノートの当初見込み（カラーマット黒・演者切り抜き）から
1 件入れ替わっている経緯は契約書 §4 を参照してください（カラーマット黒は fx v0 の
`color-overlay` で実働化・代わりに色調反転が requires に回った）。

## 展開ツール

```sh
node packages/direction/bin/expand-direction.mjs <recipe-id> --cut <index> \
  --project <project-dir> --text "もう無理"
```

詳細は [`packages/direction/README.md`](../../packages/direction/README.md) と契約書 §3。

## 実レンダサンプル

各レシピは実映像での展開レンダ（verify pass）まで確認済み。サンプル動画は本リポには
同梱しない — `expand-direction` を手元のプロジェクトに適用すれば同じものが再現できる。
