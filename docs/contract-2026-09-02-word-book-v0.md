# word book v0（単語帳 — 文字起こしの語彙補正と字幕語彙の規範）契約

- 日付: 2026-09-02
- 状態: **ドラフト・要オーナーレビュー**（データ契約の新設・プロジェクト外置き場所の新設・
  文字起こしパイプラインへの前処理追加を含むため、全編オーナー裁定事項。本書はレビュー前提の起草）
- 前提: `contract-2026-07-17-data-contract-versioning.md`（三原則の正本）、
  `contract-2026-07-25-memory-connection-v0.md`（姉妹契約。§9 が「系統 B = スタイルプロファイルは
  性質が異なる別契約として起草する」と本書の席を予約している。本書はその**最初の実装対象**）、
  `contract-2026-08-02-creator-root-v1.md`（作業場。§7 で「ユーザーの内容物は隠しディレクトリに
  置かず作業場の `.akari/memory/` に置く」と裁定済み — 本書の置き場所はこれに従う）、
  `contract-2026-07-13-asset-library.md`（4 層スコープ・shadowing の先例）、
  `contract-2026-09-02-transcript-unrecognized-spans-v0.md`（analysis.json → captions.json の
  パイプラインに席を足した直前の先例）、
  `contract-2026-08-03-caption-display-encoding-qc-v1.md`（`display_policy` の現行形）
- 発端: オーナー対話（2026-09-02）。要旨: 文字起こしの固有名詞誤認識を毎回手で直している／
  「一度直したら以後は自動で直る」単語帳がほしい／管理単位は語彙項目（置換ペアではない）／
  人の手直しには触らない／読み仮名（TTS）と NG 語は同じ器に入るが v0 では後回し。
  内部裁定の全文脈は内部リポ（akari-video-internal）の memory-and-style 契約 §2・§4 を正本とする
- スコープ: 単語帳ファイル（スキーマ・置き場所・層解決）、STT 直後の語単位プリパス、既存
  captions.json への再適用、edit-lint 規則、字幕行分割の `protected_terms` への供給、台本パネル
  「覚える」導線の規約。**TTS 読み仮名の消費・NG 語 lint・STT への初期プロンプト・読みでの一致・
  学習ループ・凍結スナップショットは扱わない**（§9）

## 0. 位置づけ — 置換テーブルではなく語彙項目、学習ではなく承認の蓄積

本契約は「AI が表記ゆれを学習する」仕組みではない。**人間が一度承認した語彙項目（正しい表記 +
誤認識の形 + 読み + 種別）を層別のファイルに蓄積し、決まった瞬間（§4）に決定論的に当てるだけ**の
ファイル契約 + スキル規律である。

- 1 件 = **語彙項目**（`surface` を正とし、`variants[]` に誤認識・ゆれの形を束ねる）。
  「誤 → 正」の置換ペアの列ではない。読み・種別・行分割保護は語彙項目の属性として同じ 1 件に載る
- 消費は 4 出口: ① 文字起こし直後の**語単位**プリパス ② edit-lint の機械検査 ③ 字幕行分割の
  `break_hints.protected_terms` への供給 ④ TTS 読み仮名（v0.1・§9）
- **人の手直しは触らない**。`captionRecord.edited: true` の行には再適用しない（§3-5）
- **部分文字列で当てない**。一致は `words[]` 上の語境界（無ければ `Intl.Segmenter` の語境界）に
  限る（§3-2）
- 内部契約で「スタイル学習」と呼ぶ差別化要素の最初の実装であるが、v0 は**承認済み項目の蓄積と
  適用のみ**を持つ。「同じ直しを 2 回したら提案する」学習ループは次段（§9）

版管理三原則（`contract-2026-07-17` §2）を新設契約として初版から適用する:

- トップレベル `version` は**整数・0 起算**
- 進化は**追加のみ**。読み手は**寛容リーダー**（entry の未知フィールドは保持する。validator は
  未知キーを `info` で知らせるだけで拒否しない。§5）
- 既知より大きい `version` を見た読み手は推測変換せず **read-only で正直に停止する**
  （`validate-word-book.mjs` 実装。消費側はそのファイルを「無いもの」として扱い warning を出す。§5）
- フィールド命名は **snake_case**

## 1. 確定スキーマ

正本: `packages/schemas/word-book.schema.json`（`$id: urn:akari-video:schema:word-book:v0`）。
実例: `packages/schemas/examples/word-book-v0-valid/word-book.json`。

