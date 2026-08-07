# 演出レシピ v0 契約（presets/direction/ 参照表 + 展開ツール）

- 日付: 2026-08-06
- 状態: **draft**（実装と並走で approved 化）。本書は技術仕様のみ
- 前提: `docs/contract-2026-07-22-render-basics.md`（画角操作 / フリーズ / トランジション / LUT の実装契約）、
  `docs/contract-2026-08-05-fx-v0.md`（画面 FX 小語彙）、`packages/schemas/edit.schema.json`
  （`cutV0`/`cutV1`/`cutFx`/`cutFraming`/`cutFreeze`/`transitionOut`/`emphasisWordItem`）
- 大原則: **done = 出力ファイルに現れる**。全レシピ、実レンダリングでの機械検証・目視を受け入れ条件とする

## 0. スコープ宣言

単体の脚（LUT・画面 FX・画角操作・フリーズ・トランジション・文字モーション・語レベル強調・SE 意味語彙）を
**組み合わせた named 演出レシピ**を `presets/direction/` に参照表として収め、既存 `edit.json` へ
機械展開する `packages/direction/bin/expand-direction.mjs` を新設する。「FX 単体は演出ではない。
字幕・音と組み合わせて初めて演出になる」（オーナーレビュー 2026-08-06）への回答。

**やらないこと**:
- 新規の見た目定義（LUT・FX・テロップテンプレート・文字モーション）は作らない。レシピは
  既存プリセット id の参照合成のみ
- `packages/render-cut` / `packages/schemas` / 他 `presets/*` の実装変更はしない（読み取りのみ）
- telop プリセット（`presets/telop/`）の bake 実行はしない（§3-5 参照）

## 1. 前提の裁定（オーナー確定・本書では変更しない）

- **音 = 無料公開の AKARI Sounds を参照**。レシピは `se_meaning`（意味語彙）+
  `se_default`（推奨トラック id）を持つが、実ファイルは同梱しない
- **字幕見た目 = 有料演出パックに同梱できる前提**で自由に参照してよい
- **素材フォールバック**: 参照素材（AKARI Sounds 未取得・telop テンプレ未 bake 等）が
  未導入・未対応でも展開は壊れず、単純な字幕表示 / SE 省略へ落ちる
- **レシピは既存プリセット id の参照合成のみ**。レシピ内に見た目定義を複製しない（drift 防止）

## 2. レシピ schema

`presets/direction/index.jsonl` に 1 レシピ 1 行（`presets/luts/` `presets/fx/` `presets/telop/` と
同じ参照表方式。id が引くテンプレート本体は持たない — レシピ自体が「参照の束」であり、
実体を追加で持つ必要が無いため `<id>/` サブディレクトリは作らない）。

```jsonc
{
  "id": "neg-mono-popout",              // kebab-case。カテゴリ prefix（neg- / pos- / anger- / hype- / surprise- / emergency- / normal-）
  "label": "白黒＋飛び出し",              // 日本語・参照元（カズマル ネガ16 / ビジネス16）の命名流儀を踏襲
  "category": "negative",               // negative | positive | anger-hype | surprise-emergency | normal
  "layers": {
    "look":   { "lut": "mono", "intensity": 1 },              // 省略可。lut は presets/luts/ の id 参照
    "fx":     [{ "id": "noise", "intensity": 0.6, "params": {} }], // 省略可。id は presets/fx/ の 5 id 参照（配列順=適用順）
    "transition_in": { "type": "dissolve", "duration": 0.5 }, // 省略可。展開時は「対象カットの1つ前」の transition_out に写像（§3-3）
    "framing": { "crop": {...} } | { "keyframes": [...] },    // 省略可。cutFraming と同一語彙（値そのもの。参照 id は無い — §2-1）
    "freeze":  { "at_sec": 1.4, "duration_sec": 1.0 },         // 省略可。cutFreeze と同一語彙
    "person_matte": {                                            // 省略可。人物切り抜き
      "quality": "accurate",                                    // person-matte.mjs の quality
      "decode_width": 1280                                      // person-matte.mjs の decode-width
    },
    "text": {
      "style_hint": "one-char-bang",    // 省略可。emphasisWordItem.style_hint と同一語彙（§2-2）
      "anim_in":    "zoom-pop",         // 省略可。presets/textanim の id（slot=in）
      "anim_out":   "zoom-pop",         // 省略可。省略時は anim_in と同じ id（captions.mjs が animation-direction:reverse で表現）
      "anim_loop":  "float",            // 省略可。presets/textanim の id（slot=loop）
      "telop_preset": "ref3_mincho_flash" // 省略可・v0 では未展開（§3-5）。将来の有償パック向け参照のみ
    },
    "audio": {
      "se_meaning": "強調・登場",         // MEANING_VOCABULARY（sfx-suggest.mjs）14 語のいずれか、または null
      "se_default": "sfx-pop-ding",     // 省略可。MEANING_RULES[se_meaning].first に含まれる id、または null
      "se_loop": null,                  // v0 は常に null（語彙未拡張。内部ノート §7-2「唯一の語彙ギャップ」）
      "bgm_change": null                // v0 は常に null
    }
  },
  "use_when": { "beats": [...], "tone": [...], "strength_min": 0.6 }, // beats/tone は presets/telop/index.jsonl の use_when 語彙と同一集合
  "requires": ["fx:invert — ..."],      // 省略可。未実装レイヤー依存の宣言。存在する行は展開対象外（§4）
  "note": "..."                         // 省略可。設計判断・参照元の注記（機械検証の対象外）
}
```

