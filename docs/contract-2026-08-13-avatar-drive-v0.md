---
lifecycle: stable
created: 2026-08-13
updated: 2026-08-13
---

# 2D アバター差分スプライト駆動契約 v0（avatar-drive）

- 日付: 2026-08-13
- 状態: **v0 実装済み**
- 前提: `contract-2026-07-13-m1-m4.md`（`layers[]` と出力座標系）、
  `contract-2026-07-22-prerender-rail-and-assets.md`（`kind: "baked"`）、
  `contract-2026-07-26-avatar-registry-v0.md`（将来の rendition 解決先）
- スコープ: 音声 RMS による口 3 状態と、決定論的な手続きまばたきを、アルファ付きの
  小領域クリップへ事前ベイクする変換器。映像からの表情推定とレジストリ解決は含まない

## 1. 入出力と責務

`packages/akari-tools/bin/avatar-drive.mjs <project> --sprites <dir>` は、`<project>/edit.json`
と source 音声を読み、スプライト自身の解像度・edit.json の出力 fps のまま ProRes 4444 MOV を
`.akari/cache/avatar-drive/avatar-drive.mov` へ生成する。フル出力フレームは焼かない。

stdout は常に 1 行 JSON で、成功時は次を含む。

```jsonc
{
  "ok": true,
  "layers": [
    {
      "id": "avatar-drive-0",
      "t": 0,
      "duration": 12,
      "kind": "baked",
      "src": ".akari/cache/avatar-drive/avatar-drive.mov",
      "transform": { "x": 472, "y": 184, "scale": 1, "rotate": 0 },
      "preset": "avatar-drive-v0",
      "params": { "position": "right-bottom" }
    }
  ],
  "drive": {
    "mouth": ["closed", "mid", "open"],
    "eyes": ["open", "open", "closed"],
    "blink_seed": 123456789
  }
}
```

- `drive.mouth[]` / `drive.eyes[]` の 1 要素は出力 1 フレームに対応する。
- `--apply` は生成した layer を既存 `layers[]` の末尾へ 1 件だけ追記する。既存の全フィールドと
  既存 layer の順序・値は不変で、同一 id が既にあれば上書きせず失敗する。
- source 音声は cuts の順序、`in` / `out`、`speed` を反映したタイムライン音声である。v0 の
  `source` と v1 の `sources[]` / `cuts[].src` を受け付ける。BGM・SFX・narration は駆動へ混ぜない。
- `--position` は `right-bottom`（既定）、`left-bottom`、`right-top`、`left-top`、`center`、
  または出力フレーム左上基準のアンカー座標 `x,y`。`--scale` は正の倍率（既定 `1`）。
  名前付きプリセットは scale 後のスプライト外接矩形を margin の内側へ揃え、`sprite.json` の
  anchor には依存しない。明示 `x,y` だけは、その座標へ sprite の anchor 点を固定する。

## 2. スプライトセット規約

1 セットは 1 ディレクトリと、その直下の `sprite.json` で構成する。参照 PNG はすべて同じ
透明キャンバスを共有し、`base` → 選択した `mouth` → 選択した `eyes` の順に合成する。

```text
avatar-sprites/
  sprite.json
  base.png
  mouth-closed.png
  mouth-mid.png
  mouth-open.png
  eyes-open.png
  eyes-closed.png
```

```jsonc
{
  "version": 0,
  "size": { "width": 256, "height": 256 },
  "anchor": { "x": 0.5, "y": 1 },
  "base": "base.png",
  "mouth": {
    "closed": "mouth-closed.png",
    "mid": "mouth-mid.png",
    "open": "mouth-open.png"
  },
  "eyes": {
    "open": "eyes-open.png",
    "closed": "eyes-closed.png"
  }
}
```