```jsonc
{
  "version": 0,
  "entries": [
    {
      "surface": "AKARI Video",
      "variants": ["あかりビデオ", "アカリビデオ", "灯りビデオ", "明かり ビデオ"],
      "reading": "アカリビデオ",
      "kind": "term",
      "protect_break": true,
      "source": "daihon-panel",
      "added_at": "2026-09-02T10:00:00.000Z",
      "hits": 0
    },
    {
      "surface": "動画",
      "variants": ["ムービー"],
      "kind": "notation",
      "source": "manual"
    },
    {
      "surface": "KYO工房",
      "reading": "キョウコウボウ",
      "kind": "reading-only",
      "protect_break": true
    }
  ]
}
```

### フィールド表

| フィールド | 型 | 必須 | 単位・備考 |
|---|---|---|---|
| `version` | integer (const 0) | 要 | — |
| `entries[]` | array | 要（空配列可） | 語彙項目の列。順序は意味を持たない（一致の優先は §3-3 の規則で決まる） |
| `entries[].surface` | string | 要 | **正しい表記**。空でない・前後空白なし・NFC（`display_policy` の `protected_terms` と同じ `strictText` 条件。§3-6 の供給先がこの形を要求する）。正規化キー（§3-1）がファイル内で一意 |
| `entries[].variants[]` | string[] | 任意（既定 `[]`） | 誤認識・表記ゆれの形。各要素は空でない文字列。正規化キーがファイル内の他 entry の `variants` と衝突しない（`validate-word-book.mjs` が拒否）。`surface` と同じキーになる要素は許す（全角半角・大小の正規化を明示する用途） |
| `entries[].reading` | string | `reading-only` では要・他は任意 | TTS 読み仮名。ひらがな・カタカナ・長音のみ（既存の narration `reading` 規約 [`skills/generate-narration/reading-text.md`](../skills/generate-narration/reading-text.md) に接続する。**v0 では保持のみ・消費は v0.1**） |
| `entries[].kind` | enum | 要 | `term` / `notation` / `ng` / `reading-only`（下表） |
| `entries[].protect_break` | boolean | 任意（既定 `false`） | `true` なら字幕行分割で `surface` の内側に改行を入れない（§3-6）。**台本パネル「覚える」は `term` に対して既定 `true` を提案する**（§4） |
| `entries[].source` | string | 任意 | 出所。推奨語彙 `manual` / `daihon-panel` / `promote` / `import`（enum 強制はしない。`emphasis_words[].emotion` の先例） |
| `entries[].added_at` | string (ISO8601) | 任意 | 登録時刻 |
| `entries[].hits` | integer ≥ 0 | 任意 | 適用回数。**v0 は保持のみ**（書かない）。学習ループ（§9）が剪定の根拠に使う席 |

### `kind` の意味（v0 で何が起きるか）

| `kind` | プリパス（§3-2） | edit-lint（§3-5） | `protected_terms` 供給（§3-6） | TTS 読み（§9） |
|---|---|---|---|---|
| `term` — 固有名詞・専門用語。`variants` は誤認識 | **自動置換**（`variants` と、正規化キーが `surface` に一致する別表記を `surface` へ） | 残った `variants` を warning | `protect_break` に従う | v0.1 |
| `notation` — 表記ルール（使う語 / 使わない語）。`variants` は「使わない語」 | **置換しない** | `variants` の出現を warning | `protect_break` に従う | — |
| `ng` — 使用禁止語。`surface` が禁止語そのもの、`variants` はその別表記 | 置換しない | **v0 は検査しない**（v0.1。§9） | — | — |
| `reading-only` — 表記は正しいが読みが要る語。`variants` は空 | 置換しない | — | `protect_break` に従う | v0.1 |

`notation` を自動置換しない理由: 「ムービー」と言った発話を「動画」に直すのは**表記の統一であって
誤認識の訂正ではない**。発話と字幕がずれる判断は人がする（warning で促す）。`term` は「そう言った
のに STT が違う字を当てた」訂正なので機械が直してよい（§6）。

## 2. 置き場所 — 作業場基底の 4 層

置き場所は creator-root v1 §7 の裁定（ユーザーの内容物は隠しディレクトリ `~/.akari/` に置かず、
作業場の `.akari/memory/` に置く）に従う。層は素材ライブラリ契約の 4 層スコープと同型で、
**近い層が勝つ**（shadowing）。

