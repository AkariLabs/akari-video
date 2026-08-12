# 3d-text-physics（task 2026-08-12-3d-text-physics）— `physics` 事前シミュレーション検証ハーネス

`physics`（matter-js presim → per-char (x, y, angle) Float32Array バッファ → `draw(localSeconds)`
線形補間 lookup）宣言の決定論・シーク安全・人物シルエット凹み非潰れ・restitution 挙動差・
ネットワーク到達ゼロ・presim 性能を実測する証跡一式。

## 構成

- `shared/fixtures.mjs`: 共通ヘルパー（puppeteer-core 借用解決・Chrome 検出・projectRoot 生成・
  overlay/edit ラッパー・PNG 読み取り/合成・collider 投影 SVG ヘルパー）。**ディレクトリ名を
  `lib/` にしていない**理由は下記「既知の限界」参照
- `shared/scenes.mjs`: 副作用のないシーン定義（`basicFallScene` / `personSilhouetteScene`。
  後者は 34 頂点の腕組みポーズ人型 collider を持つ）
- `vendor-smoke.mjs`: poly-decomp vendor 追加の実機検証。実際に出荷する
  `vendor-3d-text-bundle.js` を headless Chrome へロードし、`Matter.Common.getDecomp()` 登録済み・
  凹多角形が凸包へ潰れないことを bundle 実物で確認する
- `determinism-seek.mjs`: 決定論（同一入力 2 回書き出し）+ シーク安全（昇順 vs シャッフル順）
- `person-silhouette.mjs`: 人物シルエット試験。腕組みポーズの凹多角形 collider へ文字を落とし、
  (a) 脇の凹みへ文字が入り込むフレームを実測で探索・保存、(b) 凸包へ潰れていないこと
  （decomposedPartCount / decomposedArea の実測）を確認する
- `restitution-smoke.mjs`: restitution 0.1 / 0.6 で着地後の跳ね返り高さが変わることの smoke
- `network-zero.mjs`: polygon collider（poly-decomp 経由）を含む physics シーンを書き出しても
  外部リクエストが 0 件であることの実測
- `flat-regression-smoke.mjs`: `texts[]` flat + anim（physics 不使用）の回帰 smoke。既存
  `evidence/3d-text-flat/` ハーネスが実行不能（後述）なため代替として用意した
- `perf.mjs`: presim 性能実測（契約の指示 6。11 文字 × duration 8s × dt 1/120）
- `artifacts/`: 各スクリプトが生成した実測結果 JSON と PNG（`-viewable.png` は不透明背景に
  合成した目視用コピー。判定には使っていない）

## 実測結果サマリ（実行コマンド: `node evidence/3d-text-physics/<script>.mjs`、cwd は `packages/render-cut/`）

| 項目 | 結果 | 証跡 |
|---|---|---|
| poly-decomp vendor 実機検証 | bundle 実物で `decompRegistered=true`・凹多角形分解 `concavityPreserved=true`（U 字フィクスチャ: 凸包面積 16 → 分解後面積 10 で凹みぶん一致） | `artifacts/vendor-smoke-result.json` |
| 決定論 | 24 フレーム全て SHA-256 完全一致（2 回独立書き出し） | `artifacts/determinism-seek-result.json` |
| シーク安全 | 24 時刻すべて昇順/シャッフル順で画素ハッシュ一致 | 同上 |
| 人物シルエット (a) 凹みに文字が入る | seed=22, t=0.1s に char index 6 が左脇の凹み座標域（x≈-0.82, y≈-0.02）へ到達（実測探索で発見。事前に憶測の秒数を決め打ちしていない） | `artifacts/person-silhouette-notch-viewable.png` / `person-silhouette-result.json` |
| 人物シルエット (b) 凸包に潰れていない | 34 頂点の実面積（shoelace）8.4735 と、matter-js が実際に分解した 10 パーツの合計面積が完全一致（凸包に潰れていれば 1 パーツ・面積は外接矩形寄りの過大値になるはず） | 同上 |
| restitution 0.1 vs 0.6 | 着地後の跳ね返り高さが 0.1: 0.0066 / 0.6: 0.0107（比 1.63 倍）。重力が弱く（matter-js 既定 gravity.scale=0.001）絶対量は小さいが、restitution の増減方向どおりに一貫して変化する | `artifacts/restitution-smoke-result.json` |
| ネットワーク到達ゼロ | polygon collider を含む physics シーンで外部リクエスト 0 件・想定外ページエラー 0 件（観測 16 件はすべて file:/data:） | `artifacts/network-zero-result.json` |
| flat 回帰 smoke（代替） | texts[] flat + carousel（physics 不使用）が本タスクの three-runtime.js 変更後も 16 フレーム全て 2 回書き出し一致 | `artifacts/flat-regression-smoke-result.json` |
| presim 性能（契約指示 6: 11 文字 × 8s × dt=1/120） | 5 試行の中央値 13.2ms（範囲 11.1〜20.6ms）。frameCount=961・バッファサイズ 126852 bytes（≈124KiB） | `artifacts/perf-result.json` |

