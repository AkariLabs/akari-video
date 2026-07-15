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
        '<div class="cap-a-root" style="position:absolute;left:50%;bottom:15%;transform:translateX(-50%);">',
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
        '  <span class="box">テストハーネス字幕B</span>',
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
    return Promise.resolve({ ok: true, stub: true });
  },
};

window.__akariTestHarness = { summary: STUB_SUMMARY };
