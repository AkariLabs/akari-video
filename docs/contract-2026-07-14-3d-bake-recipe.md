# 3D ベイクレシピ契約 v0（Blender 経路）

- 日付: 2026-07-14
- 状態: 実装済み（同日の実証ラウンドで全ゲート通過。§実装状態を参照）
- 関連: `contract-2026-07-13-asset-library.md`（meta.json v0 / 入庫基準 / コピーして使う規律）、
  `.claude/skills/overlay-authoring/3d.md`（経路 A の authoring 規約）

## 経路の振り分け（本書の位置づけ）

3D には 2 経路あり、本書は**経路 B（ベイク）**の契約。

| 経路 | 用途 | ランタイム | 契約 |
|---|---|---|---|
| A: Three.js オーバーレイ | 映像の**上に重なる**ライブ 3D（ロゴ回転・VideoTexture スクリーン等） | 透明 WebView（seek hook 等は未実装ゲートあり） | `overlay-authoring/3d.md` |
| B: Blender ベイク | 3D シーンを動かして**映像素材（クリップ）そのもの**を作る | なし（焼いた mp4 は通常素材） | 本書 |

- 判定基準: タイムライン上でクリップ（映像そのもの）として置くなら B。映像の上のオーバーレイ表現なら A
- **B はエンジン無改修**: 焼いた mp4 は edit.json の通常クリップとして既存の preview / export を
  そのまま通る。映像そのものが真実なので WYSIWYG は構造的に成立する
- **エディタ内に 3D シーンオーサリング機能は作らない**（スコープ外）。小さな DCC の自作は
  恒久的な開発負担になる。オーサリングは Blender（bpy スクリプト = エージェントが書く）に寄せる

## 思想: レシピ = SSOT、ベイク = 再生成可能キャッシュ

- **レシピ（`scene.py` + params + アセット参照）が正典**。焼いた映像は派生物
- ベイク出力は再生成可能キャッシュとして扱う。レシピ + params + Blender バージョンが
  provenance に残っていれば、いつ消しても再生成できる
- エージェントは**スクリプトを直接編集**する（ツールコールの積み重ねはしない）。
  edit.json / オーバーレイ HTML と同じ規律をシーン記述にも適用する

## レシピ構造（素材ライブラリ契約 v0 準拠）

```
assets/3d/<id>/
  meta.json          ← knobs は param で宣言（cssVar の代わり）
  scene.py           ← 実体。bpy スクリプト（シーン構築 or .blend 読み込み + param 適用 + レンダー設定）
  *.glb / *.hdr      ← 参照アセット（ライセンス確認のうえコピー。catalog 参照配布の規律に従う）
  preview.png        ← 低解像度ベイクの静止プレビュー（最小 3 点セットの一角）
  preview.mp4        ← 任意。動きが本質のレシピは短尺の動画プレビューを推奨
```

- **実体判定**: `3d` カテゴリの素材は `fragment.html`（経路 A）か `scene.py`（経路 B）の
  どちらかを実体に持つ。両方は持たない
- `requires` に `"blender"` を宣言する（経路 A の `"three.js"` に相当）
- 入庫基準は素材ライブラリ契約と同じ: 「生成コストが高い、または生成不能なものだけ」。
  シーン構築・ライティング・カメラワークの設計コストが高いレシピだけを入れる

## knobs（ツマミ宣言）

- meta.json v0 の knobs 型システム（`text` / `color` / `slider` / `dropdown` / `checkbox` /
  `media`）をそのまま使い、`cssVar` の代わりに **`param`（snake_case）** でスクリプト引数へ
  バインドする

```jsonc
{
  "knobs": [
    { "param": "camera_orbit_deg", "type": "slider", "min": -180, "max": 180, "unit": "deg", "group": "pose", "label": "カメラ周回角" },
    { "param": "hdri_rotation_deg", "type": "slider", "min": 0, "max": 360, "unit": "deg", "group": "light", "label": "環境光の向き" },
    { "param": "body_color", "type": "color", "group": "style", "label": "ボディ色" },
    { "param": "screen_src", "type": "media", "group": "content", "label": "画面に映す動画" }
  ]
}
```

- `scene.py` は**宣言された param 以外の外部入力を持たない**: 環境変数・wall-clock・
  暗黙 seed の乱数・ネットワーク取得を禁止（オーバーレイの wall-clock 禁止と同じ思想）
- schema は `schemas/asset-meta.schema.json` に後方互換で追加（knob は `cssVar` か `param` の
  どちらか一方を必須とする）

## 実行契約（ヘッドレスベイク）

```
blender -b -P scene.py -- \
  --out <path>.mp4 --profile draft|final \
  --fps <fps> --frame-start 1 --frame-end <N> \
  --set camera_orbit_deg=30 --set body_color=#1a1a2e ...
```

- **決定性**: 同じレシピ + 同じ params + 同じ Blender バージョン → 同じ映像。
  乱数は固定 seed。物理・パーティクルは seed 固定またはベイク済みキャッシュを使う