### 2-1. なぜ `framing` / `freeze` / `transition_in` は「値そのもの」で `look` / `fx` は「id 参照」なのか

「参照合成のみ・見た目定義の複製禁止」は **id で引く参照表を持つレイヤー**（LUT・FX・
テロップ・文字モーション・強調スタイル・SE 意味）にのみ適用される。画角操作
（`cuts[].framing`）・フリーズ（`cuts[].freeze`）・トランジション（`cuts[].transition_out`）は
そもそも参照表を持たない **生パラメータ契約**（`edit.schema.json` の `cutFraming`/`cutFreeze`/
`transitionOut` が直接そのオブジェクト構造を定義している。`output.look.intensity` が数値をそのまま
持つのと同じ扱い）。したがってレシピがこれらの値を直接書くことは「見た目定義の複製」には
当たらない。複製禁止が指すのは「LUT の色補正レシピ数値をレシピ側に再定義する」
「FX のフィルタグラフをレシピ側に書く」といった、既存 id の中身をレシピにコピーする行為である。

### 2-2. `text.style_hint` は `emphasis_words[].style_hint` と完全一致させる

タスク契約の当初素描（内部ノート `notes-2026-08-05-direction-recipe-pack.md` §7-3）は
`style_hint` と `emphasis_style` を別フィールドとして書いていたが、実装（`captions.mjs`）を
確認した結果、ランタイムが読むのは `emphasisWordItem.style_hint` 1 フィールドのみ
（`SUPPORTED_EMPHASIS_STYLES.has(emphasis.style_hint)` で直接判定）。2 フィールドに分けると
展開時にどちらが正かの drift 源になるため、実装知見により 1 フィールド
（`text.style_hint`）へ統合した（task.md 「フィールドの最終形は実装知見で調整可」の範囲内の調整）。

`text.style_hint` に使える値（`packages/render-cut/src/captions.mjs` の
`SUPPORTED_EMPHASIS_STYLES`。同ファイルは読み取り専用のため本書に転記し、
L0 テストで実ソースとの整合を検査する — §5-1）:

`one-char-bang` / `one-char-jumble` / `size-pulse` / `color-accent` / `color-only` /
`outline-bold` / `danger` / `positive` / `highlight`

### 2-3. `text.telop_preset` は v0 では未展開

`presets/telop/` の ATF テンプレートは `bake-layer` CLI による事前 bake（alpha 付き mov 生成）が
要る別パイプラインであり、本タスクの「現行レンダで実際に焼ける経路」（captions レール）より
重い。v0 の `expand-direction` は `text.telop_preset` を**読み捨てる**（patch には含めない）。
将来、有償演出パックが telop テンプレートを同梱する形で実装する際の参照フィールドとして
schema にのみ先置きしている。v0 の全レシピはこのフィールドを未設定のまま登録した
（§6 未展開フィールドの一覧に明記）。

## 3. 展開ツール（`packages/direction/bin/expand-direction.mjs`）

### 3-1. 入出力

```
node bin/expand-direction.mjs <recipe-id> --cut <index> [options]
```

