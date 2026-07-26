# @akari-video/bake-layer

旧エンジン（ATF テロップレンダラー）をヘッドレスブラウザ（puppeteer）で実行し、
PNG 連番 → アルファ付き ProRes4444 `.mov` へ焼く bake CLI。
非公開の内部契約（`akari-video-internal`・prerender-rail-and-assets §1.1）の提供側。
`packages/render-cut` はこの CLI の出力（アルファ付き mov）
を消費するだけで、本パッケージには依存しない — インターフェース契約のみで疎結合。

> **fx は 2026-07-22 司令塔裁定でスコープ除外**（オーナー判断「FX は使えないものが多いので
> なしでいい」）。`--kind` はインターフェース契約どおり `telop|fx` を受け付けるが、`fx` は
> 未対応エラーを返すだけの未実装。着手時点の進捗・判明した問題は `vendor/PROVENANCE.md` に記録。

## CLI

```
node bin/bake-layer.mjs --kind telop|fx --preset <id> --params <json> \
  --duration <sec> --size WxH --fps <n> --out <path.mov> [--no-preview-proxy]

node bin/bake-layer.mjs --proxy-only <existing.mov>
```

- `--kind telop`: `catalog/telop/<preset>/template.json`（AtfDoc）を読み、`--params` を
  ATF の `variables` bindings として解決する
- `--kind fx`: 未対応（エラーを返す）
- 出力: `--out` にアルファ付き ProRes4444 `.mov`（`prores_ks -profile:v 4 -pix_fmt yuva444p10le`。
  実際のエンコード結果は環境の ffmpeg 実装依存で `yuva444p12le` になることがあるが、
  いずれもアルファチャンネル付き）
- 通常 bake は既定で alpha VP9 WebM のプレビューサイドカーも生成する。`foo.mov` の場合は
  同じディレクトリの `foo.preview.webm`（`.MOV` 等も同様）。`.mov` 以外の出力名には
  `.preview.webm` をそのまま追記する
- `--no-preview-proxy`: プレビューサイドカーを生成せず、ProRes4444 mov だけを出力する
- `--proxy-only <existing.mov>`: puppeteer とカタログ処理を経由せず、既存 mov から上記命名の
  プレビューサイドカーだけを後追い生成する

> `.preview.webm` は Chromium ビューワーでの**近似表示専用**です。最終書き出しには一切使わず、
> render-cut は従来どおり元の ProRes4444 mov を合成します。

## アーキテクチャ

```
bin/bake-layer.mjs        CLI エントリ（引数パース → browser 起動 → render → encode）
src/browser.mjs             puppeteer セッション（headless Chromium）
src/find-chrome.mjs          Chrome for Testing 実行ファイル解決（pin バージョン未取得でも
                              ~/.cache/puppeteer/chrome/ の既存キャッシュへフォールバック）
src/build-harness.mjs        harness/*.ts を esbuild でブラウザ注入用 IIFE にオンメモリ束ね
src/harness/telop-entry.ts    vendor/telop を呼び、resolve()→drawScene() で canvas 2D に描画
src/render-session.mjs       harness をページへ注入し、フレームごとに PNG data URL を取得
src/catalog.mjs              catalog/telop から本体（template.json）を読む
src/encode.mjs               PNG 連番 → ProRes4444 mov / mov → alpha VP9 preview proxy
vendor/telop/                旧エンジンのソース同梱（vendor/PROVENANCE.md に出所・commit 記録）
scripts/port-telop.mjs        catalog/telop 全件移植スクリプト（再実行可能）
scripts/verify-l2.mjs         L2 検証（代表 telop 3 件を実 bake → アルファ/アニメ実測）
```

## ベンダリング形態の裁定（契約 残裁定 3）

**ソース同梱**（`vendor/`）を採用。理由:

1. 契約の推奨（「公開リポを自己完結にするため」）に合致 — `akari-video` は akari-os から
   構造的に独立したプロダクト（このリポの CLAUDE.md 参照）であり、npm workspace 参照だと
   ビルド時に `akari-os` monorepo への依存が生まれてしまう
2. 移植対象（`src/atf` + `src/render` = 3,950 行）は外部 npm 依存を一切持たない自己完結
   コードで、同梱コストが小さい（8 ファイル）
3. ライセンス上の障害なし — 本リポ運営者の自作物（MIT・第三者条項なし）
4. トレードオフ: 元リポが更新されても自動追従しない（差分は `vendor/PROVENANCE.md` の
   commit 固定値を見て手動で再移植する）。akari-telop は既に安定版（直近更新 2026-07-04）で
   activeな開発は止まっているため、追従コストは低いと判断

## 依存

- `puppeteer`（headless Chromium。`~/.cache/puppeteer/chrome/` の既存キャッシュを利用。
  pin バージョンが未取得でもキャッシュ済み近傍版へ自動フォールバックする）
- `esbuild`（harness バンドル・移植スクリプトの TS 読み込み両方に使用）
