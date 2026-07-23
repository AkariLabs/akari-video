# edit.json v1 語レベル演出（emphasis_words）データ契約

- 日付: 2026-07-23
- 状態: 実装ラウンドの SSOT（`emphasis_words` フィールドのみ確定）
- 前提: `contract-2026-07-17-data-contract-versioning.md`（版必須・追加のみ進化・明示マイグレの三原則）、
  `contract-2026-07-18-edit-json-v1-sources.md`（§3 座標系 — source 秒アンカー）、
  `contract-2026-07-20-edit-json-v1-narration.md`（id 規約・検証分担の先例）、
  `contract-2026-07-22-edit-json-v1-beats.md`（§8 で「将来拡張の席」として言及された `emphasis_words[]` の席を、
  本契約が開く）
- スコープ: edit.json のトップレベル `emphasis_words` フィールド（語レベル演出の対象）のみ。
  emphasis_words を**生成する側**（どの語を強調対象に選ぶか）と**消費する側**（どう描画するか）の実装は
  **別タスク**。本書はデータの器と検証責務の正文化のみを行う

## 0. version 運用（後方互換）

`contract-2026-07-22-edit-json-v1-beats.md` §0 と同じ運用を踏襲する。**`version` は bump しない。**

- `emphasis_words` は edit.json の**トップレベル任意フィールド**（`Option`）。存在しなければ従来
  （語レベル演出なし）と完全に同じ挙動
- 既存の `edit.json`（`emphasis_words` フィールド無し）は一切影響を受けない。既存の読み手は未知フィールドと
  して素通しできる（tolerant reader）
- `contract-2026-07-17-data-contract-versioning.md` 原則 1（版必須・追加のみ進化）どおり、
  任意フィールドの追加のみであり `version` の bump を要しない
- v0（単一 `source`）と v1（`sources[]`）の双方で使用できる。差は `src` の扱いのみ（§2）

## 1. 呼称

| 文脈 | 呼称 |
|---|---|
| データモデル（edit.json のフィールド名・スキーマ・コード・エラーメッセージ） | `emphasis_words[]` |
| 人間向け（レポート・UI・ドキュメント本文・オーナーとの会話） | **語レベル演出** |

この 2 つを正文とし、他の呼称（強調ワード、キーワード演出、語ハイライト等）を新設しない。
`beats[]`（見せ場マーカー）と同じく、データ名を英語（`emphasis_words`）に、人間向けを日本語
（語レベル演出）に固定することで、コードとレポートのどちらから読んでも同じものを指していると分かるようにする。

`beats[]` との粒度の違いは次のとおりで、両者は排他ではなく併存する:

| フィールド | 粒度 | 時刻 | 何を指すか |
|---|---|---|---|
| `beats[]` | 見せ場（区間の代表点） | 単一時刻 `t` | 素材のどこが山場か |
| `emphasis_words[]` | 語（発話の 1 語） | 区間 `t_start` 〜 `t_end` | どの語を演出の対象にするか |

## 2. 確定スキーマ

```jsonc
{
  "version": 1,
  "output": { "width": 1920, "height": 1080, "fps": 30 },
  "sources": [
    { "id": "s1", "path": "assets/intro.mp4", "proxy": null }
  ],
  "cuts": [ /* 既存のまま */ ],

  "emphasis_words": [            // 省略可。配列
    {
      "id": "e-0001",            // 必須。^e-\d{4}$。edit.json 内で一意
      "src": "s1",               // 任意。sources[].id への参照。省略 = 単一 source 互換
      "t_start": 132.40,         // 必須。source 秒。0 以上
      "t_end": 132.82,           // 必須。source 秒。t_end > t_start
      "word": "痛い",            // 必須。空でない文字列。transcript の実表記に忠実
      "emotion": "pain",         // 必須。空でない文字列
      "style_hint": "one-char-bang"  // 任意。描画側への提案。強制力なし
    }
  ]
}
```

### フィールド表

