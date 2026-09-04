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

    // ---- 5) P0-R: 多層テキスト断片のミラー同期（data-mirror="text"）----
    window.akari.runtime.tick(85, true); // cap-mirror-stack の可視区間（80〜100s）
    const mirrorContainer = stage.querySelector('[data-overlay-id="cap-mirror-stack"]');
    assert(
      getComputedStyle(mirrorContainer).visibility === "visible",
      "tick(85, true): cap-mirror-stack が visible"
    );

    const fillEl = mirrorContainer.querySelector(".fill");
    const mirrorEls = Array.from(mirrorContainer.querySelectorAll('[data-mirror="text"]'));
    assert(
      mirrorEls.length === 2,
      `フィクスチャの data-mirror="text" 層が 2 件見つかった（実際: ${mirrorEls.length}）`
    );
    assert(
      mirrorEls.every((el) => el.getAttribute("aria-hidden") === "true"),
      "mount(): 全ミラー層に aria-hidden=\"true\" が付与されている（overlay-runtime.js の mount 時一括付与）"
    );

    // 5a) 編集対象の除外: ミラー層（.sh）へ直接ダブルクリックしても、除外されて
    // fill 層側が編集対象になる（textElementAt の bbox フォールバックが
    // data-mirror="text" を除外候補として扱う）。
    const shEl = mirrorContainer.querySelector(".sh");
    const shRect = shEl.getBoundingClientRect();
    shEl.dispatchEvent(
      new MouseEvent("dblclick", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: shRect.left + shRect.width / 2,
        clientY: shRect.top + shRect.height / 2,
      })
    );
    assert(
      fillEl.getAttribute("contenteditable") === "true",
      "ミラー層 (.sh) へのダブルクリックでも fill 層が編集対象になる（ミラー層は canEditText で除外）"
    );
    assert(
      shEl.getAttribute("contenteditable") !== "true",
      "ミラー層 (.sh) 自体は contenteditable にならない"
    );

    // 5b) ライブ同期: 編集層の input で全ミラー層の textContent が即時に揃う。
    fillEl.textContent = "新テキスト";
    fillEl.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));
    assert(
      mirrorEls.every((el) => el.textContent === "新テキスト"),
      "input イベント: 編集層の打ち替えが同一 stack 内の全ミラー層へ即時反映された"
    );

    // 5c) 保存経路: commitEdit の安全網 + overlayWrite へ渡る html に、同期済みの
    // 静的 DOM（テキスト・aria-hidden 込み）が乗っていることを確認する。
    let capturedPatch = null;
    let resolveCapture;
    const capturePromise = new Promise((resolve) => {
      resolveCapture = resolve;
    });
    const originalOverlayWrite = window.akari.engine.overlayWrite;
    window.akari.engine.overlayWrite = (editPath, overlayId, patch) => {
      if (overlayId === "cap-mirror-stack") {
        capturedPatch = { editPath, overlayId, patch };
        resolveCapture();
      }
      return originalOverlayWrite(editPath, overlayId, patch);
    };

    fillEl.blur();
    await capturePromise;
    window.akari.engine.overlayWrite = originalOverlayWrite;

    assert(
      capturedPatch && typeof capturedPatch.patch.html === "string",
      "保存確定 (blur): cap-mirror-stack の overlayWrite が html パッチで呼ばれた"
    );
    const savedHtml = capturedPatch.patch.html;
    const textOccurrences = (savedHtml.match(/新テキスト/g) || []).length;
    assert(
      textOccurrences === 3,
      `保存 DOM: 新テキストが sh/r1/fill の 3 層すべてに乗っている（実際の出現数: ${textOccurrences}）`
    );
    assert(
      savedHtml.includes('aria-hidden="true"'),
      "保存 DOM: ミラー層の aria-hidden=\"true\" が書き出し内容にも残っている"
    );
    assert(
      !savedHtml.includes("contenteditable") && !savedHtml.includes("data-akari-interaction"),
      "保存 DOM: contenteditable / data-akari-interaction* 等の編集用一時属性は書き出し前に剥がされている"
    );
    assert(
      fillEl.getAttribute("contenteditable") !== "true",
      "commitEdit 後: fill 層の contenteditable が解除されている（ライブ DOM 側）"
    );

    // ---- 6) テキスト分割（data-akari-split）----
    // 契約: akari-video-internal contract-2026-08-15-telop-motion-grammar-v0
    assert(
      typeof window.akari?.textSplit?.applyAll === "function",
      "text-split.js が window.akari.textSplit.applyAll を公開している"
    );
    assert(
      window.akari.runtime.version === "0.5.0",
      `runtime.version が 0.5.0（分割対応版）である（実際: ${window.akari.runtime.version}）`
    );

    // 6a) 分割そのもの
    assert(
      typeof window.akari._budoux?.parse === "function",
      "budoux-ja-bundle.js が window.akari._budoux.parse を公開している"
    );
    const seg = window.akari.textSplit.segment("今日はとてもいい天気ですね", "bunsetsu");
    assert(
      seg.join("|") === "今日は|とても|いい|天気ですね",
      `bunsetsu 分割が期待どおり（実際: ${seg.join("|")}）`
    );
    assert(
      window.akari.textSplit.segment("あいう", "chars").length === 3,
      "chars 分割が 1 文字ずつになる"
    );
    assert(
      window.akari.textSplit.segment("a\nb", "lines").length === 2,
      "lines 分割が改行で割れる"
    );

    // 6b) mount() が未分割の断片を分割し、--i を振る
    window.akari.runtime.tick(125, true); // cap-text-split の可視区間（120〜140s）
    const splitContainer = stage.querySelector('[data-overlay-id="cap-text-split"]');
    const lineEl = splitContainer.querySelector(".line");
    const units = Array.from(lineEl.querySelectorAll(".akari-u"));
    assert(
      units.length === 4,
      `mount(): 未分割で出荷された断片が 4 単位へ分割された（実際: ${units.length}）`
    );
    assert(
      units.map((el) => el.style.getPropertyValue("--i").trim()).join(",") === "0,1,2,3",
      "mount(): 各単位へ通し番号 --i が振られている"
    );
    assert(
      lineEl.textContent === "今日はとてもいい天気ですね",
      "分割してもテキスト内容は変わらない"
    );

    // 6c) stagger が CSS だけで効いている（--i × --anim-stagger）
    const delays = units.map((el) => getComputedStyle(el).animationDelay);
    assert(
      delays.join(",") === "0s,0.15s,0.3s,0.45s",
      `animation-delay が calc(--i * 150ms) で段階的（実際: ${delays.join(",")}）`
    );

    // 6d) シーク安全: 同じ時刻へ 2 回シークすると同じ状態になる
    window.akari.runtime.tick(120.4, false);
    const at04 = units.map((el) => Number(getComputedStyle(el).opacity).toFixed(3)).join(",");
    window.akari.runtime.tick(120.9, false);
    window.akari.runtime.tick(120.4, false);
    const at04again = units.map((el) => Number(getComputedStyle(el).opacity).toFixed(3)).join(",");
    assert(at04 === at04again, `シーク決定性: 0.4s→0.9s→0.4s で同一状態（${at04}）`);
    const opacities = at04.split(",").map(Number);
    assert(
      opacities[0] > opacities[1] && opacities[1] > opacities[3],
      `stagger が時間差として現れている（t=0.4s の不透明度: ${at04}）`
    );

    // 6e) 冪等性: 同じ内容へ再適用しても DOM 参照が壊れない
    const firstUnit = units[0];
    window.akari.textSplit.applyAll(splitContainer);
    assert(
      lineEl.querySelector(".akari-u") === firstUnit,
      "applyAll() は同じ分割結果なら DOM を作り直さない（冪等）"
    );

    // 6f) 編集中は畳み、確定で分割し直す
    window.akari.textSplit.collapse(lineEl);
    assert(
      lineEl.querySelectorAll(".akari-u").length === 0 &&
        lineEl.textContent === "今日はとてもいい天気ですね",
      "collapse(): 素のテキストへ畳まれる（contenteditable と span 分割の衝突回避）"
    );
    lineEl.textContent = "明日は雨が降ります";
    window.akari.textSplit.apply(lineEl);
    const reUnits = Array.from(lineEl.querySelectorAll(".akari-u"));
    assert(
      reUnits.length > 1 &&
        reUnits.map((el) => el.style.getPropertyValue("--i").trim()).join(",") ===
          reUnits.map((_, i) => String(i)).join(","),
      `打ち替え後に再分割され --i が振り直される（${reUnits.map((e) => e.textContent).join("|")}）`
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
