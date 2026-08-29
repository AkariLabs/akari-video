# critique-cut ワークフロー

## 使用区間の導出

`bin/used-ranges.mjs` を使い、手計算しない。

```sh
node skills/critique-cut/bin/used-ranges.mjs <project-root>/edit.json
```

出力の `sources[]` は、`src`、解決済み `path`、観察対象の統合済み `ranges[]`、各 cut / item の
`uses[]` を持つ。`uses[].source` は source 秒、`uses[].timeline` は timeline 秒である。
`media_item_count` / `overlay_item_count` / `telop_item_count` / `filter_item_count` /
`audio_media_item_count` / `caption_track_count` は、所見でタイムライン構成を説明するための件数である。

- v0: `cuts[].src` があれば素材パスとして扱う。無ければ単一 `source.path`（文字列 `source`
  も互換として読む）へ解決する。`cuts` が空または欠落なら `whole_source: true` とし、
  edit.json だけから終端を推測せず、`probe.duration_s` を得た後に `[0, duration_s)` として確定する。
- v1: `cuts[].src` を `sources[].id` から `sources[].path` へ解決する。未知 id の cut は
  `warnings[]` へ出して除外し、見たことにしない。
- v2: `output.fps` を 1 以上の整数として読み、visual lane の `source.kind: "media"` item だけを
  素材使用区間へ入れる。`item.at / fps` が timeline 開始秒、
  `(item.at + item.duration) / fps` が timeline 終端秒である。`at` / `duration` は整数フレーム、
  `item.source.in/out` は source 秒であり、単位を混ぜない。HTML / telop / filter と audio lane の
  media item は `ranges[]` へ入れず、種類別件数と全 item の最大終端へだけ反映する。
- cut の `[in, out)` は source 秒の半開区間。素材ごとに `in` 昇順へ並べ、重複区間と
  `前の out == 次の in` である隣接区間を統合する。別の `src` は同じ時刻でも統合しない。
- v0 / v1 の通常の timeline 射影は `(out - in) / speed`。`speed` 省略時は 1。`track` ごとに
  cursor を持ち、`at` があればその timeline 秒へ明示配置し、無ければ同じ track の直前の終端へ
  詰める。`track` 省略時は 0 とする。
- v0 / v1 の `freeze.duration_sec` は source の使用区間を広げず、cut の timeline 尺だけを伸ばす。
  `freeze.at_sec` は speed 適用後の cut 内秒で、`uses[].freeze` に source 時刻と timeline の
  hold 区間を残す。v2 の timeline 尺は item 直下の `duration` フレームを正本とし、source 内の
  `speed` / `freeze` から再計算しない。
- `timeline_duration_s` は v0 / v1 では全 track の cut 終端、v2 では media 以外も含む全 item
  終端の最大値である。`overlays` / `layers` / `audio` は完成絵と編集意図の所見には読むが、
  素材の `ranges[]` へ混ぜない。

`warnings[]` が空でない場合は critique.md の証跡へそのまま記録する。解決不能な cut の素材や
内容を推測しない。

## 帳面の既読判定

素材 `path` の帳面は
`.akari/sidecars/<source-relative-path>.analysis/analysis.json` にある。CLI 実行前に存在を確認し、
`observations[]` を削除・並べ替えない。キーが無いことは「未観察」であり「何も無い」ではない。

次の条件を満たす観察は既読として再利用する。

| 観察 | 既読の条件 |
|---|---|
| probe | `probe` があり、`observations[]` に `kind: "probe"` がある。尺・音声有無・hash は `probe` を読む |
| waveform | `tracks.waveform.path` と `kind: "waveform"` があり、今回使う引数と `observation.args` が一致し、列挙された出力が存在する |
| transcribe | `kind: "transcribe"` の `range`（range 無しは素材全体）が、今回の統合済み `[in,out)` を単独または複数観察の和集合で覆い、対応する `transcript[]` がある |