| フィールド | 型 | 必須 | 既定値 | 単位・座標系 |
|---|---|---|---|---|
| `emphasis_words` | array \| 省略 | 否 | 省略 = 語レベル演出なし | — |
| `emphasis_words[].id` | string | **必須** | — | `^e-\d{4}$`。edit.json 内で一意（`beats[].id` / `audio.narration[].id` と同型の規約） |
| `emphasis_words[].src` | string | 否 | 省略 = 単一 source 互換 | `sources[].id` への参照。v0（単一 `source`）では**使用できない**（参照先が定義できないため） |
| `emphasis_words[].t_start` | number | **必須** | — | **source 秒**（§3）。0 以上 |
| `emphasis_words[].t_end` | number | **必須** | — | **source 秒**（§3）。0 以上かつ `t_end > t_start` |
| `emphasis_words[].word` | string | **必須** | — | 空でない文字列。transcript の実表記に忠実（§4） |
| `emphasis_words[].emotion` | string | **必須** | — | 空でない文字列。`joy` / `pain` / `surprise` / `anger` / `sadness` / `emphasis` を例示（enum 強制はしない） |
| `emphasis_words[].style_hint` | string | 否 | — | 描画側への提案。`one-char-bang` / `size-pulse` / `color-accent` を例示。強制力なし（§6） |

`emotion` は `beats[].kind` / `audio.narration[].provenance.provider` と同じ流儀で、**文書上の例示に留め
enum 強制はしない**。感情語彙は素材ジャンル・言語・検出器の実装によって増えるため、契約側で列挙を固定すると
新しい語彙を足すたびにスキーマ改訂が要る。書き手が新しい `emotion` を使っても検証は通り、消費側は未知の
`emotion` を既定の扱い（§6）へフォールバックする。

`style_hint` は**提案であって指定ではない**。書き手（検出側）が「この語は一文字バンが似合う」という知見を
残せるようにしつつ、最終的にどう描くかの決定権は消費側（描画）に残す。消費側が `style_hint` を無視しても
契約違反ではない。強制力を持たせなかったのは、描画の語彙（§8 スコープ外）が本契約より後に決まるためであり、
先に決まる側が後に決まる側を縛らないようにするためである。

## 3. 座標系 — source 秒アンカー

**`emphasis_words[].t_start` / `t_end` は (`src`, source 秒) で永続化し、timeline 秒へ変換した結果を
永続化してはならない。**

これは `contract-2026-07-18-edit-json-v1-sources.md` §3 の次の規則を emphasis_words に適用したものである
（`contract-2026-07-22-edit-json-v1-beats.md` §3 と同じ根拠）:

> 字幕、注釈、解析結果は (`src`, source 秒) で永続化し、timeline 秒へ変換した結果を
> 永続化してはならない。表示や書き出しのたびに、その時点の `cuts[]` から timeline 秒へ
> 射影する。

emphasis_words は**解析結果**（素材のどこで何と発話されたかという素材固有の事実に対する注釈）であり、
編集の結果（どこに置いたか）ではない。したがって上記規則の適用対象そのものである。具体的な帰結:

- 消費側（描画・プレビュー・書き出し）は、表示・書き出しのたびに `cuts[]` から timeline 秒へ射影する。
  射影結果を edit.json へ書き戻さない
- 同一 source 区間がタイムライン上に複数回現れ得るため、source 秒 → timeline 秒の対応は**一対多**である
  （同§3）。1 つの語が複数の timeline 位置へ射影されることは正常であり、エラーではない
- どの cut にも含まれない source 秒の語（カットで落とした区間の語）は timeline 上に射影先を持たない。
  **射影先 0 件は正常**であり、消費側は単に射影結果 0 件として扱う
- 語の区間が cut 境界をまたぐ場合の扱い（部分的に残った語をどう描くか）は消費側の判断であり、
  本契約はデータ側で区間を分割することを求めない
- カットの再配置・同一区間の再利用を行っても emphasis_words を書き換える必要がない。焼き込んだ時刻との
  ずれが原理的に発生しない

`overlays[].start` / `audio.bgm` / `audio.sfx` / `audio.narration[].t` が**タイムライン秒**であることとは
対照的である（同§3）。emphasis_words は「素材の事実に対する注釈」、narration や SFX は「編集で置いた演出」
であり、座標系の違いはこの性質の違いに対応する。