| フィールド | 規約 |
|---|---|
| `version` | 整数 `0`。破壊的変更だけが bump の理由になる |
| `size.width/height` | 2 以上の整数 px。全参照 PNG の実寸と一致する |
| `anchor.x/y` | キャンバス左上を `(0,0)`、右下を `(1,1)` とする正規化座標。配置時にこの点を固定する |
| `base` | 透過 PNG へのディレクトリ相対パス |
| `mouth.closed/mid/open` | 口の 3 状態。透過 PNG へのディレクトリ相対パス |
| `eyes.open/closed` | 目の 2 状態。透過 PNG へのディレクトリ相対パス |

絶対パス、`..` によるディレクトリ外参照、PNG 以外、欠落ファイル、寸法不一致は拒否する。
未知フィールドと `mouth` / `eyes` の追加キーは無視する寛容リーダーとし、笑顔・眉・衣装・追加口形など
将来の差分を **additive に追加できる**。既存の必須キーの意味変更や、追加差分を理由とする
`version` bump は行わない。

## 3. 駆動プロファイル v0

ffmpeg が cuts 適用後の source 音声を mono float PCM（4,800 Hz）へ復号し、出力フレームごとの
RMS を抽出する。RMS にアタック／リリース平滑をかけ、2 閾値とヒステリシスで
`closed` / `mid` / `open` を決定する。

| ツマミ | CLI | 既定値 | 意味 |
|---|---|---:|---|
| mid 閾値 | `--mid-threshold` | `0.025` | closed ↔ mid の中心 RMS |
| open 閾値 | `--open-threshold` | `0.075` | mid ↔ open の中心 RMS |
| ヒステリシス | `--hysteresis` | `0.008` | 各閾値の on/off 差（中心の前後半分） |
| アタック | `--attack-ms` | `35` | RMS 上昇時の時定数 ms |
| リリース | `--release-ms` | `120` | RMS 下降時の時定数 ms |
| まばたき周期 | `--blink-period` | `4.2` | 平均開始間隔 s |
| 周期揺らぎ | `--blink-jitter` | `1.2` | 開始間隔へ加える一様揺らぎ ±s |
| 閉眼時間 | `--blink-duration` | `0.12` | 1 回の閉眼時間 s |

`mid < open`、ヒステリシスが 2 閾値の間隔未満、全時間値が正であることを検証する。
まばたきの疑似乱数 seed は、正規化した edit.json、sprite.json、駆動プロファイルから SHA-256 で
導出する。壁時計、OS の乱数、ファイル mtime は使わない。同一入力・同一ツマミ・同一 ffmpeg 出力なら、
口状態列、まばたき列、ベイク映像、stdout の layer JSON は決定論的である。

## 4. 予約節（v0 では実装しない）

### 4.1 ビセム駆動

whisper の単語／音素アライメントから viseme を選ぶ経路を将来追加する。追加時も v0 の
`mouth.closed/mid/open` は必須のフォールバックとして残し、詳細な口形キーを additive に足す。

### 4.2 映像駆動表情

MediaPipe Face Landmarker の 52 blendshape から目・眉・口・頬の表情差分を選ぶ経路は次版で扱う。
本 v0 は映像を表情入力にせず、音声 RMS と手続きまばたきだけを使う。

### 4.3 アバター・レジストリ連携

`contract-2026-07-26-avatar-registry-v0.md` が「将来契約」として予約する演出エンジン連携へ、
rendition の lipsync 能力とスプライトセット参照を接続する予定である。**本 v0 は avatar.json / 
rendition.json の検索・解決を実装しない。** 入力は `--sprites <dir>` の直接指定だけとする。

## 5. 検証規律

1. 同じ RMS 列を 2 回変換し、ヒステリシスとアタック／リリースを含む口状態列が一致する。
2. 同じ seed・尺・fps から生成したまばたき列が一致し、異なる seed で列が変わる。
3. sprite.json の必須キー、参照境界、PNG 実寸を全数検証する。未知の追加差分は受理する。
4. `--apply` 前後の JSON を比較し、`layers[]` 末尾以外が不変であることを確認する。
5. 実音声の発話区間で `mid` / `open`、無音区間で `closed`、全尺内で `eyes: closed` が現れる。
6. ベイク MOV のアルファをフレーム画素で測り、スプライト外周が `alpha=0` であることを確認する。
