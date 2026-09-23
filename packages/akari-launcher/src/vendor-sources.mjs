// prepack の vendor コピー、配布同梱ゲート、GPL 再配布ゲートが、vendor/ へ入る
// リポジトリ相対パスを同じ prefix 規則で判定するための共有正本。prepack.mjs は
// import 時にコピーを始める副作用モジュールなので、安全に共有できるデータだけを分離した。
// GPL 再配布ゲートは import せずテキストとして配列リテラルを読む。この宣言を
// `export const` + `VENDOR_SOURCES = [` の形とベタ書き文字列のまま保つこと。変数展開・spread・
// 他ファイルからの合成を入れると、安全に検査できないためゲートが fail-closed で落ちる。
export const VENDOR_SOURCES = [
  'skills',
  'templates/project-default',
  'presets/luts',
  // edit-lint は外部 npm 依存ゼロだが、src から edit-store のビルド済み実装と
  // textanim preset を参照する。既に同梱済みの schemas / audio-library-setup /
  // media-bin と合わせ、CLI の実行時閉包を明示的に揃える。
  'presets/textanim',
  'assets/font/noto-sans-jp/NotoSansJP-Variable.ttf',
  'packages/schemas',
  // schemas の asset / kit 検証は runtimes.mjs を実行し、runtime 宣言は src の
  // レジストリ・ブラウザスクリプトと既定フォントをファイルとして読み込む。
  'packages/overlay-runtime/runtimes.mjs',
  'packages/overlay-runtime/src',
  'packages/overlay-runtime/test-harness/fonts/ZenKakuGothicNew-Black.ttf',
  // edit-lint と world-map validator が参照する実行時閉包。
  'packages/render-cut/src/fragment-assets.mjs',
  'packages/render-cut/src/render-inputs.mjs',
  'packages/render-cut/src/caption-font.mjs',
  'packages/render-cut/src/html-scan.mjs',
  'packages/render-cut/src/library-reference.mjs',
  'packages/word-book/src/index.mjs',
  'packages/akari-tools/src/world/invariants.mjs',
  'packages/akari-tools/src/world/normalize.mjs',
  'packages/project-scaffold',
  // analysis-report は package.json / README.md を capability source として既に収集する。
  // 実行に必要な CLI と同居必須テンプレートだけを追加し、test/ は配布しない。
  'packages/analysis-report/render-analysis-report.mjs',
  'packages/analysis-report/template.html',
  // decision-log-report も package.json / README.md は capability source として収集する。
  // 実行に必要な CLI と同居必須テンプレートだけを追加し、test/ は配布しない。
  'packages/decision-log-report/render-decision-log-report.mjs',
  'packages/decision-log-report/template.html',
  'packages/edit-lint/bin',
  'packages/edit-lint/src',
  'packages/edit-store/lib',
  // 作業場（creator-root）モジュール。npm 配布時も初回動線（first-run.mjs 経由の
  // 動的 import）が機能するよう同梱する。未同梱の場合は repo-assets.mjs 側で
  // creatorRootModulePath が null になり、現行動作へフォールバックする。
  'packages/creator-root',
  // 公式音源ライブラリ（AKARI Sounds）の一括取得（sounds-setup.mjs / `akari sounds`）。
  // media-bin は fetch スクリプトの preview.png 生成（waveform-preview.mjs）が ffmpeg 解決に
  // 使う。未同梱なら audioFetchScriptPath が null になり、音源セットアップだけスキップされる。
  'packages/audio-library-setup',
  'packages/media-bin',
  // 素材 resolver（`akari assets` — アカウントの素材 = 無料 + 購入済みの一覧・取得）。
  // 未同梱なら assetResolverCliPath が null になり、`akari assets` だけスキップされる
  // （タスク契約 2026-08-09-agent-assets-discovery）。
  'packages/asset-resolver',
  // 履歴に何を入れるかの宣言（history-policy.mjs）。project-scaffold が相対パスで参照するため、
  // vendor ミラーにもモノレポと同じ深さで置く（`vendor/packages/akari-launcher/src/` →
  // `vendor/packages/project-scaffold/src/` から `../../akari-launcher/src/` で解決できる）。
  // 本体の src/ にも同じファイルが入るが、配布物の中で相対パスを 1 本に保つ方を採る。
  'packages/akari-launcher/src/history-policy.mjs'
];
