// prepack の vendor コピー、配布同梱ゲート、GPL 再配布ゲートが、vendor/ へ入る
// リポジトリ相対パスを同じ prefix 規則で判定するための共有正本。prepack.mjs は
// import 時にコピーを始める副作用モジュールなので、安全に共有できるデータだけを分離した。
// GPL 再配布ゲートは import せずテキストとして配列リテラルを読む。この宣言を
// `export const` + `VENDOR_SOURCES = [` の形とベタ書き文字列のまま保つこと。変数展開・spread・
// 他ファイルからの合成を入れると、安全に検査できないためゲートが fail-closed で落ちる。
export const VENDOR_SOURCES = [
  // catalog/audio 全体を含めると再配布できないライセンスの項目も入る。
  // 参照用の音源は個別に列挙し、新規追加時は配布テストで列挙漏れを検出する。
  'catalog/INDEX.md',
  'catalog/packs.json',
  'catalog/sites',
  'catalog/font',
  'catalog/scene3d',
  'catalog/broll',
  'catalog/browser',
  'catalog/avatars',
  'catalog/audio/candidates.json',
  'catalog/audio/candidates.html',
  'catalog/audio/candidates-legacy.json',
  'catalog/audio/camera-shutter',
  'catalog/audio/corporate-upbeat-bgm',
  'catalog/audio/cozy-lofi-bgm',
  'catalog/audio/dova-syndrome-cheerleaders-bgm',
  'catalog/audio/dova-syndrome-hatena-mark-se',
  'catalog/audio/dova-syndrome-user-manual',
  'catalog/audio/freesound-inspectorj-pencil-writing',
  'catalog/audio/impact-sfx-pack',
  'catalog/audio/maoudamashii-bgm-neorock',
  'catalog/audio/maoudamashii-bgm-piano',
  'catalog/audio/maoudamashii-object-sound-15',
  'catalog/audio/maoudamashii-se-magic-category',
  'catalog/audio/maoudamashii-se-onepoint-category',
  'catalog/audio/maoudamashii-se-system-category',
  'catalog/audio/musmus-hageshii-atsui-upper',
  'catalog/audio/musmus-onomatope-sfx-pack',
  'catalog/audio/musmus-yuttari-honobono',
  'catalog/audio/otologic-motion-pop-sfx-pack',
  'catalog/audio/otologic-sfx-selection',
  'catalog/audio/pocket-se-fail-pack',
  'catalog/audio/soundeffect-lab-ambient-life-pack',
  'catalog/audio/soundeffect-lab-anime-direction-pack',
  'catalog/audio/soundeffect-lab-scene-transition',
  'catalog/audio/soundeffect-lab-ui-signal-pack',
  'catalog/audio/ui-click-sfx-pack',
  'catalog/audio/whoosh-transition',
  'skills',
  'templates/project-default',
  'presets/luts',
  // edit-lint は外部 npm 依存ゼロだが、src から edit-store のビルド済み実装と
  // textanim preset を参照する。既に同梱済みの schemas / audio-library-setup /
  // media-bin と合わせ、CLI の実行時閉包を明示的に揃える。
  'presets/textanim',
  'assets/font/noto-sans-jp/NotoSansJP-Variable.ttf',
  'packages/schemas',
  'packages/i18n',
  // schemas の frame-scene 検証器が参照する schema 定義だけを同梱する。
  'packages/frame-scene/src/schema.mjs',
  // schemas の asset / kit 検証は runtimes.mjs を実行し、runtime 宣言は src の
  // レジストリ・ブラウザスクリプトと既定フォントをファイルとして読み込む。
  'packages/overlay-runtime/runtimes.mjs',
  'packages/overlay-runtime/src',
  'packages/overlay-runtime/test-harness/fonts/ZenKakuGothicNew-Black.ttf',
  // edit-lint と world-map validator が参照する実行時閉包。
  'packages/render-cut/src/fragment-assets.mjs',
  // The selected render-cut helpers read the render catalog through this sibling module.
  'packages/render-cut/src/i18n.mjs',
  'packages/render-cut/src/render-inputs.mjs',
  'packages/render-cut/src/caption-font.mjs',
  'packages/render-cut/src/html-scan.mjs',
  'packages/render-cut/src/font-cmap.mjs',
  'packages/render-cut/src/fragment-text.mjs',
  'packages/render-cut/src/library-reference.mjs',
  'packages/word-book/src/index.mjs',
  'packages/akari-tools/src/world/invariants.mjs',
  'packages/akari-tools/src/world/normalize.mjs',
  'packages/akari-tools/src/decision-log/i18n.mjs',
  'packages/akari-tools/bin/speakers.mjs',
  'packages/akari-tools/bin/tools.mjs',
  'packages/akari-tools/src/common/main-module.mjs',
  'packages/akari-tools/src/media/common.mjs',
  // bin/tools.mjs の install / status whisper が引く（akari tools install whisper）。
  'packages/akari-tools/src/media/whisper-model.mjs',
  'packages/akari-tools/src/media/whisper-model-candidates.mjs',
  'packages/akari-tools/src/i18n.mjs',
  'packages/akari-tools/package.json',
  // `akari geo terrain` は launcher-assets（npm 配布の vendor）から解決する。
  // 実行に必要な CLI と src/geo だけを追加し、test/ は配布しない。
  'packages/akari-tools/bin/geo.mjs',
  'packages/akari-tools/src/geo',
  'packages/akari-voice/src',
  'packages/akari-voice/package.json',
  // テストは実行時に不要で、分析レポートのテスト専用モジュールを参照するため除外する。
  'packages/project-scaffold/src/index.mjs',
  'packages/project-scaffold/package.json',
  // analysis-report は package.json / README.md を capability source として既に収集する。
  // 実行に必要な CLI と同居必須テンプレートだけを追加し、test/ は配布しない。
  'packages/analysis-report/render-analysis-report.mjs',
  'packages/analysis-report/report-i18n.mjs',
  'packages/analysis-report/template.html',
  // decision-log-report も package.json / README.md は capability source として収集する。
  // 実行に必要な CLI と同居必須テンプレートだけを追加し、test/ は配布しない。
  'packages/decision-log-report/render-decision-log-report.mjs',
  'packages/decision-log-report/template.html',
  'packages/edit-lint/bin',
  'packages/edit-lint/src',
  'packages/edit-store/lib',
  // 作品言語の共有解決関数。後続の CLI とスキルが同じ実装を参照する。
  'packages/content-language',
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