`src` の省略は `captions.json` の `items[].src` / `beats[].src` と同じく**単一ソース互換**を意味する
（同§4）。v0（単一 `source`）では参照先を定義できないため、`src` の存在自体を不正とする（§7 の検証で**エラー**）。

## 4. word-level タイムスタンプとの関係（実測時刻の原則）

**`t_start` / `t_end` は、既に実測されている語レベルタイムスタンプの値を使う。語の中間で発明しない。**

参照元は次のいずれかである:

- `analysis.json` の `transcriptSegment.words`（`packages/schemas/analysis.schema.json`）
- `captions.json` の `words[]`

いずれも認識器が出力した語ごとの開始・終了時刻を持つ。emphasis_words の `t_start` / `t_end` はその値を
そのまま写す。文単位のセグメント時刻から「たぶんこの辺」と按分して語の時刻を作ってはならない。

この原則を置くのは、語レベル演出が**フレーム精度で語の発話に同期**して初めて成立する表現だからである。
按分で作った時刻は数百ミリ秒単位でずれ、描画側がどれだけ精密でも同期が破綻する。ずれの原因がデータ側に
あるのか描画側にあるのかも切り分けられなくなる。実測時刻に限定することで、同期精度の責任境界を
「認識器の精度」の 1 点に閉じ込める。

`word` も同じ理由で **transcript の実表記に忠実**とする。表記を正規化・整形した語を入れると、
参照元の word-level タイムスタンプとの対応が取れなくなり、後から突き合わせ検証ができなくなる。

本契約は「どの語を強調対象に選ぶか」（検出）を定めない（§8）。定めるのは、選ばれた語がどう記録されるか
だけである。

## 5. 劣化規約

`contract-2026-07-14-edit-json-v1-audio.md` §5「音声は装飾であり、映像本体の書き出し成否を左右しては
ならない」と同じ設計哲学を emphasis_words にも適用する。**語レベル演出は装飾であり、映像本体の書き出し
成否を左右してはならない。**

| 状況 | 挙動 |
|---|---|
| `emphasis_words` フィールドなし | 従来どおり（語レベル演出なし）。エラーにしない |
| `emphasis_words` が配列でない | 消費側は emphasis_words 全体を無いものとして扱い warning。書き出しは継続する |
| ある要素の `id` / `t_start` / `t_end` / `word` / `emotion` が不正 | **その 1 要素のみ**無視 + warning。他の語・映像本体・音声には影響しない |
| ある要素の `src` が `sources[].id` に解決できない | 同上（その 1 要素のみ無視 + warning）。`cuts[].src` の劣化規約（`contract-2026-07-18-edit-json-v1-sources.md` §6）と同型 |
| `t_start` / `t_end` がどの cut にも含まれない | エラーでも warning でもない。射影結果 0 件として扱う（§3） |
| 未知の `emotion` | エラーにしない。消費側は既定の扱いへフォールバックする（§6） |
| 未知の `style_hint` | エラーにしない。消費側は無視してよい（§2） |

**書き手は厳格・読み手は寛容。** 静的検証（`validate-edit.mjs` / `edit-lint`）が形式不正・範囲外を
**エラー**として弾くことと、消費側（書き出し・プレビュー）が実行時に不正な 1 要素だけを無視して継続する
ことは矛盾しない。前者は「壊れたファイルを書かせない」ためのゲート、後者は「壊れたファイルを渡されても
映像を出す」ための保険であり、役割が異なる。この二段構えは `beats`
（`contract-2026-07-22-edit-json-v1-beats.md` §4）、`audio.narration`
（`contract-2026-07-20-edit-json-v1-narration.md` §4/§8）、`audio.bgm` / `audio.sfx`
（`contract-2026-07-14-edit-json-v1-audio.md` §5）で確立済みの先例に従う。

## 6. 消費側の期待（本契約が定めること・定めないこと）