`waveform` は CLI に `--in/--out` が無いため、素材全体の既読結果を使用区間へ交差させて読む。
同じ素材へ区間ごとに再実行しない。既読でなければ次を素材ごとに 1 回だけ実行する。

```sh
akari media probe <src-id-or-path>
akari media waveform <src-id-or-path>
```

波形結果が `speech_likely: true` の場合だけ、既読で覆われない統合済み区間を個別に起こす。
`--in` と `--out` を省略して素材全体を起こしてはならない。

```sh
akari media transcribe <src-id-or-path> --in <source-in> --out <source-out>
```

ローカル backend が無く失敗した場合は発話内容を推測せず、失敗理由と当該章の「未観察」を残す。
クラウド backend は人間が接続と利用を明示した場合だけ既存の承認規約へ渡す。

## capture の時刻選び

capture の時刻は **timeline 秒**である。素材の source 秒を渡さない。出力先を今回の critique
レポート配下に固定する。**現行 `akari capture` は edit.json v2 専用**なので、v0 / v1 では
呼び出さない。代わりに人間へ次を勧めるが、本スキルは edit.json 読み取り専用のため実行しない。

```sh
akari migrate <project-root>
```

人間が v2 へ移行して保存した後にだけ、`--auto`、冒頭 3 秒内の代表時刻、依頼で明示された時刻を
和集合にする。

```sh
akari capture -p <project-root> --auto -t 0 1 2.999 <requested-timeline-times...> \
  --per-sheet 12 --out .akari/reports/critique/<stamp>/capture
```

短いタイムラインでは capture が末尾フレームへ丸め、同一フレームを重複除去する。複数シートが
出た場合も、読む画像は原則 1 枚だけとする。依頼時刻を含むシートを最優先し、次に 0〜3 秒を
最も多く含むシート、同数なら stdout の先頭を選ぶ。選ばなかったシートは「未観察」である。
`capture.json` と選択した sheet path を critique.md の証跡へ残す。

v0 / v1 が移行されない、または v2 でも capture が失敗した場合は画像を 1 枚も読まず、
`images_read: 0`、②「見えている絵」は「未観察」、証跡には capture 不可の理由を書く。素材の
`grab` を完成絵の代用にせず、重なり・字幕位置・見切れ・黒味について述べない。

## critique.md テンプレート

```md
# Critique

- edit: `<project>/edit.json`
- scope: 使用区間のみ
- images_read: `0 | 1`

## ① 事実

### 事実
- 尺 / カット数 / 使用素材:
- 喋り:
- 無音（timeline 秒 / (src, source 秒)）:

### 読み
- 事実から直接導ける補足。無ければ「なし」。

## ② 見えている絵

### 事実
- 読んだシート 1 枚で確認した重なり / 字幕位置 / 見切れ / 黒味。capture 不可なら「未観察」:

### 読み
- 見え方の評価。シート外は「未観察」。

## ③ テンポと間

### 事実
- cut 長分布 / speed / freeze / 無音:

### 読み
- テンポと間の評価:

## ④ 字幕の要否と方針

### 事実
- 使用区間の発話と、シート上の字幕:

### 読み
- 要否 / 密度 / 方針。根拠が無ければ「未観察」。

## ⑤ フックの位置

### 事実
- timeline 0〜3s にある音・絵・文字:

### 読み
- フックとしての評価:

## ⑥ 次の一手（3 つまで）

1. `[edit-plan 行き | address-review 行き | 追加観察]` 提案と理由

## 証跡

- contact_sheet: `<path | 未観察>`
- capture_manifest: `<path>/capture.json | 未生成（理由）>`
- observed_ranges:
  - `(src, [source-in, source-out))` — `reused | added | unobserved`
- ledgers:
  - `<analysis.json path>` — 再利用した observation / 追記された observation
- used_ranges_warnings: `[]`
- unobserved: 未読シート、失敗した観察、根拠が無い章
```