- **品質 2 段**:
  - `draft` = EEVEE + 低解像度（ツマミ調整の反復用。数秒〜数十秒で回す）
  - `final` = 出力解像度（必要なら Cycles）。書き出し直前だけ
  - プロファイルは param ではなく実行フラグ。**同じ scene.py が両方を通る**
    （プレビューは近似・書き出しが正確、と同じ心的モデル）
- fps はプロジェクトの fps に合わせる。時間はフレーム番号の関数として求める

## 容量規律（ディスクを焼かない）

容量を食う真犯人は Blender 本体（約 0.5GB・一回きり）ではなく、連番レンダーとパック .blend。
以下を規律とする:

1. **連番静止画をデフォルトで残さない**。Blender の動画出力または ffmpeg 直結で mp4 へ直書き。
   中間連番が必要な場合（EXR 合成等）も合成後に削除する
2. **.blend にアセットをパックしない**（参照リンク）。アセット実体は素材ディレクトリに 1 つだけ
3. **draft は低解像度・短尺**で回す。フル解像度ベイクは書き出し直前の 1 回
4. ベイク出力は再生成可能キャッシュ（前掲）。ディスクが逼迫したら bakes/ から消してよい

## 使用規律（プロジェクトへの採用）

素材ライブラリ契約の「**コピーして使う。リンクしない**」をレシピにも適用する:

```
<project>/assets/3d/<id>/     ← レシピ一式を複製（scene.py + 参照アセット + meta.json）
  bakes/                      ← ベイク出力（再生成可能・削除可）
    <id>-draft.mp4
    <id>-final.mp4
```

- 採用 = レシピ一式をプロジェクトへ複製 → params 上書き → ベイク → mp4 を edit.json に
  クリップ配置。ライブラリが消えても過去案件が再現できる（自己完結）
- provenance にプロジェクト側で記録: レシピ id / 取得元と版 / 適用 params / Blender バージョン /
  出力プロファイル。これが揃っていれば bakes/ は消してよい
- 編集プレビューは 720p プロキシ第一の既存原則に従う（draft ベイク自体を 720p 以下にすれば
  プロキシ生成は不要）

## 道具としての Blender

- ffmpeg / HyperFrames と同格の「手」（外部 CLI）。**エンジンに組み込まない・バンドルしない**
- setup スキルの道具チェック対象に追加する（未導入なら導入を案内。ffmpeg と同じ扱い）
- bpy スクリプトはテキストなので、エージェントが直接書ける・git で差分管理できる・
  レシピとして配布できる（カタログの参照配布とも整合: scene.py はテキストだから同梱できる。
  重い .glb / .hdr は catalog の `source` 経由で各自取得）

## 実装状態（2026-07-14 実証ラウンドで全ゲート通過）

- [x] `schemas/asset-meta.schema.json` / `scripts/validate-asset.mjs` に knob `param` を
      後方互換で追加（既存 meta.json 12 件の検証通過を確認）
- [x] bake スキル: `.claude/skills/bake-3d/SKILL.md`（scene.py authoring 契約・実行・検証・
      入庫までの手順）
- [x] setup スキルの道具チェックに Blender を追加（条件付き道具。常設 3 道具に影響させない）
- [x] 最初のレシピ: `assets/3d/vintage-camera-turntable/`（catalog の vintage-camera +
      studio-hdri を取得し、glTF 2k を単一 .glb へ梱包。validate-asset.mjs 通過）
- [x] EEVEE ヘッドレス実測（Blender 5.1.2 / macOS / Apple Silicon）: 720p・16 samples で
      約 0.55 秒/フレーム。4 秒素材（120 フレーム）のドラフトが約 66 秒
- 5.x API 注意（実測で確定）: エンジン ID は `BLENDER_EEVEE`（`_NEXT` 廃止）。動画出力は
  `image_settings.media_type = "VIDEO"` を先に立ててから `file_format = "FFMPEG"`
  （4.x に media_type は無いため hasattr で分岐する）

### 残タスク（同日ラウンド 2 で消化）

- [x] final プロファイル実測（1080p / 64 samples）: 約 3.83 秒/フレーム、4 秒素材 = 約 7.7 分
      （draft の約 7 倍）。運用は「ツマミ調整は draft で反復、final は書き出し直前の 1 回」で確定
- [x] プロジェクト採用フロー実戦: レシピ複製 → params 上書き → ベイク → edit.json 配置 →
      構造検証まで通過。mp4 書き出しの実機確認のみ GUI アプリ起動が必要なため未実施（既知ギャップ）
- [x] レシピ 2 本目 `assets/3d/smartphone-mockup/`: media 型ツマミ（`screen_src`）の実証。
      スクリーン面のみ Emission 差し替え、動画差し込み時のフレーム同期も ImageUser 経由で
      frame の純関数（wall-clock 不使用）。取得元は CC0（OpenGameArt）、catalog に
      `modern-smartphone` として取得先索引も追加