| 層 | 場所 | 生存範囲 | 書き手 |
|---|---|---|---|
| `project` | `<プロジェクト>/.akari/memory/word-book.json` | その動画のみ | 台本パネル「覚える」（既定）・CLI |
| `channel` | `<作業場>/channels/<channel>/.akari/memory/word-book.json` | そのチャンネル（発信主体）の全動画 | 「覚える」の昇格先・CLI |
| `workspace` | `<作業場>/.akari/memory/word-book.json` | その作業場の全チャンネル | 「覚える」の昇格先・CLI |
| `builtin` | 本リポ `presets/word-book/builtin.json`（`presets/INDEX.md` に解決コードのパスと共に登録する） | 製品出荷デフォルト | PR 経路のみ（内容は空配列から始める） |

- **解決順**: `project` → `channel` → `workspace` → `builtin`。同じ `surface`（正規化キー）が複数層に
  あるときは近い層の entry が**丸ごと**勝つ（フィールド単位のマージはしない）。ある層の `variants`
  が別の層の別 `surface` と衝突したときも近い層が勝ち、lint が `word-book.variant-shadowed`（info）で
  知らせる（§5）
- `channel` は、プロジェクトが `<作業場>/channels/<channel>/videos/<project>/` の形に置かれている
  ときだけ存在する（creator-root v1 §3 の正準構造から機械的に決まる。**ブランド選択の質問を
  intake に足さない**）。作業場の同定は `packages/creator-root` の `resolveCreatorRoot`（`root.json`
  マーカー）を使う
- **お試しモード**（作業場なし。creator-root v1 §9）では `project` + `builtin` の 2 層で動く。
  昇格先（`channel` / `workspace`）は無い。「覚える」は `project` にだけ書き、作業場の作成を案内して
  よいが強制しない
- 検証・CI の注入口として `--word-book <path>` オプション / 環境変数 `AKARI_WORD_BOOK` を設け、
  指定されたファイルを **`project` より近い最上位層**として読む（`AKARI_SOUNDS_DECLARATIONS` の
  先例）。本タスクの検証はリポ内 fixture で完結させ、実際の作業場・ホームには書き込まない
- `~/.akari/styles/` は**新設しない**。内部 memory-and-style 契約 §2（2026-07-25）が置き場として
  挙げていたが、後発の creator-root v1 §7（2026-08-02・オーナー承認）が「内容物は作業場へ」と
  裁定しており、本書はそちらに従う。`.akari/memory/` は creator-root v1 §3 が「スタイル学習・記憶」の
  席として既に予約している名前である
- `channels/<channel>/.akari/` は creator-root v1 §3 の正準構造に無い**追加**（任意サブディレクトリ。
  追加のみ進化なので `creator-root/v2` は要らない）。同契約 §3 への 1 行追記を本タスクで行う
- 書き込みは **temp + rename の原子的書き込み**、書く前に `validate-word-book.mjs` 相当の検査を
  通す（fail-closed。壊れた単語帳を書くとプリパスが黙って効かなくなるため。audio
  `declarations.json` の書き手 `declare-server.mjs` と同じ規律）。同一ファイルへの連続書き込みは
  直列化する（`packages/edit-store/src/write-gate.ts` の `writeAtomic` と同じ理由）
- 単語帳ファイルに**プロジェクト外への絶対パスを書かない**（creator-root v1 §6-4 可搬性）。
  entry は語彙だけを持つ

## 3. データ規律 — 一致・置換・不可侵

### 3-1. 正規化キー

一致は文字列そのものではなく**正規化キー**で比較する: NFKC 正規化 → Unicode 既定の case fold →
空白（`\s`）を全て除去。`surface` は書き込み時に NFC・trim を要求する（§1）が、比較には NFKC
キーを使う。これにより全角英数・大文字小文字・語間空白の差は `variants` に列挙しなくても吸収される。
長音・小書き・濁点の異表記（「ヴィデオ」と「ビデオ」）は吸収**しない**（列挙する）。

### 3-2. 一致は語境界でのみ — 部分文字列一致の禁止

対象はセグメント / 字幕レコードの **`words[]`**（3 バックエンドすべてが出す。whisper / SpeechAnalyzer /
cloud）。

