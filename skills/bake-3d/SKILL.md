---
name: bake-3d
description: 3D シーンを映像素材（クリップ）として使いたいとき、3D ベイクレシピ（scene.py）を新規作成・調整・再ベイクするときに発動する。Blender ヘッドレスでレシピを mp4 に焼き、検証し、素材ライブラリ / プロジェクトへ配置するまでを担う。映像の上に重なるオーバーレイ 3D は対象外（overlay-authoring/3d.md へ）。
---

# FORBIDDEN 級ハードルール

1. **ベイクを実行せずに「焼けた」と報告しない。** 出力 mp4 を ffprobe で確認し、フレームを抽出して目視するまで完了扱いにしない。
2. **scene.py に宣言済み param 以外の外部入力を持ち込まない。** 環境変数・wall-clock・暗黙 seed の乱数・ネットワーク取得は禁止。同じレシピ + 同じ params + 同じ Blender バージョン → 同じ映像、を崩さない。
3. **連番静止画を残さない。** mp4 へ直書きする。中間連番が必要だった場合は合成後に必ず削除する。
4. **モデル・HDRI 等のアセット実体を改変しない。** 調整はツマミ（param）の範囲で行う。ライセンス不明のアセットをレシピに同梱しない（[harvest-asset](../harvest-asset/SKILL.md) の規律を継承）。
5. **Blender をユーザー確認なしにインストールしない**（[setup-library/tools-check.md](../setup-library/tools-check.md) と同じ）。
6. **`node packages/schemas/bin/validate-asset.mjs` を通さずにライブラリ入庫を「検証済み」と報告しない。**

# 契約

正典: [`docs/contract-2026-07-14-3d-bake-recipe.md`](../../docs/contract-2026-07-14-3d-bake-recipe.md)。
レシピ = SSOT（scene.py + param + アセット参照）、ベイク出力 = 再生成可能キャッシュ。
焼いた mp4 は edit.json の通常クリップとして扱う（エンジン・ビューワーは無改修）。

# 1. Blender の探索

```sh
BLENDER="${AKARI_BLENDER_BIN:-}"
[ -z "$BLENDER" ] && BLENDER="$(command -v blender || true)"
[ -z "$BLENDER" ] && BLENDER="/Applications/Blender.app/Contents/MacOS/Blender"
test -x "$BLENDER" && "$BLENDER" --version | head -1
```

なければ `brew install --cask blender` を提示して止まる（無断実行しない）。

# 2. scene.py の authoring 契約

参照実装: [`assets/3d/vintage-camera-turntable/scene.py`](../../assets/3d/vintage-camera-turntable/scene.py)

- **自己完結**: レシピディレクトリ単体をプロジェクトへコピーしても動くこと。リポ内の他ファイルを import しない。アセットは `os.path.dirname(os.path.abspath(__file__))` 相対で読む
- **引数契約**（`--` 以降を argparse で受ける）:
  `--out <path>.mp4` / `--profile draft|final` / `--fps N` / `--frame-start N` / `--frame-end N` / `--set key=value`（複数可）
- **PARAM_DEFAULTS 辞書 = meta.json の knobs と 1:1**。未宣言キーの `--set` はエラーにする
- **時間はフレーム番号の純関数**。アニメーションはドライバの安全式サブセット（`frame` 変数 + 算術）または線形キーフレームで表現し、wall-clock を使わない
- **profile は品質 2 段**: draft = EEVEE 低解像度（ツマミ調整の反復用）/ final = 出力解像度。同じ scene.py が両方を通る
- **Blender 5.x API 注意**（5.1.2 実測）: エンジン ID は `BLENDER_EEVEE`（`_NEXT` は廃止）。動画出力は `image_settings.media_type = "VIDEO"` を先に立ててから `file_format = "FFMPEG"`（4.x に media_type は無いので hasattr で分岐）
- 出力名へ Blender がフレーム範囲を付けるケースに備え、レンダー後に `--out` の名前へ正規化する（参照実装の `render()` を踏襲）

# 3. ベイク実行

```sh
"$BLENDER" -b -P scene.py -- \
  --out bakes/<id>-draft.mp4 --profile draft \
  --fps 30 --frame-start 1 --frame-end 120 \
  --set orbit_start_deg=205
```

- 実測目安（M シリーズ Mac / EEVEE / 720p / 16 samples）: 約 0.5〜0.6 秒/フレーム。draft 4 秒素材 ≒ 1 分
- ベイク出力は `bakes/`（git ignore 済み: `*.mp4`）。消してよい。final はプロジェクト書き出し直前だけ

# 4. 検証（必須）

1. `ffprobe` で解像度・fps・フレーム数が指定と一致することを確認する
2. 先頭・中間・末尾のフレームを `ffmpeg -ss <t> -frames:v 1` で抽出して目視する（構図・ライティング・アニメーションの向き）
3. ライブラリ入庫時は中間フレームから `preview.png` を作り、`node packages/schemas/bin/validate-asset.mjs assets/3d/<id>` を通す

# 5. ライブラリ入庫 / プロジェクト採用

- 入庫基準は素材ライブラリ契約と同じ: シーン構築・ライティング・カメラワークの設計コストが高いレシピだけを入れる
- meta.json は knobs を `param` で宣言し、`requires: ["blender"]`。provenance にアセットの取得元・ライセンス・梱包手順を書く
- プロジェクト採用 = レシピ一式を `<project>/assets/3d/<id>/` へ複製 → params 上書き → ベイク → mp4 を edit.json にクリップ配置。provenance にレシピ id / 版 / params / Blender バージョンを記録する

# よくある間違い

- EEVEE ヘッドレスの動作を検証せず「焼ける」と報告する（GPU 環境依存。必ず実行する）
- `THREE.Clock` 的発想で wall-clock や `random()` に依存したアニメーションを書く
- ツマミを cssVar で宣言する（ベイクレシピは param。cssVar はオーバーレイ素材用）
- fragment.html と scene.py を同じ素材ディレクトリに同居させる（validate-asset.mjs が拒否する）
- .blend にテクスチャをパックして肥大化させる / 連番 EXR を残してディスクを焼く
- draft で確認せずいきなり final を焼いて反復時間を溶かす