| オプション | 意味 |
|---|---|
| `--cut <n>` | 展開対象カットの index（`edit.json` の `cuts[n]`）。必須 |
| `--lead-cut <n>` | `transition_in` を持つレシピで、遷移元カットの index を明示指定（省略時 `n-1`） |
| `--text <string>` | 画面に出す文言（感情語等）。省略時は文字レイヤーを展開しない |
| `--project <dir>` | 適用先プロジェクトルート（`edit.json` / `captions.json` を読み書き）。省略時は patch を stdout に JSON 出力するだけで書き込みは行わない（`--dry-run` 相当が既定） |
| `--audio-root <dir>` | AKARI Sounds 探索ルート（既定 `~/.akari/assets/audio`） |
| `--recipes <path>` | `index.jsonl` の場所（既定 `presets/direction/index.jsonl` をリポルートから解決） |
| `--cut-speed <n>` | `--project` 省略時の `cuts[].speed`（人物マット patch の確認用） |
| `--source <path>` | `--project` 省略時の対象 cut ソースパス（人物マット patch の確認用） |
| `--fps <n>` | `--project` 省略時のマット fps（人物マット patch の確認用） |

### 3-2. 決定論とコア関数の分離

`buildDirectionPatch({ recipe, cutIndex, leadCutIndex, text, cutDurationSec })` は
**純関数**（ファイル I/O をしない）。同一引数なら常にバイト等価な patch オブジェクトを返す。
CLI 層（`bin/expand-direction.mjs`）だけがレシピ読み込み・AKARI Sounds カタログ探索・
`edit.json`/`captions.json` の読み書き・SFX ファイルコピーという副作用を持つ。決定論テスト
（L0）はコア関数を直接呼び、環境（ホームディレクトリの有無等）に依存しない形で検証する。

`framing.keyframes` の `t` は index.jsonl 上ではレシピ作成時の参考カット尺
（3.2 秒基準）で書かれている。展開時は `cutDurationSec /（参考尺）` の比でスケールし、
実際のカット尺に合わせる（参考尺と実カット尺が違っても破綻しないため）。

### 3-3. `transition_in` の展開規則

`edit.schema.json` の `cutV0`/`cutV1` に `transition_in` フィールドは無く、`transition_out`
（そのカットから次のカットへの遷移）のみが存在する。レシピの `transition_in` は
「このカットへ入ってくる遷移」を意味する概念であるため、展開時は **1 つ前のカット
（既定 `cut-index - 1`、`--lead-cut` で明示上書き可）の `transition_out`** に写像する。

- 対象カットが `--cut 0`（先頭）で `--lead-cut` も未指定の場合、書き込み先が無いため
  **transition_in 部分は展開せず notes に記録して非致命的にスキップする**（silent drop
  ではなく、patch の `notes[]` に理由を残す。他の脚（fx/text/audio 等）は通常どおり展開する）

### 3-4. SFX 解決

1. `--audio-root` 配下 `akari-sounds-*/.origin-catalog.json`（存在すれば）を読み、
   `se_default` を id で検索する
2. 見つかった場合: トラックの `kind` と `files[0].mp3` からソースパスを組み立て、
   `<project>/assets/sfx/<id>.mp3` へコピーし、`audio.sfx[]` へ
   `{ path: "assets/sfx/<id>.mp3", t: <カット開始タイムライン秒 + 0.15>, gain_db: 0 }` を追加する
3. 見つからない場合（未導入・カタログに無い・`se_default` が null）: `audio.sfx[]` へは
   何も追加せず、`notes[]` に `se_meaning` を注記する（**前提の裁定どおり壊れない**）

### 3-5. 文字レイヤーの展開（captions レール）

`--text` 指定時のみ展開する。対象は `<project>/captions.json`（無ければ新規作成）:

- `captions[]` へ 1 エントリ追加: `{ id, start, end, text, words: [{ start, end, text }] }`。
  `start`/`end` は対象カットの `in`/`out`（**ソース秒**。v0 edit の `cuts[].in/out` は
  ソース秒であり、単一 `source` を前提とする v0 では captions の時刻もソース秒で揃える）
- `default_text_style.animation` に `{ in: { id: anim_in }, out: { id: anim_out ?? anim_in }, loop: { id: anim_loop } }`
  をマージ（既存の `default_text_style` があれば非破壊マージ）
- `emphasis_words[]`（`edit.json` 側）へ `{ id, t_start: start, t_end: end, word: text, emotion: <category から導出>, style_hint }`
  を追加。`style_hint` 未設定のレシピは `emotion` だけを付け、captions.mjs 側の既定マッピング
  （pain/surprise/anger→one-char-bang、disgust→one-char-jumble、joy/emphasis→size-pulse、
  他→color-accent）に委ねる（**これが「素材未導入は単純字幕フォールバック」の実体** —
  style_hint が無くても captions レールは常に何らかの表示に落ちる）