1. `words[]` 上で、**連続する k 個（k ≥ 1）の語の `text` を連結**したものの正規化キーが、ある entry の
   `variants` のキー（`term` では `surface` のキーも含む）と**完全一致**するとき一致とする。語の途中
   （「灯り」が語 `灯りビデオ` の内側にある等）は一致しない。これが「語境界でのみ当てる」の定義
2. 一致した語列は **1 語に畳む**: `{ start: 先頭語の start, end: 末尾語の end, text: surface }`。
   時刻は実測値のまま動かさない（カラオケの語時刻が保たれる）
3. セグメント / レコードの `text` 側では、一致した語列の各 `text` を**任意の空白で連結した並び**を
   左から 1 回だけ探して `surface` に置き換える。**見つからなければその一致は適用しない**（skip として
   件数に計上）。`words[]` と `text` が既に乖離しているデータを、片側だけ書き換えて悪化させない
4. `words[]` が無いセグメント / レコードでは、`text` を `Intl.Segmenter`（`granularity: "word"`、
   locale は `display_policy.locale` があればそれ、無ければ `ja`）で語に分け、同じ規則（連続語の連結
   キー一致）で `text` だけを置換する。時刻を持つ語が無いのでカラオケは壊れない
5. 置換の結果が既に `surface` と同一なら何もしない（**冪等**。2 回当てても 1 回と同じ）

### 3-3. 優先順位と決定論

- 左から右へ走査し、各位置で**最長一致**（語数が多い → 同数なら variant 文字列が長い）を採る。
  一致した語列は重ねて使わない
- 同じ位置で複数 entry が候補になるときは近い層（§2）の entry を採る。同一層内の衝突は validator が
  事前に拒否している
- 同じ入力（セグメント・単語帳の解決結果）からは常に同じ出力を得る。乱数・時刻・環境に依存しない

### 3-4. 書き換えてよいもの・触らないもの

| 対象 | 扱い |
|---|---|
| `words[].text` / `start` / `end` | 一致した語列を 1 語に畳む（3-2 の 2）。他の語は不変 |
| `text` | 3-2 の 3 に従い置換 |
| `display_text`（存在するとき） | `text` と同じ置換を当てる（表示用の上書き席に古い表記が残らないように） |
| `display_fragments`（存在するとき） | 一致が**1 つの fragment の内側に収まる**ときだけその fragment 内で置換する。fragment 境界をまたぐ一致は**そのレコード全体を skip** し件数に計上する（人が決めた改行位置を壊さない。`display_fragments` は `display_text ?? text` と完全一致しなければ validator が拒否する） |
| `edited` | **触らない**。プリパスは人の手直しではない |
| `unrecognized[]` / `emphasis_words[]` / `style` / `style_preset` / `text_style` / `sourceRef` / `speaker` / `time_domain` / その他 | 触らない。`emphasis_words[].word` は時刻アンカーなので表記が変わっても描画は壊れない |

### 3-5. 人の手直しは不可侵

- `captionRecord.edited: true` のレコードには**再適用しない**（一致があっても skip し、lint が
  `captions.word-book-term` を `info` で知らせるだけ。§5）
- 置換は**必ず `words[]` と `text` を同時に語単位で書く**。`applyCaptionTextEdit`
  （`packages/edit-store/src/caption-words-rederive.ts`）を経由しない — あれは人の本文編集用の
  カーネルで、`edited: true` を立て、一致率が閾値を下回ると `words[]` を**黙って削除**する
  （カラオケ消失）。単語帳の置換は語列と時刻を知っているので再導出が要らない
- captions.json への書き込みは edit-store の write-gate を通す（`caption-store.ts` に**関数 1 本 =
  1 op** の流儀で `applyWordBookToCaptions` を足す。lint debounce・原子的書き込みを既存どおり受ける）
- `akari word-book apply` は **analysis.json の transcript セグメントと captions.json の両方**へ同じ
  置換を当てる。片側だけ直すと edit-lint 既存規則 `captions.edited`（`edited: false` なのに本文が
  transcript と一致しない）が warning を出す。この warning は「単語帳を育てたのに captions.json に
  再適用していない」検知として**そのまま使う**（新規則を足さない）

### 3-6. 行分割 `protected_terms` への供給 — 軟らかい供給

`display_policy.break_hints.protected_terms` の一致は**部分文字列・全出現・硬い拒否**であり
（`packages/edit-store/src/caption-display.ts` `splitsProtectedTerm`）、候補境界を全部潰すと
`NO_WORD_BOUNDARY_SPLIT` で**字幕がレンダー不能**になる（劣化なし）。単語帳からの供給でこの失敗を
新たに作ってはならないので、供給は**軟らかく**する:

1. `resolveCaptionDisplay` の呼び出し側（render-cut / preview-server / edit-lint / shell の preview
   service の 4 箇所）が、解決済み単語帳の `protect_break: true` な `surface` を
   `extra_protected_terms` として渡す（`resolveCaptionDisplay` 自体はファイル IO を持たない純関数の
   まま。ブラウザ側には出さない — 既存の純度テストどおり）
2. 分割は「policy 明示の `protected_terms` ∪ 単語帳ぶん」でまず試み、`NO_WORD_BOUNDARY_SPLIT` なら
   **単語帳ぶんだけを外して再試行**する。それでも失敗するなら既存どおり失敗する（policy 明示ぶんの
   責任）。外したことは lint が `captions.word-book-break-fallback`（warning）で知らせる
3. **`display_policy` が無いプロジェクトには何も供給しない**。単語帳は policy を注入しない
   （`recipe.schema.json` の「`display_policy` 等を自動注入してはならない」と同じ線）
4. 供給するのは `surface` だけ（`variants` は供給しない。プリパス後の本文に variants は残らない
   前提。残っていれば §5 の warning が先に立つ）

### 3-7. キャッシュと生出力

- 文字起こしキャッシュ（`.akari/cache/transcribe/`）は **STT の生出力のまま**保存する。プリパスは
  キャッシュ読み出し後に毎回当てる。単語帳を育てても再文字起こしは要らない
- `akari media transcribe --no-word-book` で生出力を analysis.json に記録できる（比較・検証用）

## 4. スキル配線 — 当てる瞬間

| 瞬間 | 何をするか | 実装箇所 |
|---|---|---|
| 文字起こし直後 | 解決済み単語帳で全セグメントにプリパス（§3-2）。キャッシュ hit 経路も同じ | `packages/akari-tools/src/media/transcribe.mjs` `transcribeMedia`: `normalizeSegments` / `attachUnrecognizedSpans` の後・`recordTranscribe` の前。`options.wordBook`（`--no-word-book` / `--word-book <path>`） |
| 台本パネル「覚える」 | 人が行を直した直後に、直した語列を `variants`、直した後を `surface` として登録を提案。**登録先の層を必ず人に確認**（既定 `project`。`channel` / `workspace` は昇格 = 内部契約 §4 の承認ゲート）。登録後、同じプロジェクトの `edited: false` な行と transcript に即時再適用し件数を返す | `apps/shell/extensions/akari-transcript` の node 側 service に `rememberWord` RPC を足し、`packages/word-book` の add + apply を呼ぶ（訂正 2026-09-02: RPC は akari-annotations の service に足す。UI は akari-transcript） |
| 手動再適用 | 既存プロジェクトに解決済み単語帳を当て直す。`--dry-run` で件数だけ | `akari word-book apply [--project <dir>] [--dry-run]` |
| edit-lint | §5 の規則 | `packages/edit-lint/src/edit-lint.mjs`（captions 検査の並び） |
| 行分割 | §3-6 の軟らかい供給 | `resolveCaptionDisplay` の呼び出し 4 箇所 |
| 解決の可視化 | 有効な entry と出所（どの層から来たか）を表示 | `akari word-book resolve [--project <dir>]`（`manage-connections` の `resolve-connections.mjs` が返す `sources` と同型） |
| generate-narration | `reading` の消費 | **v0.1**（§9） |

純関数（解決・一致・置換・検証）は新規パッケージ `packages/word-book/`（依存ゼロの plain ESM）に
置き、akari-tools / edit-lint / edit-store の node 側 / shell の node 側が同じ実装を呼ぶ。4 出口で
別々の一致器を持たない（4 出口パリティ）。

「覚える」が提案する既定値: `kind: "term"`、`protect_break: true`、`source: "daihon-panel"`、
`added_at` = 今。人はダイアログで `kind` を `notation` に変えられる（その場合 `protect_break` の既定は
`false`）。**推測で登録しない** — 人が「覚える」を押した語列だけを登録する（recipe v0 §3 規律 1 と
同じ「確認済みの値だけ記録する」）。

## 5. 劣化規約と lint 規則

単語帳はプロジェクトの参考情報であり、検証失敗や不在が文字起こし・編集・レンダー工程を巻き込んで
失敗させない。

