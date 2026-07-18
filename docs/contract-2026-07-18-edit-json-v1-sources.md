# edit.json v1 マルチソース契約

- 日付: 2026-07-18
- 状態: 実装契約
- スコープ: `edit.json` の `sources[]`、`cuts[].src`、および source 秒アンカーを持つサイドカー

## 0. version 運用

**`sources[]` を使うファイルは `version: 1` とする。** `cuts[]` が単一素材の keep-range から、
素材を指定するクリップ列へ意味を変える構造的変更だからである。旧コンシューマが黙って別の映像を
組むより、未対応の version を明示的に拒否する方が安全である。

`version: 0` の単一 `source` 形式は恒久的に合法とし、読み手は v0 と v1 の両方に対応する。
単一ソースだけを扱う書き手は v0 を維持してよい。`source` と `sources[]` は排他であり、併存は
不正とする。

## 1. v1 スキーマ

```jsonc
{
  "version": 1,
  "output": { "width": 1920, "height": 1080, "fps": 30 },
  "sources": [
    { "id": "s1", "path": "assets/intro.mp4", "proxy": null },
    { "id": "s2", "path": "assets/main.mov", "proxy": "cache/main-720p.mp4" }
  ],
  "cuts": [
    { "src": "s1", "in": 0.0, "out": 4.2 },
    { "src": "s2", "in": 12.0, "out": 45.5 },
    { "src": "s1", "in": 60.0, "out": 65.0 }
  ]
}
```

### フィールド規則

| フィールド | 規則 |
|---|---|
| `sources[].id` | 空でない文字列。ファイル内で一意。`s1`, `s2`, … の連番を推奨する |
| `sources[].path` | edit.json の親ディレクトリを基準とする相対パス、または絶対パス |
| `sources[].proxy` | `null` またはソースごとのプロキシパス |
| `cuts[].src` | v1 では必須。`sources[].id` を参照する |
| `cuts[].in`, `cuts[].out` | 対象ソースの秒。`0 <= in < out` を満たす |

参照は path ではなく安定した `id` で行う。これにより素材の差し替えや path 変更で cut や
サイドカーの参照が壊れない。JSON Schema は将来の任意フィールドを許容する tolerant reader とし、
既知フィールドの型、version ごとの必須形、`source` / `sources[]` の排他を検証する。

## 2. タイムライン導出規則

アウトプットタイムラインは、`cuts[]` を**配列順にギャップなく連結**して導出する。v1 では
同じ `src` の再登場と任意の並べ替えを認める。同一 `src` 内でも `in` の昇順や cut 間の
非重複を強制しない。

v1 の空または欠落した `cuts` は空タイムラインを表す。v0 の空または欠落した `cuts` が素材全体を
表す既存の意味は変えない。黒味や間を表す gap エントリは将来拡張の席だけを予約し、v1 では
定義しない。

## 3. 座標系と一対多射影

従来の source 秒アンカーは、マルチソースでは **(`src`, source 秒)** の組に一般化する。
同一ソース区間がタイムライン上に複数回現れ得るため、source 秒から timeline 秒への対応は
一対多である。

**字幕、注釈、解析結果は (`src`, source 秒) で永続化し、timeline 秒へ変換した結果を
永続化してはならない。** 表示や書き出しのたびに、その時点の `cuts[]` から timeline 秒へ
射影する。これにより cut の再配置や同一区間の再利用で、焼き込んだ時刻とのずれを防ぐ。

オーバーレイの `start`、BGM、SFX は従来どおりアウトプットタイムライン座標であり、この
source 秒アンカー規則の対象外である。

## 4. サイドカーへの波及

- `captions.json` の `items[]` は任意フィールド `src` を持てる。値は `sources[].id` への参照で、
  `start` / `end` と組にして source 座標を表す
- `review.json` の `annotations[]` は任意フィールド `src` を持てる。値は `sources[].id` への参照で、
  `sourceT` または `sourceRange` と組にして source 座標を表す
- `src` の省略は単一ソース互換を意味する

analysis サイドカーは素材単位のままとし、構造は変更しない。参照時に `src` から source path を
解決する。

## 5. v0 から v1 への機械的変換

version bump は次の変換手順と必ず組にする。実行主体はエージェントとし、対象と差分を提示して
明示承認を得てから実行する。silent migration は禁止する。未知フィールドは保持する。

1. `sources = [{ "id": "s1", "path": <旧 source.path>, "proxy": <旧 source.proxy> }]` を生成する
2. 各 `cuts[]` 要素に `"src": "s1"` を付ける。v0 の `cuts` が空または欠落している場合は、
   `[{ "src": "s1", "in": 0, "out": <素材尺> }]` を生成する
3. `source` を削除し、`version` を `1` に更新する

素材尺が取得できず手順 2 の全体 cut を生成できない場合は、推測で変換せず停止して報告する。

## 6. 劣化規約

| 状況 | 挙動 |
|---|---|
| v0 の単一 `source` | 従来どおり読み書きする |
| v1 の `cuts[].src` が `sources[].id` にない | 当該 cut を無視し warning。他の cut は継続する |
| `source` と `sources[]` が併存 | lint エラー。読み手は `sources[]` を優先し warning を出す |
| `sources[].path` が存在しない | プレビューは欠落表示と warning。書き出しはエラーで停止する |
| `version` が 1 より大きい | 推測して検証・変換せず読み取り専用に倒す |

未対応の新しい version には、**「このファイルは新しい形式です。スキル / アプリを更新して
ください」**と正直に報告する。既知フィールドだけを拾って旧形式として処理してはならない。

## 7. 検証責務

`edit.schema.json` は v0/v1 の構造を検証する。`validate-edit.mjs` と edit-lint は、JSON Schema
だけでは表現できない `sources[].id` の一意性、`cuts[].src` の参照整合、`in < out` も検証する。
edit-lint は v0 の cut 順序・重複・素材尺の既存検査を維持し、v1 では配列順をタイムライン順として
順序を制限しない。
