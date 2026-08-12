# 3d-text-extrude（task 2026-08-12-3d-text-extrude）— texts[] extrude モード検証ハーネス

`texts[]` の `mode: "extrude"`（opentype.js の輪郭抽出 → `ExtrudeGeometry` による本物の厚みの
押し出し文字）の決定論・シーク安全・グリフ正当性ゴールデン・プリセット動作・ネットワーク到達ゼロ・
性能を実測する証跡一式。契約 §3.2〜§3.3・§4 に基づく。

## 構成

- `support/fixtures.mjs`: 共通ヘルパー（puppeteer-core 解決・Chrome 検出・projectRoot 生成・
  preview ページ生成・静的サーバ・PNG 読み取り/合成）。**`lib/` という名前にしていない** —
  リポ直下 `.gitignore` は `lib/` を一括除外し許可リストに無い `lib/` はコミットされない
  （`packages/render-cut/evidence/3d-text-flat/lib/` が実際にこの罠でコミットされずに残っている
  ことを本タスクの作業中に発見した。詳細は report.md「契約逸脱」節）
- `support/scenes.mjs`: 副作用のないシーン定義（`frontScene` / `carouselScene`）
- `determinism-seek.mjs`: 決定論（同一入力 2 回書き出し）+ シーク安全（昇順 vs シャッフル順）。
  `carouselScene`（anim: carousel, speed: 1.5）を使う
- `golden.mjs`: グリフ正当性ゴールデン。(a) 正面静止（`frontScene`、「ロ」の穴・「プ」の半濁点
  リング） (b) `carouselScene` frame 6（t=0.6s, ≈0.9rad）の側面厚み (c) `carouselScene` frame 23
  （t=2.3s, ≈3.45rad）の裏面鏡文字、の 3 フレーム
- `presets-smoke.mjs`: 5 プリセット（`none`/`carousel`/`char-chaos`/`flip-wave`/`tumble`）が
  extrude でもそれぞれ動く証跡（各 1 フレーム・非透明ピクセル数を実測）
- `network-zero.mjs`: extrude 経路（opentype の `fetch(textDescriptor.font)`）を書き出しても
  外部リクエストが 0 件であることの実測（`page.on('request')` 観測。font fetch が data: へ
  解決されていることも記録する）
- `perf-fps.mjs`: 8 文字 extrude + carousel のプレビュー fps（契約 §4-7 の 30fps 予算）と
  同シーンの書き出し所要（wall-clock）の両方を実測（タスク指示 6）
- `artifacts/`: 各スクリプトが生成した実測結果 JSON と PNG（`-viewable.png` は不透明背景に
  合成した目視用コピー。判定には使っていない — 判定は透過 PNG の SHA-256 / 非透明ピクセル数
  そのもの）

puppeteer-core はこの worktree の devDependency ではないため、`test-harness/projection-knobs.test.mjs`
や `3d-text-flat` の evidence と同じ流儀でメイン checkout（公開リポ本体の checkout。worktree 実行時は隣接ディレクトリを自動探索）の
`apps/shell/node_modules/puppeteer-core` を読み取り専用で借りる（メイン checkout は無編集）。

## 実測結果サマリ（実行コマンド: `node evidence/3d-text-extrude/<script>.mjs`、cwd は `packages/render-cut/`）

| 項目 | 結果 | 証跡 |
|---|---|---|
| 決定論 | 24 フレーム全て SHA-256 完全一致（2 回書き出し） | `artifacts/determinism-seek-result.json` |
| シーク安全 | 24 時刻全て 昇順/シャッフル順で画素ハッシュ一致 | 同上 |
| ゴールデン（正面・穴） | 「ロ」の穴・「プ」の半濁点リングとも正しく描画（`toShapes(false)` の直接証拠） | `artifacts/golden-front-ro-pu-glyphs-viewable.png` |
| ゴールデン（側面厚み） | 回転中、正面と側面の厚みが同時に見える角度で撮影 | `artifacts/golden-side-thickness-mid-rotation-viewable.png` |
| ゴールデン（裏面鏡文字） | 裏返って文字が鏡文字・読み順反転で見える | `artifacts/golden-back-mirror-viewable.png` |
| 5 プリセットそれぞれの動作 | 全 5 プリセットで非透明ピクセル実測（none=4013px, carousel=4256px, char-chaos=4591px, flip-wave=4096px, tumble=4555px） | `artifacts/presets-smoke-result.json` / `artifacts/preset-*-viewable.png` |
| ネットワーク到達ゼロ | 外部リクエスト 0 件・font fetch は data: へ解決 | `artifacts/network-zero-result.json` |
| 性能（8 文字 extrude + carousel） | 実測 fps は report.md 参照（本開発機は他タスクレーンと共有中で `uptime` 実測 load average 約 30〜36 の重負荷環境） | `artifacts/perf-fps-result.json` |

数値の一次ソースは `artifacts/*.json`。report.md はこれらの実測値を転記したもの。

## 設計判断のメモ（report.md にも記載）

- **layout / anim は flat と完全に同一コードパス**（`resolveTextLayout` / `charBasePosition` /
  `applyTextAnimation` を無変更で共用）。PoC の `extrudeChar` は `pen += advance` で文字送りする
  独自レイアウトだったが、契約の「layout（line/cylinder）は flat と同一コードパスで動くこと」を
  優先し、`layout.spacing` ベースの共通実装へ寄せた（PoC の advance 準拠はグリフ自身の中心寄せ
  ピボット化にのみ採用）。CJK フォントは全角 1em 送りが基本のため、対象テキストでの見た目差は
  ほぼ無い
- **`fillOpacity` ブリッジ**: `applyTextAnimation`（flat と共用）は `node.fillOpacity` へ代入する
  （troika `Text` の実プロパティ）。extrude の pivot（`THREE.Group`）にはこのプロパティが無いため
  `attachFillOpacitySupport` で `material.opacity` へブリッジし、`char-chaos` のちらつきが
  per-char 独立に効くようにした（マテリアルは char ごとに複製）
- **ジオメトリキャッシュは instance スコープ**: `font+char+size+depth+bevelSize+bevelThickness`
  キー（契約は `font+char+size+depth` と例示するが、bevel も実際にジオメトリへ焼き込まれる値の
  ため正しさを優先してキーに含めた）。opentype の `Font` 解析結果と `THREE.Shape[]`
  （輪郭・GPU リソースを持たない）はページ寿命キャッシュ、`ExtrudeGeometry`（GPU リソース）は
  `disposeInstance` の一括 dispose と整合させるため instance ごとに分離している