| 状況 | 挙動 |
|---|---|
| どの層にも単語帳が無い | 正当な状態。プリパスは何もしない・供給もしない・lint は静か |
| `entries` が空配列 | 同上 |
| ある層のファイルが JSON として壊れている / スキーマ違反 | その層を「無いもの」として続行。lint が `word-book.invalid`（warning・パス付き）で知らせる。**書き込み側は fail-closed**（壊れたものを書かない） |
| `version > 0` | その層を read-only で無視し「このファイルは新しい形式です。スキル / アプリを更新してください」を warning で出す（原則 3） |
| entry に未知フィールド | 保持する（寛容リーダー）。validator は `word-book.unknown-field`（info）で知らせるだけ |
| 一致した語列を `text` 側で見つけられない | その一致だけ skip（§3-2 の 3）。`apply` の結果に件数を出す |
| `display_fragments` の境界をまたぐ一致 | そのレコードを skip（§3-4）。件数を出す |
| 作業場を解決できない（`resolveCreatorRoot` がエラー） | `project` + `builtin` で続行（お試しモード扱い）。warning は出さない |
| 単語帳ぶんの `protected_terms` で分割不能 | 単語帳ぶんを外して再試行（§3-6）。`captions.word-book-break-fallback` warning |

### edit-lint 規則（v0）

規則 id は既存の流儀（ドット区切り・各区分は kebab-case。識別子フィールドは `check`）に従う。

| `check` | severity | 条件 |
|---|---|---|
| `word-book.invalid` | warning | 解決対象の層のファイルが読めない / スキーマ違反 / `version > 0` |
| `word-book.unknown-field` | info | entry に未知フィールド（validator のみ。lint は出さない） |
| `word-book.variant-shadowed` | info | 層をまたいで同じ variant キーが別 `surface` に属する（近い層が勝った事実の通知） |
| `captions.word-book-term` | warning（`edited: true` の行は info） | `term` の `variants` が字幕本文に語境界で残っている。非 edited 行なら「再適用漏れ」、edited 行なら人の判断なので info |
| `captions.word-book-notation` | warning | `notation` の `variants` が字幕本文に語境界で現れる（edited の有無を問わない） |
| `captions.word-book-break-fallback` | warning | §3-6 の 2 で単語帳ぶんを外した |

lint の一致も §3-2 と同じ語境界規則（`words[]` → 無ければ `Intl.Segmenter`）で行い、部分文字列では
検査しない。`ng` の検査は v0.1（§9）。

## 6. データ設計意図

- **語彙項目を単位にする理由**: 同じ語に誤認識の形が複数あり（「あかりビデオ」「灯りビデオ」…）、
  読み・行分割保護・種別はその語に 1 つずつ付く。置換ペアの列にすると同じ語の属性が散り、
  「この語の読みは？」に答えられない。TTS（v0.1）と行分割（v0）が同じ 1 件を見るのが要点
- **`kind` を分ける理由**: 「STT が違う字を当てた」（`term`・機械が直してよい）と「発話どおりだが
  表記を統一したい」（`notation`・人が決める）は責任の所在が違う。両方を自動置換にすると発話と字幕が
  黙ってずれる。禁止語（`ng`）と読みだけ要る語（`reading-only`）は置換の対象ですらない
- **語境界でのみ当てる理由**: 日本語に空白区切りが無いため、部分文字列一致は「灯り」が「灯りビデオ」
  や「明かりを灯りに」を巻き込む。`words[]` は STT が実測した語境界であり、これを一致の単位にすれば
  時刻を持つ語列を 1 語に畳めてカラオケが崩れない。`words[]` が無いときだけ `Intl.Segmenter` に
  落ちるのは、既存の行分割（`a4-ja-two-fragment-v1`）が同じ境界器を使っているため — 新しい依存を
  持ち込まない（形態素解析器は本リポに存在しない。読みでの一致は次段 §9）
- **`text` と `words[]` を同時に書く理由**: 人の本文編集カーネル `applyCaptionTextEdit` は「本文が
  変わったので語時刻を再導出する」道具であり、一致率が低いと `words[]` を捨てる。単語帳は語列と
  時刻を知っているので、再導出を通さず両方を語単位で書くのが唯一安全な経路
- **`edited: true` を不可侵にする理由**: 人が直した行は人の判断の記録。機械が上書きすれば
  「開いたらほぼ終わっていてドラッグで直せる」の信頼が崩れる。lint が info で知らせるに留める