- `category` → `emotion` の対応: `negative`→`pain`、`anger-hype`→`anger`、
  `surprise-emergency`→`surprise`、`positive`→`joy`、`normal`→`emphasis`
- v0 edit（`source` 単数）では `emphasisWordItem.src` を設定しない
  （`edit.schema.json` の $comment 「v0: src 自体を使用できない」に従う）

### 3-6. `requires` を持つレシピ

`expand-direction` は `requires` フィールドを持つレシピの展開を**拒否する**（非 0 終了・
明示エラーメッセージ）。silent drop を避ける契約上の判断（fx-v0 契約 §「大原則」と同じ規律）。

### 3-7. `person_matte` の展開と生成前提

`layers.person_matte` を持つレシピは、対象 cut に対して次を patch へ出力する。

- `layers_patch`: `{ id: "person-<cut index>", t, duration, kind: "video",
  src: "assets/matte/person-<cut index>.mov", track }`。最終素材は ProRes 4444 alpha。
  変換時は `-pix_fmt yuva444p10le` を要求し、ffmpeg 8.1.1 の実出力は `ffprobe` 上
  `yuva444p12le` となる（alpha plane は保持）。`t` は対象 cut の出力タイムライン開始秒、
  `duration` は `(cut.out - cut.in) / (cut.speed ?? 1)`。対象 cut に `transform` があれば継承する。
  CLI はこれを既存 `edit.layers[]` の末尾へ追記する
- `timeline_tracks_patch`: 既存 layer の最大 track + 1 を人物専用 track とし、下→上を表す
  `timeline.tracks[]` の末尾へ `{ kind: "layers", ref: <人物 track> }` を明示する。
  既存の `timeline.tracks` 宣言は保持する
- `matte_prerequisite`: `execution: "prerequisite_only"` の構造化前提。`steps[]` は実行順を持ち、
  第 1 step が ffmpeg で対象ソース区間へ **`setpts=PTS/<speed>` を適用し、出力 fps と
  `(out-in)/speed` の `-t` でフレーム境界を固定した一時 MP4** を作り、
  第 2 step が `skills/analyze-footage/bin/person-matte/person-matte.mjs` にその一時 MP4 を渡して
  中間生成物 `assets/matte/person-<cut index>.webm` を作る。第 3 step は ffmpeg の入力デコーダに
  `libvpx-vp9` を明示し、`assets/matte/person-<cut index>.mov`（ProRes 4444 alpha）へ変換する。
  引数は shell 文字列ではなく `args[]` として保持し、生成器が同じ順序を機械的に再現できる

速度をマット生成後に適用すると下地 cut と人物レイヤーのフレーム数がずれるため、順序は
**速度適用済み一時 clip → person-matte → ProRes 4444 alpha MOV 変換**で固定する。
`expand-direction` 自身はこの steps を実行しない。
人物マットは実時間の数倍を要するため、パッチ生成と重い素材生成を分離する。

person-matte の VP9 alpha WebM は `alpha_mode=1` を持つ一方、現行 render-cut が使う ffmpeg 8.1.1 の
既定 VP9 入力デコーダでは alpha plane が展開されず、直接参照すると透明部分が黒になることを実測した。
render-cut は本変更のファイル境界外なので、前提手順内で `libvpx-vp9` を明示して alpha を decode し、
ドッグフード実績と同じ ProRes 4444 alpha MOV へ変換して吸収する。

z 順は `deriveTracks` の全体既定を変更せず、レシピ展開が人物専用 track を最上位として明示する。
加えて人物レイヤーを `layers[]` 末尾へ追加するため、同一配列内のマスク等に対しては後着の人物が
確実に上へ来る。一方、現行 render-cut の HTML `overlays[]` は layer stack 後の別 composite stage で
常に最終合成されるため、`timeline.tracks` の非既定順でも人物より下へ移せない。ここで保証する
「overlays より上」は編集レール上の宣言であり、実レンダで保証できるのは `layers[]` 内のマスク等に
対する順序である。HTML overlay 自体を人物の背後へ置くには render-cut 側の別契約変更が必要で、
本レシピはそれを暗黙に約束しない。

## 4. `requires` の運用と実測での訂正（2026-08-06）

内部ノート `notes-2026-08-05-direction-recipe-pack.md` §6-4 はネガティブ16の `requires` 対象を
「カラーマット黒・演者切り抜き」の 2 件と見込んでいた。その後の実装・実測で以下の訂正を行った:

