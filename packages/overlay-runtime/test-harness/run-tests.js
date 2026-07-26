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

    // ---- 3b) ㉑ 実寸 bbox 化の再現テスト（inset:0 全画面ラッパー + flex 配置）----
    window.akari.runtime.tick(55, true); // cap-full-wrapper のみ可視区間（50〜70s）
    const capFull = stage.querySelector('[data-overlay-id="cap-full-wrapper"]');
    assert(
      getComputedStyle(capFull).visibility === "visible",
      "tick(55, true): cap-full-wrapper（inset:0 ラッパー断片）が visible"
    );

    const plateRect = capFull.querySelector(".plate").getBoundingClientRect();
    const stageRectForFull = stage.getBoundingClientRect();

    // 順序が重要: まず「plate から離れた、ラッパーの中では全画面だが見た目は何も無い」
    // 座標（クリック時点で cap-full-wrapper は一度も選択されていない状態）をクリックし、
    // 選択されないことを確認する。先に選択してしまうと「素の click は非マッチでも
    // 選択解除しない」既存挙動と混ざり、このアサーションが意味を持たなくなるため。
    const emptyClientX = stageRectForFull.left + stageRectForFull.width * 0.7;
    const emptyClientY = stageRectForFull.top + stageRectForFull.height * 0.7;
    assert(
      emptyClientX > plateRect.right || emptyClientY > plateRect.bottom,
      "テスト座標が実際に plate の外側にある（フィクスチャの前提確認）"
    );
    stage.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: emptyClientX,
        clientY: emptyClientY,
      })
    );
    assert(
      capFull.getAttribute("data-akari-interaction-selected") !== "true",
      "plate 実寸外（ラッパーの空白部）クリック: 選択されない（bbox 外クリックは選択されない。" +
        "修正前は fragmentBounds がステージ全体を返すため選択されていた）"
    );

    // 続いて実際の plate 中心をクリックすると、今度は選択される。
    capFull.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: plateRect.left + plateRect.width / 2,
        clientY: plateRect.top + plateRect.height / 2,
      })
    );
    assert(
      capFull.getAttribute("data-akari-interaction-selected") === "true",
      "plate 実寸内クリック: cap-full-wrapper が選択される"
    );

    const selectionFrameEl = document.querySelector(
      ".akari-interaction-selection-frame"
    );
    const frameRect = selectionFrameEl.getBoundingClientRect();
    assert(
      frameRect.width < stageRectForFull.width * 0.5 &&
        frameRect.height < stageRectForFull.height * 0.5,
      `選択枠がステージ全体（${stageRectForFull.width.toFixed(0)}x${stageRectForFull.height.toFixed(0)}）` +
        `ではなく実寸 bbox（実測 ${frameRect.width.toFixed(0)}x${frameRect.height.toFixed(0)}）になっている`
    );

    // clip-path によりネイティブ当たり判定も実寸へ絞られている（"none" のままなら
    // フルコンテナ当たり判定のバグが残っている）。
    assert(
      capFull.style.clipPath !== "" && capFull.style.clipPath !== "none",
      `cap-full-wrapper のヒット領域が clip-path で実寸に絞られている（実測: ${capFull.style.clipPath}）`
    );

    // ---- 3c) ㉒ スナップ統一で追加公開した共有 API の型・基本動作確認 ----
    assert(
      typeof window.akari.interaction.computeSnapCorrection === "function" &&
        typeof window.akari.interaction.stageLocalPoint === "function" &&
        typeof window.akari.interaction.currentDisplayScale === "function" &&
        typeof window.akari.interaction.outputSize === "function" &&
        typeof window.akari.interaction.showSnapGuides === "function" &&
        typeof window.akari.interaction.hideSnapGuides === "function",
      "interaction.js が layers[]/cut/caption 実装向けの共有スナップ API を公開している"
    );

    const outputSizeNow = window.akari.interaction.outputSize();
    const centerSnap = window.akari.interaction.computeSnapCorrection(
      {
        left: outputSizeNow.width / 2 - 3,
        top: 100,
        right: outputSizeNow.width / 2 + 3,
        bottom: 140,
        centerX: outputSizeNow.width / 2 - 3, // 3px だけセンターからずれた bounds
        centerY: 120,
      },
      { x: null, y: null }
    );
    assert(
      centerSnap.x && Math.abs(centerSnap.x.target - outputSizeNow.width / 2) < 0.01,
      `computeSnapCorrection(): 出力幅中央付近の bounds がセンター吸着候補を返す（target=${centerSnap.x?.target}）`
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