- **置き場所を作業場にする理由**: 単語帳はユーザーの内容物（承認の蓄積）であり、アプリ更新で
  入れ替わるマシン状態ではない。creator-root v1 §7 の裁定どおり隠しディレクトリに置かない。層を
  ディレクトリの包含関係（project ⊂ channel ⊂ workspace）で決めれば、「この動画はどのブランドか」
  を別途宣言する席が要らない。移動（養子縁組）でも自然に付いてくる
- **`channel` を発信主体の層にする理由**: 表記・用語が自然にまとまる単位はチャンネル / ブランド /
  クライアントであり、プロジェクト単位では毎回作り直し、作業場全体では案件間で汚染する
  （内部契約 §2 の裁定を creator-root の `channels/<channel>/` に写像したもの）
- **凍結スナップショットを v0 に入れない理由**: プリパスの結果は analysis.json / captions.json に
  **永続化される**ので、半年後の再レンダーで単語帳が変わっていても本文は変わらない。レンダー時に
  生きて参照するのは §3-6 の行分割供給だけで、それは軟らかい供給であり本文を変えない。よって
  再現性のために凍結は要らない。凍結が要るのは「別マシンで lint を同じ規範で走らせる」用途で、
  それは次段（§9）
- **供給を軟らかくする理由**: 既存の `protected_terms` は硬い拒否で、足すほど分割不能に近づく。
  単語帳は語が増え続ける器なので、硬い供給にすると「単語を覚えるほど字幕が壊れる」。明示 policy の
  硬さは保ったまま、単語帳ぶんだけ退く
- **`hits` を席だけ確保する理由**: 学習ループ（同じ直し 2 回 → 提案、使われない entry の剪定）が
  必要とする最初のデータ。v0 で書かないのは、書き込み（作業場・チャンネル層への副作用）を
  文字起こしコマンドに持たせる是非を別途裁定するため
- **`~/.akari/styles/` を作らない理由**: §2 参照。二つの契約が矛盾するとき、後発でオーナー承認の
  ある creator-root v1 を採る。内部契約 §2 の記述は本書の裁定後に追従して改める

## 7. よくある間違い

- **`text` を部分文字列置換で直す** — 誤り。§3-2。語境界でのみ当てる。`text` 側の置換は一致した
  語列を探して 1 回だけ
- **`applyCaptionTextEdit` 経由で本文を書き換える** — 誤り。§3-5。`edited: true` が立ち、
  一致率次第で `words[]` が消える
- **`edited: true` の行に再適用する** — 誤り。§3-5。人の手直しは不可侵
- **captions.json だけ直して analysis.json を直さない（またはその逆）** — 誤り。§3-5。
  `captions.edited` が warning を出す。`apply` は両方へ当てる
- **`notation` を自動置換する** — 誤り。§1 の `kind` 表。表記統一は人の判断。warning で促す
- **`display_policy` が無いプロジェクトに policy を注入して `protected_terms` を効かせる** — 誤り。
  §3-6 の 3。単語帳は policy を作らない
- **単語帳の `surface` を硬い `protected_terms` として直接 policy に書き込む** — 誤り。§3-6。
  分割不能を作る。供給は呼び出し側の `extra_protected_terms` で軟らかく
- **`normalizeSegments` の前にプリパスを当てる** — 誤り。§4。`normalizeSegments` はフィールドを列挙で
  再構築するので、前段で足した情報は落ちる。当てるのは `normalizeSegments` / `attachUnrecognizedSpans`
  の後
- **キャッシュに置換済みを保存する** — 誤り。§3-7。キャッシュは生出力。単語帳を育てるたびに
  再文字起こしが要る設計にしない
- **`~/.akari/styles/<brand>/` に置く** — 誤り。§2。内容物は作業場へ。ブランド = `channels/<channel>/`
- **単語帳の不在・破損で文字起こしやレンダーを止める** — 誤り。§5。無いものとして続行し warning
- **推測で entry を登録する**（STT の confidence や LLM の判断で自動登録） — 誤り。§4。人が「覚える」を
  押した語列だけ
- **entry に `scope` を書く** — 誤り。§2。層はファイルの置き場で決まる。`resolve` の出力にだけ出所が付く
- **`packages/overlay-runtime/src/text-split.js` を語境界器として参照する** — 誤り。そのファイルは
  存在しない。語境界は `words[]` と `Intl.Segmenter`