- **カラーマット黒は実働扱いにした**: `color-overlay(color:"black", intensity:1)` は
  `blend=all_opacity=1` で元映像を 100% 単色に置き換える（fx-v0 契約 §1 の定義どおり）。
  これは黒背景 + テキスト単独画面と画素として同じ結果になるため、新しいレイヤー機構を
  待たずに既存 fx で表現できる。実レンダで黒一色 + テキストの構図になることを確認した
  （§7 検証ログ参照）
- **色調反転（#3）は requires に回した**: fx v0 5 語彙（noise/particles/vignette/flare/
  color-overlay）にネガ反転（色反転）を作る id が無い。`vignette` の white モード内部実装が
  `negate,vignette,negate` を使っているが、これは fx.mjs 内部のトリックであり公開 id ではない
- **演者切り抜き（#10）は実働扱いにした**: macOS Vision の person-matte 生成と render-cut の
  ProRes 4444 alpha MOV 合成をカット単位で配線した。速度変更 cut は `setpts` を先に適用して
  尺を一致させ、person-matte の VP9 alpha WebM は `libvpx-vp9` で decode して MOV へ変換する
- 結果としてネガティブの実働数は **15/16**、全 34 レシピでは **展開対象 33 + requires 1**。
  `requires` 対象は {色調反転} だけである

## 5. 検証（受け入れ条件）

### 5-1. L0

- `presets/direction/index.jsonl` の全レシピについて、`layers.look.lut` は
  `presets/luts/index.jsonl` の id、`layers.fx[].id` は `presets/fx/index.jsonl` の id
  （= `FX_IDS`）、`layers.text.anim_in`/`anim_out` は `presets/textanim/index.jsonl` の
  `slot:"in"` id、`layers.text.anim_loop` は `slot:"loop"` id、`layers.text.style_hint` は
  `packages/render-cut/src/captions.mjs` の `SUPPORTED_EMPHASIS_STYLES`（ソースを読み取り正規表現で
  抽出し本契約 §2-2 の一覧との整合を検査）、`layers.audio.se_meaning` は
  `packages/audio-library-setup/shared/sfx-suggest.mjs` の `MEANING_VOCABULARY`、
  `layers.audio.se_default` は同ファイル `MEANING_RULES[se_meaning].first` のいずれかに
  それぞれ解決することを機械検査する
- `use_when.beats`/`use_when.tone` が `presets/telop/index.jsonl` から動的に集めた語彙集合の
  部分集合であることを検査する
- `requires` を持つレシピの `id` 集合が `{neg-color-invert}` であることを固定値検査する
- `neg-person-cutout` が `layers_patch`・`timeline_tracks_patch`・速度適用を先行する
  `matte_prerequisite.steps[]` を決定論的に出すことを検査する
- `expand-direction` のユニットテスト（決定論 = 同一引数で `buildDirectionPatch` の
  `JSON.stringify` がバイト等価）が緑
- `node --check` を `packages/direction/**/*.mjs` 全対象に通す

### 5-2. L1

- 展開対象 33 レシピ全本について、実プロジェクトへ `expand-direction --apply` した
  `edit.json`/`captions.json` が `packages/schemas/bin/validate-edit.mjs` を PASS すること
- 同プロジェクトを `packages/render-cut/bin/render-cut.mjs` で実レンダし、`.akari/render.json`
  の `verify` が PASS（尺一致含む）であること
- `gallery.html` が実ファイルパスで動画を再生でき、レシピ名・カテゴリ・レイヤー構成
  （JSON 抜粋）が表示されること

## 6. 既知の残作業・スコープ外

- `text.telop_preset` は schema にのみ存在し、`expand-direction` は未展開（§2-3）
- `se_loop`（ループ環境音）・`bgm_change`（BGM 変化ヒント）は v0 で常に `null`
  （内部ノート §7-2 の語彙ギャップ。MEANING_RULES v1 改訂待ち）
- D1（見せ場同期）/ D5（文脈適合選択）からの自動発火結線は本タスクの対象外
  （`use_when` を機械が読む形で用意するところまで）
- `packages/edit-lint` への `direction` 意味検証の追加は本タスクの対象外
  （検証は `packages/schemas/bin/validate-edit.mjs` の既存 `cuts[].fx`/`framing`/`freeze`/
  `transition_out`/`emphasis_words` 検証に委ねる）
