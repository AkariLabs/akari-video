// スタブ実装（本ファイルは test-harness 専用。README.md のホストアダプタ契約に
// 従い、実シェルはこれらを実データ・実 IPC で置き換える）。
//
// overlay-runtime / interaction / minimap は window.akari.state /
// window.akari.engine.overlayWrite / window.akari.stageScale をホスト提供の
// 薄いインターフェースとして読む（自前では定義しない）。ここではその 3 点だけを
// 最小スタブとして用意する。フラグメント HTML は
// packages/schemas/examples/edit-v0-sample/overlays/*.html と同じ「自己完結
// スタイル + CSS 変数」規約に倣う（外部スタイルシートに依存しない）。
window.akari = window.akari || {};

const STUB_SUMMARY = {
  output: { width: 1280, height: 720, fps: 30 },
  overlays: [
    {
      id: "cap-a",
      start: 0,
      duration: 20,
      transform: { x: 0, y: 0, scale: 1, rotate: 0 },
      vars: { "--font-size": "40px", "--color": "#ffffff" },
      html: [
        '<div class="cap-a-root" data-akari-hit="catch" style="position:absolute;left:50%;bottom:15%;transform:translateX(-50%);">',
        "  <style>",
        "    .cap-a-root .box {",
        "      display: inline-block; padding: 12px 28px; border-radius: 10px;",
        "      background: rgba(10, 10, 16, 0.75); color: var(--color);",
        '      font-size: var(--font-size); font-weight: 700; font-family: "Hiragino Sans", sans-serif;',
        "    }",
        "  </style>",
        '  <span class="box">テストハーネス字幕A</span>',
        "</div>",
      ].join("\n"),
    },
    {
      id: "cap-b",
      start: 25,
      duration: 20,
      transform: { x: -160, y: -220, scale: 1.2, rotate: 0 },
      vars: { "--font-size": "32px", "--color": "#ffe08a" },
      html: [
        '<div class="cap-b-root" style="position:absolute;left:50%;bottom:15%;transform:translateX(-50%);">',
        "  <style>",
        "    .cap-b-root .box {",
        "      display: inline-block; padding: 12px 28px; border-radius: 10px;",
        "      background: rgba(10, 10, 16, 0.75); color: var(--color);",
        '      font-size: var(--font-size); font-weight: 700; font-family: "Hiragino Sans", sans-serif;',
        "    }",
        "  </style>",
        '  <span class="box" data-akari-hit="pass">テストハーネス字幕B</span>',
        "</div>",
      ].join("\n"),
    },
    // ㉑ の再現フィクスチャ: 断片ルート自身が inset:0 の全画面ラッパー + flex 配置
    // （overlay-authoring 規約・text-behind-person.md 等の「常套パターン」）。
    // 実際に見える内容（.plate）はステージ左上隅の小さな矩形のみ。
    {
      id: "cap-full-wrapper",
      start: 50,
      duration: 20,
      transform: { x: 0, y: 0, scale: 1, rotate: 0 },
      vars: {},
      html: [
        '<div class="cap-full-root" style="position:absolute;inset:0;display:flex;',
        'align-items:flex-start;justify-content:flex-start;">',
        '  <div class="plate" style="margin:24px;padding:8px 16px;border-radius:6px;',
        'background:rgba(10,10,16,0.75);color:#fff;font-size:20px;font-weight:700;">',
        "コーナーキャプション",
        "  </div>",
        "</div>",
      ].join("\n"),
    },
    // P0-R（overlay-runtime 層ミラー）検証フィクスチャ: lab/telop-rich-css-poc の
    // broadcast-gold-navy を簡略化した多層積み（縁取り 2 層 + fill 層）。
    // ミラー層（sh / r1）は data-mirror="text" を持ち、fill 層だけが編集対象になる。
    {
      id: "cap-mirror-stack",
      start: 80,
      duration: 20,
      transform: { x: 0, y: 0, scale: 1, rotate: 0 },
      vars: {},
      html: [
        '<div class="mirror-root" style="position:absolute;left:50%;top:50%;',
        'transform:translate(-50%,-50%);">',
        "  <style>",
        "    .mirror-root .stack { display:inline-grid; font-weight:800;",
        '      font-family:"Hiragino Sans", sans-serif; font-size:64px; }',
        "    .mirror-root .stack > span { grid-area: 1 / 1; }",
        "    .mirror-root .sh { z-index:1; color:#000; transform:translate(3px,4px); }",
        "    .mirror-root .r1 { z-index:2; color:transparent;",
        "      -webkit-text-stroke: 8px #7a1710; }",
        "    .mirror-root .fill { z-index:3; color:#ffe98a; }",
        "  </style>",
        '  <span class="stack">',
        '    <span class="sh" data-mirror="text">ミラー</span>',
        '    <span class="r1" data-mirror="text">ミラー</span>',
        '    <span class="fill">ミラー</span>',
        "  </span>",
        "</div>",
      ].join("\n"),
    },
    // resize の幾何回帰専用フィクスチャ。通常の実寸ルート型。
    {
      id: "resize-regular",
      start: 110,
      duration: 20,
      transform: { x: 0, y: 0, scale: 1, rotate: 0 },
      vars: {},
      html: [
        '<div class="resize-regular-root" style="position:absolute;left:260px;top:180px;',
        'width:240px;height:120px;padding:12px 20px;box-sizing:border-box;border-radius:8px;',
        'background:#1b4fd8;color:#fff;font-size:28px;font-weight:700;">',
        "通常ルート",
        "</div>",
      ].join("\n"),
    },
    // telop-chapter-tag と同じ「inset:0 の全画面ルート + top/left の内側 anchor」型。
    {
      id: "resize-inset-wrapper",
      start: 140,
      duration: 20,
      transform: { x: 0, y: 0, scale: 1, rotate: 0 },
      vars: {},
      html: [
        '<div class="resize-inset-root" style="position:absolute;inset:0;">',
        '  <div class="resize-inset-anchor" style="position:absolute;top:60px;left:60px;">',
        '    <div class="resize-inset-plate" style="width:260px;height:96px;padding:12px 20px;',
        'box-sizing:border-box;border-radius:8px;background:#7a1710;color:#fff;',
        'font-size:24px;font-weight:700;">全画面ラッパー</div>',
        "  </div>",
        "</div>",
      ].join("\n"),
    },
  ],
};

// window.akari.state: ホストが保持する現在の編集セッション状態。
// interaction.js は editPath（永続化の宛先）と summary.output（安全マージン計算）を読む。
window.akari.state = {
  editPath: "/tmp/overlay-runtime-test-harness/edit.json", // スタブ: 実在しなくてよい
  summary: STUB_SUMMARY,
};

// window.akari.stageScale: プレビュー論理サイズ→表示 px の倍率。
// ハーネスは #overlay-stage を scale(1) 固定で貼り付けるため常に 1 を返す。
window.akari.stageScale = () => 1;

// window.akari.engine.overlayWrite: edit.json への read-modify-write の永続化フック。
// スタブは書き込まず、呼び出しをログして解決するだけ。
window.akari.engine = {
  overlayWrite(editPath, overlayId, patch) {
    console.log("[stub-host] overlayWrite", { editPath, overlayId, patch });
    window.__akariOverlayWrites.push({ editPath, overlayId, patch });
    return Promise.resolve({ ok: true, stub: true });
  },
};

window.__akariOverlayWrites = [];
window.__akariTestHarness = { summary: STUB_SUMMARY };