本契約が定めるのは **emphasis_words がどう書かれるか**（形式・座標系・実測時刻の原則・検証）までである。
emphasis_words を読んで実際にどんな演出を出すか（文字の出し方、`emotion` から色・モーションへの写像、
`style_hint` を採用するかどうか、未知 `emotion` の既定の扱いの具体）は**本契約のスコープ外**であり、
消費側の別契約で定める。

本契約が消費側に課す不変条件は次の 2 点のみである:

1. **source 秒アンカーを尊重する**（§3）。timeline 秒への射影は消費のたびに `cuts[]` から行い、
   結果を永続化しない
2. **劣化規約を尊重する**（§5）。不正・解決不能な要素は 1 件単位で無視し、書き出し全体を止めない

## 7. 検証

| 層 | 検証すること |
|---|---|
| `packages/schemas/edit.schema.json` | `$defs/emphasisWordItem` として構造（型・`id` パターン・必須項目・`t_start` / `t_end` の非負・`word` / `emotion` の最小長）を定義する。`editV0` / `editV1` 双方の `properties.emphasis_words` から参照する。`additionalProperties: true`（tolerant reader）を維持する |
| `packages/schemas/bin/validate-edit.mjs` | 上記に加え、JSON Schema 単体では表せない **`t_end > t_start`**、**`id` のファイル内一意性**、**`src` の参照整合**（v1: `sources[].id` に存在しない場合エラー / v0: `src` の存在自体がエラー）を検証する。`cuts[].out > in` / `cuts[].src` と同じ扱い |
| `packages/edit-lint`（`src/edit-lint.mjs`） | validate-edit と同一の構造チェック（エラー）を、依存ゼロ・手書き写しの流儀で実装する |

`t_end > t_start` と `id` の一意性と `src` の参照整合を JSON Schema に載せないのは、いずれも**兄弟要素・
兄弟フィールドの値を突き合わせる必要があり、JSON Schema 標準の語彙では表現できない**ためである
（`cutV0.out > in` / `cutV1.src` / `beats[].id` と同じ理由・同じ分担）。

**emphasis_words の検証はファイルシステムを見ない。** 各要素は素材ファイルを参照しないため、実在チェックの
対象が存在しない（`audio.narration[].file` との違い）。

**edit-lint は source の実尺と `t_start` / `t_end` を突き合わせない。** `--media` なしでメディアを
デコードしない規律を維持するためであり、`beats[].t` と同じ扱いである
（`contract-2026-07-22-edit-json-v1-beats.md` §7）。「時刻が素材の実尺を超えている」という検査は
**将来課題**とし、必要になった時点で実尺解析（ffprobe 等）を伴う別契約として設計する。

**`word` / `t_start` / `t_end` を `analysis.json` / `captions.json` の word-level タイムスタンプと
突き合わせる検査は行わない。** §4 の原則は書き手が守るべき規律であり、静的検証の対象にはしない
（参照元ファイルは任意であり、不在時に検証が成立しないため）。突き合わせ検証は**将来課題**とする。
`emphasis_words` および `analysis.json` の不在は、edit-lint の既存原則どおり**エラーにしない**。

## 8. スコープ外（将来拡張の席）

- **検出規約**（どの語を強調対象に選ぶか — 感情推定・キーワード抽出・しきい値・語数上限）: 本契約は選ばれた
  語の**記録形式**のみを定め、選定の規約は定めない。別契約で扱う
- **描画規約**（`style_hint` の各値が実際にどう描かれるか — 一文字バン等の実装・`emotion` から色/モーション
  への写像・オーバーレイ HTML の生成）: 本契約は消費側へ提案を渡す器のみを定める。別契約で扱う
- **カラオケなぞり・縦書き**（語の進行に合わせた塗り分け、縦組みレイアウト）: 語レベルの時刻データを前提と
  する表現だが、必要なフィールド（なぞりの方向、行組み、文字単位の分解）が本契約の器では表せない。
  席のみ言及し、フィールドは定義しない。別契約で扱う

いずれも別契約で扱う。本契約は `emphasis_words[]` の器だけを確定し、これらの席が将来開く可能性があることを
記録するに留める。