数値の一次ソースは `artifacts/*.json`。report.md はこれらの実測値を転記したもの。

## 実装上の要点（three-runtime.js への波及）

1. **`physics` presim は `loadTexts` 完了後・`contentReady` 判定前に同期実行する**
   （`createInstance` の `.then()` チェーン内）。文字ごとの初期矩形サイズは troika Text
   の `geometry.boundingBox`（sync 完了後に確定）から取る
2. **初期配置の疑似乱数は既存の `seededUnit`（sin ハッシュ）を再利用**した。契約は
   「mulberry32 等の明示シード PRNG」と例示しているが、`seededUnit` は既に本ファイル内で
   per-char アニメ定数表に使われている確立済みの決定論的関数（明示シード・`Math.random`/`Date`
   不使用・`Matter.Common.random` 非依存）であり、新しい PRNG 実装を増やす理由がないため、
   既存関数の再利用を選んだ（judgement call。report.md 参照）
3. **polygon collider の `minimumArea` は明示的に `0` を渡す**必要がある。`Bodies.fromVertices`
   の既定 `minimumArea=10` は、本プロダクトの scene 単位（宣言例のオーダーは概ね 1〜10）では
   分解チャンクを軒並み切り捨て、最悪 `parts=[]` → `fromVertices` が `undefined` を返す
   （vendor 準備中の smoke で実際に踏んだ）。`buildColliderBody` はこれを避けるため
   `0.01, 0`（removeCollinear, minimumArea）を明示している
4. **physics 対象の text エントリは `layout.position`/`layout.rotation` を無視する**（judgement
   call）。physics の `colliders`/`gravity` は「camera/lights と同一の scene 空間」で宣言される
   契約のため、対象文字の group 変換を素通しにして per-char のワールド座標をそのまま
   `node.position`/`node.rotation.z` へ書く方式にした。詳細は report.md §契約逸脱

## 既知の限界

- **`evidence/3d-text-flat/` の既存ハーネスは本タスク着手前から実行不能だった**
  （`determinism-seek.mjs` 等が `./lib/fixtures.mjs` / `./lib/scenes.mjs` を import するが
  この 2 ファイルが worktree に存在しない）。原因はリポジトリ直下 `.gitignore` の 3 行目
  `lib/` パターンが**深さを問わずディレクトリ名 `lib` を無条件除外**するため
  （`packages/edit-store/lib/` 等ごく一部だけが明示的な `!lib/` 例外で復活している）。
  T2 が作業中にこの 2 ファイルを作ったとしても、コミット時に静かに除外されたと推測される
  （`git check-ignore -v packages/render-cut/evidence/3d-text-flat/lib/fixtures.mjs` で
  実測確認）。`evidence/3d-text-flat/` は本タスクのファイル境界上「編集禁止」（所有は
  `overlay-runtime/` と本ディレクトリのみ）のため、復元・修正はしていない。本ハーネスの
  ディレクトリ名を `lib/` ではなく `shared/` にしているのは同じ事故を踏まないため。
  代替として `flat-regression-smoke.mjs` を用意した（上記サマリ参照）
- 実測環境: 開発機が他セッションと共有中の可能性がある。決定論・シーク安全・ネットワークゼロ・
  凸包潰れ判定は値そのもの（SHA-256 一致・座標/面積の実測）で判定しているため負荷の影響を
  受けないが、`perf.mjs` の presim ms 絶対値は環境要因を受けうる（5 試行の範囲を併記した）
- `restitution-smoke.mjs` は絶対的な跳ね返り幅が小さい（matter-js 既定 `gravity.scale=0.001`
  により重力が弱く、着地までの経過が速い）。挙動が変わること自体は比で確認できているが、
  より劇的な視覚差が欲しい場合は `physics.gravity` の絶対値を大きくする等、宣言側の調整が要る
  （ランタイム側の制約ではない）
