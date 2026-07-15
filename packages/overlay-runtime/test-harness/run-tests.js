// mount / tick / interaction 初期化 / minimap.update の動作確認スクリプト。
// #harness-log への出力 + console.log の両方に結果を残す（スクショ or
// コンソールログのどちらでも証跡になるように）。完了後は
// document.body.dataset.testStatus に "pass" / "fail" を立てる
// （Playwright 等の自動確認がここを見て判定できる）。
(async function runHarness() {
  const logEl = document.getElementById("harness-log");
  const lines = [];

  function print(line) {
    lines.push(line);
    logEl.textContent = lines.join("\n");
    console.log("[run-tests]", line);
  }

  function assert(condition, message) {
    if (!condition) throw new Error("assertion failed: " + message);
    print("OK   " + message);
  }

  try {
    print("=== overlay-runtime test-harness ===");

    assert(
      typeof window.akari?.runtime?.mount === "function",
      "overlay-runtime.js が window.akari.runtime.mount を公開している"
    );
    assert(
      typeof window.akari?.runtime?.tick === "function",
      "overlay-runtime.js が window.akari.runtime.tick を公開している"
    );
    assert(
      typeof window.akari?.interaction?.selftest === "function",
      "interaction.js が window.akari.interaction.selftest を公開している（= リスナー初期化済み）"
    );
    assert(
      typeof window.akari?.minimap?.update === "function" &&
        typeof window.akari?.minimap?.state === "function",
      "minimap.js が window.akari.minimap.update / state を公開している"
    );

    const summary = window.__akariTestHarness.summary;
    const stage = document.getElementById("overlay-stage");

    // ---- 1) mount ----
    await window.akari.runtime.mount(summary);
    const containers = stage.querySelectorAll("[data-overlay-id]");
    assert(
      containers.length === summary.overlays.length,
      `mount(summary): #overlay-stage に ${summary.overlays.length} 件のオーバーレイコンテナが注入された（実際: ${containers.length}）`
    );

    // ---- 2) tick ----
    window.akari.runtime.tick(5, true); // cap-a の可視区間内（0〜20s）
    const capA = stage.querySelector('[data-overlay-id="cap-a"]');
    const capB = stage.querySelector('[data-overlay-id="cap-b"]');
    assert(
      getComputedStyle(capA).visibility === "visible",
      "tick(5, true): cap-a（start=0, duration=20）が visible"
    );
    assert(
      getComputedStyle(capB).visibility === "hidden",
      "tick(5, true): cap-b（start=25, duration=20）は区間外で hidden"
    );

    window.akari.runtime.tick(30, true); // cap-b の可視区間内（25〜45s）
    assert(
      getComputedStyle(capA).visibility === "hidden",
      "tick(30, true): cap-a は区間外で hidden"
    );
    assert(
      getComputedStyle(capB).visibility === "visible",
      "tick(30, true): cap-b が visible"
    );

    // selftest() を走らせるため、選択可能な状態（cap-a 可視）へ戻す
    window.akari.runtime.tick(5, true);
    assert(
      getComputedStyle(capA).visibility === "visible",
      "tick(5, true): selftest 用に cap-a を再度 visible にした"
    );

    // ---- 3) interaction 初期化 + 実際のドラッグ/拡縮操作（selftest） ----
    // interaction.js の selftest() は合成 PointerEvent で
    // 「選択 → 60px ドラッグ → overlayWrite」+「拡縮ハンドル → overlayWrite」を
    // 実行し、CSS 変数の変化とアンカー保持を自己検証する（旧同等の挙動確認）。
    const selftestResult = await window.akari.interaction.selftest();
    print("interaction.selftest() detail: " + selftestResult.detail);
    assert(
      selftestResult.ok === true,
      "interaction.selftest(): 合成ドラッグ + 合成拡縮ドラッグの往復検証が成功（旧同等の挙動）"
    );

    // ---- 4) minimap.update() ----
    window.akari.minimap.update();
    const minimapState = window.akari.minimap.state();
    print("minimap.state(): " + JSON.stringify(minimapState));
    assert(
      Number.isFinite(minimapState.zoom) &&
        minimapState.viewport &&
        ["x", "y", "w", "h"].every((key) => Number.isFinite(minimapState.viewport[key])),
      "minimap.update() / state(): #overlay-stage と #preview-pane の実測から zoom / viewport を計算できた"
    );

    print("");
    print("ALL PASS");
    logEl.dataset.status = "pass";
    document.body.dataset.testStatus = "pass";
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    print("");
    print("FAIL: " + message);
    logEl.dataset.status = "fail";
    document.body.dataset.testStatus = "fail";
    console.error(error);
  }
})();