## 8. マイグレーション

（空欄 — `word-book.schema.json` は本契約で新設。破壊的変更が必要になった場合はここに旧→新の
機械実行可能な変換手順を必ず併記する。`contract-2026-07-17` 原則 2）

## 9. 次段（本契約のスコープ外）

- **TTS 読み仮名の消費（v0.1）**: generate-narration が読み原稿を作るとき、解決済み単語帳の
  `reading` を持つ entry（`term` / `reading-only`）の `surface` を `reading` に置き換える。既存の
  `script` / `reading` 二重保存規約（`reading-text.md`）に接続する。手作業のかな化を減らすのが目的
- **`ng` の lint（v0.1）**: `captions.word-book-ng`（error か warning かは裁定待ち）。禁止語は
  「出たら直す」ではなく「出したくない」なので severity は `term` より強い候補
- **STT への初期プロンプト**: whisper.cpp の `--prompt` に解決済み `surface` を渡し、誤認識を上流で
  減らす。現行の `runWhisper` argv（`-m,-f,-l,-oj,-ojf,-of`）に席が無いので `resolveWhisper` /
  `transcribeMedia` の options を通す改修が要る。SpeechAnalyzer / cloud の同等機能は個別に調査
- **読みでの一致**: `variants` を列挙しなくても同音の誤認識を当てる（「灯り」「明かり」「あかり」）。
  形態素解析器（kuromoji.js 等）の依存を持ち込む判断が要るため v0 は表層一致のみ
- **学習ループ**（内部契約 §4 の実体・「スタイル学習」）: 台本パネルの本文編集を `.akari/events/` に
  記録し、同じ直しが 2 回目に現れたら「覚える？」を提案する。`hits` を書き、長期間 0 の entry を
  剪定候補に出す。提案頻度は recipe v0 の offer-once に倣う
- **凍結スナップショット**: `frozen_at` を持つ `project` 層ファイルへ上位層を写し、以後は上位層を
  読まない。別マシン・別時期で同じ規範の lint を保証する用途
- **`notation` の承認付き一括置換**: warning を見た人が「全部直す」を押したときだけ、`edited` を
  立てずに置換する導線
- **単語帳エディタ UI / インポート・エクスポート**（CSV・他ツールの辞書形式）
- **作業場 `.akari/memory/` の他の記憶**（トーン散文・`caption_defaults` 等。内部契約 §2 の残り）
  との同居規約。本書は `word-book.json` 1 ファイルだけを定める

## 10. 受け入れ条件（実装タスクが満たすこと）

1. `packages/schemas/word-book.schema.json` + `validate-word-book.mjs` + 実例（valid 1・invalid
   3: variant 衝突 / `reading-only` に variants / `version: 1`）。`version > 0` は更新案内で停止
2. `packages/word-book/` の純関数に対する node --test: 語境界一致（語の内側は一致しない）・
   多語連結の畳み込み（時刻が先頭 / 末尾を保つ）・最長一致・層の shadowing・冪等性・`text` 側
   不一致の skip・`display_fragments` 境界またぎの skip・`Intl.Segmenter` 経路
3. `transcribeMedia` に `backendRunner` 差し替えで固定した words を流し、analysis.json の
   transcript が置換済みで、キャッシュファイルは生出力のままであることを確認
4. captions.json への apply 後に `edit-lint` が `captions.edited` を出さず、`edited: true` の行が
   バイト単位で不変であること。カラオケ 4 出口（render-cut / gpu / osr / preview）の語トークン数が
   `words[]` と一致し続けること（既存パリティテストに単語帳 fixture を 1 本足す）
5. `display_policy` あり + 単語帳 `protect_break` で分割不能になる fixture で、軟らかい供給が退いて
   レンダーが成功し `captions.word-book-break-fallback` が出ること
6. 作業場 fixture（`root.json` + `channels/<c>/videos/<p>`）で `resolve` が 4 層の出所を正しく返し、
   作業場なし fixture で `project` + `builtin` に落ちること
7. 実際のホーム・作業場へ書き込まない（全テストは一時ディレクトリと `AKARI_WORD_BOOK` で完結）
8. launcher: `akari word-book --help` が 4 サブコマンド（resolve / validate / add / apply）を列挙し、
   akari-tools 不在時は「インストール方法」を示して exit 1
