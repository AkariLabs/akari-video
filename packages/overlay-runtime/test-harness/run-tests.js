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
    assert(
      capB.querySelector(".box").style.pointerEvents === "",
      "区間外の断片は子孫の当たり判定を未走査（見えている分だけ適用）"
    );
    const capARoot = capA.querySelector(".cap-a-root");
    const capABox = capA.querySelector(".box");
    assert(
      capARoot.style.pointerEvents === "auto" && capABox.style.pointerEvents === "auto",
      'data-akari-hit="catch" の祖先配下は、機械判定で pass の断片ルートでも拾う'
    );
    const capABoxRect = capABox.getBoundingClientRect();
    const capAHit = document.elementFromPoint(
      capABoxRect.left + capABoxRect.width / 2,
      capABoxRect.top + capABoxRect.height / 2
    );
    assert(
      capAHit?.closest?.('[data-akari-hit="catch"]') === capARoot,
      'data-akari-hit="catch": elementFromPoint() が明示範囲の配下を実際に返す'
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
    const capBBox = capB.querySelector(".box");
    assert(
      capBBox.style.pointerEvents === "none",
      'data-akari-hit="pass" は、機械判定で auto の背景・文字要素を素通しにする'
    );
    const capBBoxRect = capBBox.getBoundingClientRect();
    const capBHit = document.elementFromPoint(
      capBBoxRect.left + capBBoxRect.width / 2,
      capBBoxRect.top + capBBoxRect.height / 2
    );
    assert(
      !capBHit?.closest?.("[data-overlay-id]"),
      'data-akari-hit="pass": elementFromPoint() が下のプレビュー面まで素通しする'
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
    assert(
      capFull.style.pointerEvents === "none" &&
        capFull.querySelector(".cap-full-root").style.pointerEvents === "none",
      "ランタイムコンテナと断片の全画面ルートは pointer-events:none"
    );
    assert(
      capFull.querySelector(".plate").style.pointerEvents === "auto",
      "機械判定: 背景と文字を描く plate だけ pointer-events:auto"
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

    // ---- 3d) resize 幾何回帰: 四隅・可逆性・固定アンカー・停止・全画面ラッパー ----
    // 許容誤差は stage-local（出力動画）座標で 0.25px、scale の相対誤差で 1e-6。
    // 実測は全フレームを console / #harness-log / window の配列へ残し、CDP 側からも
    // scale と対角コーナー座標を回収できるようにする。
    const RESIZE_ANCHOR_TOLERANCE_PX = 0.25;
    const RESIZE_SCALE_RELATIVE_TOLERANCE = 1e-6;
    const RESIZE_STATIONARY_TOLERANCE = 1e-9;
    const resizeFrames = [];
    window.__akariResizeRegressionLog = resizeFrames;

    const nextPaint = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
    const oppositeCorner = {
      nw: "se",
      ne: "sw",
      se: "nw",
      sw: "ne",
    };
    const pointAtCorner = (rect, corner) => ({
      x: corner.includes("w") ? rect.left : rect.right,
      y: corner.includes("n") ? rect.top : rect.bottom,
    });
    const stagePoint = (point) =>
      window.akari.interaction.stageLocalPoint(point.x, point.y);
    const clientPoint = (point) => {
      const rect = stage.getBoundingClientRect();
      return {
        x: rect.left + (point.x / stage.clientWidth) * rect.width,
        y: rect.top + (point.y / stage.clientHeight) * rect.height,
      };
    };
    const scaleOf = (container) =>
      Number.parseFloat(container.style.getPropertyValue("--scale")) || 1;
    const transformOf = (container) => ({
      x: Number.parseFloat(container.style.getPropertyValue("--x")),
      y: Number.parseFloat(container.style.getPropertyValue("--y")),
      scale: Number.parseFloat(container.style.getPropertyValue("--scale")),
    });
    const selectedFrame = () =>
      document.querySelector(".akari-interaction-selection-frame");
    const resetTransform = (container) => {
      container.style.setProperty("--x", "0px");
      container.style.setProperty("--y", "0px");
      container.style.setProperty("--scale", "1");
      container.style.setProperty("--rotate", "0deg");
    };
    const selectResizeFixture = async (container, visibleElement) => {
      resetTransform(container);
      const rect = visibleElement.getBoundingClientRect();
      visibleElement.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        })
      );
      await nextPaint();
      assert(
        container.getAttribute("data-akari-interaction-selected") === "true",
        `${container.dataset.overlayId}: resize 回帰用オーバーレイを選択できた`
      );
    };
    const logResizeFrame = (fixture, corner, phase, container, fixedAnchor) => {
      const rect = selectedFrame().getBoundingClientRect();
      const anchorClient = pointAtCorner(rect, oppositeCorner[corner]);
      const anchor = stagePoint(anchorClient);
      const entry = {
        fixture,
        corner,
        phase,
        scale: scaleOf(container),
        anchorX: anchor?.x,
        anchorY: anchor?.y,
        anchorDrift: anchor
          ? Math.hypot(anchor.x - fixedAnchor.x, anchor.y - fixedAnchor.y)
          : NaN,
      };
      resizeFrames.push(entry);
      print(
        `resize-frame ${fixture}/${corner}/${phase}: ` +
          `scale=${entry.scale.toFixed(9)} ` +
          `anchor=(${entry.anchorX.toFixed(6)},${entry.anchorY.toFixed(6)}) ` +
          `drift=${entry.anchorDrift.toFixed(6)}px`
      );
      return entry;
    };

    let resizePointerId = 81000;
    const exerciseCorner = async ({ fixture, container, visibleElement, corner }) => {
      await selectResizeFixture(container, visibleElement);
      const frame = selectedFrame();
      const startRect = frame.getBoundingClientRect();
      const draggedClient = pointAtCorner(startRect, corner);
      const anchorClient = pointAtCorner(startRect, oppositeCorner[corner]);
      const dragged = stagePoint(draggedClient);
      const anchor = stagePoint(anchorClient);
      const startScale = scaleOf(container);
      const outward = {
        x: anchor.x + (dragged.x - anchor.x) * 1.35,
        y: anchor.y + (dragged.y - anchor.y) * 1.35,
      };
      const outwardClient = clientPoint(outward);
      const handle = frame.querySelector(`.akari-interaction-handle.is-${corner}`);
      const pointerId = resizePointerId++;
      const common = {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        shiftKey: true, // 可逆性の検証では resize snap を明示的に無効化
      };
      const dispatch = (type, point, buttons) =>
        handle.dispatchEvent(
          new PointerEvent(type, {
            ...common,
            buttons,
            clientX: point.x,
            clientY: point.y,
          })
        );

      dispatch("pointerdown", draggedClient, 1);
      dispatch("pointermove", outwardClient, 1);
      await nextPaint();
      const outwardFrame = logResizeFrame(fixture, corner, "outward", container, anchor);
      dispatch("pointermove", outwardClient, 1);
      await nextPaint();
      const stoppedFrame = logResizeFrame(fixture, corner, "stopped", container, anchor);
      dispatch("pointermove", draggedClient, 1);
      await nextPaint();
      const returnedFrame = logResizeFrame(fixture, corner, "returned", container, anchor);
      dispatch("pointerup", draggedClient, 0);

      const relativeScaleError =
        Math.abs(returnedFrame.scale - startScale) / Math.max(Math.abs(startScale), 1e-12);
      assert(
        relativeScaleError <= RESIZE_SCALE_RELATIVE_TOLERANCE,
        `${fixture}/${corner}: A→B→A で scale が開始値へ戻る ` +
          `(relative error=${relativeScaleError.toExponential(3)}, limit=${RESIZE_SCALE_RELATIVE_TOLERANCE})`
      );
      assert(
        Math.max(
          outwardFrame.anchorDrift,
          stoppedFrame.anchorDrift,
          returnedFrame.anchorDrift
        ) <= RESIZE_ANCHOR_TOLERANCE_PX,
        `${fixture}/${corner}: 対角コーナーの stage 座標が固定される ` +
          `(limit=${RESIZE_ANCHOR_TOLERANCE_PX}px)`
      );
      assert(
        Math.abs(stoppedFrame.scale - outwardFrame.scale) <=
          RESIZE_STATIONARY_TOLERANCE,
        `${fixture}/${corner}: 同じポインタ位置でフレームを進めても scale が止まる ` +
          `(limit=${RESIZE_STATIONARY_TOLERANCE})`
      );
    };

    const resizeFixtures = [
      {
        id: "resize-regular",
        time: 115,
        visibleSelector: ".resize-regular-root",
      },
      {
        id: "resize-inset-wrapper",
        time: 145,
        visibleSelector: ".resize-inset-plate",
      },
    ];
    for (const fixture of resizeFixtures) {
      window.akari.runtime.tick(fixture.time, true);
      await nextPaint();
      const container = stage.querySelector(`[data-overlay-id="${fixture.id}"]`);
      const visibleElement = container.querySelector(fixture.visibleSelector);
      for (const corner of ["nw", "ne", "se", "sw"]) {
        await exerciseCorner({
          fixture: fixture.id,
          container,
          visibleElement,
          corner,
        });
      }
    }

    // ---- 3e) resize 長時間往復: 片道 10 ステップ x 3 往復 ----
    // 3 イベントだけの A→B→A では見えない、フレームごとの誤差の累積を検査する。
    // 各 pointermove 後の scale / 対角コーナー座標も CDP 回収用ログへ残す。
    window.akari.runtime.tick(145, true);
    await nextPaint();
    const repeatedFixture = stage.querySelector(
      '[data-overlay-id="resize-inset-wrapper"]'
    );
    const repeatedVisible = repeatedFixture.querySelector(".resize-inset-plate");
    await selectResizeFixture(repeatedFixture, repeatedVisible);
    const repeatedFrame = selectedFrame();
    const repeatedStartRect = repeatedFrame.getBoundingClientRect();
    const repeatedDraggedClient = pointAtCorner(repeatedStartRect, "se");
    const repeatedDragged = stagePoint(repeatedDraggedClient);
    const repeatedAnchor = stagePoint(pointAtCorner(repeatedStartRect, "nw"));
    const repeatedStartScale = scaleOf(repeatedFixture);
    const repeatedHandle = repeatedFrame.querySelector(
      ".akari-interaction-handle.is-se"
    );
    const repeatedPointerId = resizePointerId++;
    const repeatedCommon = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: repeatedPointerId,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      shiftKey: true,
    };
    const dispatchRepeated = (type, point, buttons) =>
      repeatedHandle.dispatchEvent(
        new PointerEvent(type, {
          ...repeatedCommon,
          buttons,
          clientX: point.x,
          clientY: point.y,
        })
      );
    const repeatedPointAtScale = (multiplier) =>
      clientPoint({
        x:
          repeatedAnchor.x +
          (repeatedDragged.x - repeatedAnchor.x) * multiplier,
        y:
          repeatedAnchor.y +
          (repeatedDragged.y - repeatedAnchor.y) * multiplier,
      });
    const repeatedLogs = [];
    const repeatedReturnFrames = [];

    dispatchRepeated("pointerdown", repeatedDraggedClient, 1);
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      for (let step = 1; step <= 10; step += 1) {
        const multiplier = 1 + (0.4 * step) / 10;
        dispatchRepeated("pointermove", repeatedPointAtScale(multiplier), 1);
        await nextPaint();
        repeatedLogs.push(
          logResizeFrame(
            "resize-inset-wrapper",
            "se",
            `long-${cycle}-out-${step}`,
            repeatedFixture,
            repeatedAnchor
          )
        );
      }
      for (let step = 1; step <= 10; step += 1) {
        const multiplier = 1.4 - (0.4 * step) / 10;
        dispatchRepeated("pointermove", repeatedPointAtScale(multiplier), 1);
        await nextPaint();
        const entry = logResizeFrame(
          "resize-inset-wrapper",
          "se",
          `long-${cycle}-back-${step}`,
          repeatedFixture,
          repeatedAnchor
        );
        repeatedLogs.push(entry);
        if (step === 10) repeatedReturnFrames.push(entry);
      }
    }
    dispatchRepeated("pointerup", repeatedDraggedClient, 0);

    assert(
      repeatedLogs.length === 60,
      `長時間往復は片道 10 ステップ x 3 往復の全 60 フレームを記録した ` +
        `(actual=${repeatedLogs.length})`
    );
    assert(
      repeatedReturnFrames.every(
        (entry) =>
          Math.abs(entry.scale - repeatedStartScale) /
            Math.max(Math.abs(repeatedStartScale), 1e-12) <=
          RESIZE_SCALE_RELATIVE_TOLERANCE
      ),
      `長時間往復: 3 往復の各帰着点で scale が開始値へ戻る ` +
        `(limit=${RESIZE_SCALE_RELATIVE_TOLERANCE})`
    );
    assert(
      Math.max(...repeatedLogs.map((entry) => entry.anchorDrift)) <=
        RESIZE_ANCHOR_TOLERANCE_PX,
      `長時間往復: 全 60 フレームで対角コーナーの stage 座標が固定される ` +
        `(limit=${RESIZE_ANCHOR_TOLERANCE_PX}px)`
    );

    // ---- 3f) ドラッグ中の transform 外乱 1 フレーム ----
    // 実機のプレビュー再適用・ライブリロード・書き戻しを模して、4 手目の直前だけ
    // container transform を乱す。増分方式はこの外乱を以後の基準へ焼き込むが、
    // pointerdown 時の絶対基準方式なら次の pointermove で正しい幾何へ復帰する。
    await selectResizeFixture(repeatedFixture, repeatedVisible);
    const disturbedFrame = selectedFrame();
    const disturbedStartRect = disturbedFrame.getBoundingClientRect();
    const disturbedDraggedClient = pointAtCorner(disturbedStartRect, "se");
    const disturbedDragged = stagePoint(disturbedDraggedClient);
    const disturbedAnchor = stagePoint(pointAtCorner(disturbedStartRect, "nw"));
    const disturbedStartTransform = transformOf(repeatedFixture);
    const disturbedHandle = disturbedFrame.querySelector(
      ".akari-interaction-handle.is-se"
    );
    const disturbedPointerId = resizePointerId++;
    const disturbedCommon = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: disturbedPointerId,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      shiftKey: true,
    };
    const dispatchDisturbed = (type, point, buttons) =>
      disturbedHandle.dispatchEvent(
        new PointerEvent(type, {
          ...disturbedCommon,
          buttons,
          clientX: point.x,
          clientY: point.y,
        })
      );
    const disturbedPointAtScale = (multiplier) =>
      clientPoint({
        x:
          disturbedAnchor.x +
          (disturbedDragged.x - disturbedAnchor.x) * multiplier,
        y:
          disturbedAnchor.y +
          (disturbedDragged.y - disturbedAnchor.y) * multiplier,
      });
    const disturbedMultipliers = [1.1, 1.2, 1.3, 1.4, 1.3, 1.2, 1.1, 1.0];
    const disturbedLogs = [];

    dispatchDisturbed("pointerdown", disturbedDraggedClient, 1);
    for (let index = 0; index < disturbedMultipliers.length; index += 1) {
      if (index === 3) {
        repeatedFixture.style.setProperty("--x", "40px");
        repeatedFixture.style.setProperty("--scale", "0.7");
        await nextPaint();
      }
      const multiplier = disturbedMultipliers[index];
      dispatchDisturbed("pointermove", disturbedPointAtScale(multiplier), 1);
      await nextPaint();
      disturbedLogs.push(
        logResizeFrame(
          "resize-inset-wrapper",
          "se",
          `disturbance-${index + 1}-k-${multiplier.toFixed(1)}`,
          repeatedFixture,
          disturbedAnchor
        )
      );
    }
    dispatchDisturbed("pointerup", disturbedDraggedClient, 0);

    const disturbedAfterInjection = disturbedLogs.slice(3);
    assert(
      Math.max(
        ...disturbedAfterInjection.map((entry) => entry.anchorDrift)
      ) <= RESIZE_ANCHOR_TOLERANCE_PX,
      `transform 外乱後も対角コーナーの stage 座標が固定される ` +
        `(limit=${RESIZE_ANCHOR_TOLERANCE_PX}px)`
    );
    const disturbedReturnedTransform = transformOf(repeatedFixture);
    assert(
      disturbedReturnedTransform.x === disturbedStartTransform.x &&
        disturbedReturnedTransform.y === disturbedStartTransform.y &&
        disturbedReturnedTransform.scale === disturbedStartTransform.scale,
      `transform 外乱後にポインタを開始位置へ戻すと --x / --y / --scale が ` +
        `pointerdown 時の値へ厳密に戻る ` +
        `(start=${JSON.stringify(disturbedStartTransform)}, ` +
        `actual=${JSON.stringify(disturbedReturnedTransform)})`
    );

    // ---- 3g) stage transform 追従 + cancelResize ----
    // pointerdown 時に保持した stage-local 点へ、ズーム後の新しい client 座標から戻る。
    // ここで scale が変わるなら固定 client 座標へ引き戻している。
    window.akari.runtime.tick(115, true);
    await nextPaint();
    const zoomFixture = stage.querySelector('[data-overlay-id="resize-regular"]');
    const zoomVisible = zoomFixture.querySelector(".resize-regular-root");
    await selectResizeFixture(zoomFixture, zoomVisible);
    const zoomFrame = selectedFrame();
    const zoomStartRect = zoomFrame.getBoundingClientRect();
    const zoomDraggedClient = pointAtCorner(zoomStartRect, "se");
    const zoomDraggedStage = stagePoint(zoomDraggedClient);
    const zoomAnchorStage = stagePoint(pointAtCorner(zoomStartRect, "nw"));
    const zoomHandle = zoomFrame.querySelector(".akari-interaction-handle.is-se");
    const zoomPointerId = resizePointerId++;
    const zoomCommon = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: zoomPointerId,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      shiftKey: true,
    };
    zoomHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        ...zoomCommon,
        buttons: 1,
        clientX: zoomDraggedClient.x,
        clientY: zoomDraggedClient.y,
      })
    );
    stage.style.transform = "translate(90px, 35px) scale(0.8)";
    await nextPaint();
    const transformedStageRect = stage.getBoundingClientRect();
    const sameStagePointClient = {
      x:
        transformedStageRect.left +
        (zoomDraggedStage.x / stage.clientWidth) * transformedStageRect.width,
      y:
        transformedStageRect.top +
        (zoomDraggedStage.y / stage.clientHeight) * transformedStageRect.height,
    };
    zoomHandle.dispatchEvent(
      new PointerEvent("pointermove", {
        ...zoomCommon,
        buttons: 1,
        clientX: sameStagePointClient.x,
        clientY: sameStagePointClient.y,
      })
    );
    await nextPaint();
    const zoomFrameLog = logResizeFrame(
      "resize-regular",
      "se",
      "stage-transform",
      zoomFixture,
      zoomAnchorStage
    );
    assert(
      Math.abs(zoomFrameLog.scale - 1) <= RESIZE_SCALE_RELATIVE_TOLERANCE,
      `stage transform 後も同じ stage-local pointer なら scale は不変 ` +
        `(actual=${zoomFrameLog.scale}, limit=${RESIZE_SCALE_RELATIVE_TOLERANCE})`
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert(
      scaleOf(zoomFixture) === 1 &&
        Number.parseFloat(zoomFixture.style.getPropertyValue("--x")) === 0 &&
        Number.parseFloat(zoomFixture.style.getPropertyValue("--y")) === 0,
      "cancelResize (Escape): pointerdown 時の位置・scale へ正確に復元する"
    );
    stage.style.removeProperty("transform");
    await nextPaint();

    // ---- 3h) resize snap 非回帰 ----
    await selectResizeFixture(zoomFixture, zoomVisible);
    const snapFrame = selectedFrame();
    const snapRect = snapFrame.getBoundingClientRect();
    const snapAnchor = stagePoint(pointAtCorner(snapRect, "nw"));
    const snapDraggedClient = pointAtCorner(snapRect, "se");
    const snapDragged = stagePoint(snapDraggedClient);
    const snapDelta = {
      x: snapDragged.x - snapAnchor.x,
      y: snapDragged.y - snapAnchor.y,
    };
    const xTargets = [
      outputSizeNow.width * 0.05,
      outputSizeNow.width / 2,
      outputSizeNow.width * 0.95,
    ];
    const yTargets = [
      outputSizeNow.height * 0.05,
      outputSizeNow.height / 2,
      outputSizeNow.height * 0.95,
    ];
    const snapCandidates = [
      ...xTargets.map((target) => ({
        axis: "x",
        target,
        scale: (target - snapAnchor.x) / snapDelta.x,
      })),
      ...yTargets.map((target) => ({
        axis: "y",
        target,
        scale: (target - snapAnchor.y) / snapDelta.y,
      })),
    ].filter(
      (candidate) =>
        candidate.scale > 0.3 &&
        candidate.scale < 3.7 &&
        Math.abs(candidate.scale - 1) > 0.08
    );
    assert(snapCandidates.length > 0, "resize snap の到達可能な端/中央ターゲットがある");
    const snapCandidate = snapCandidates[0];
    const snapAxisDelta = snapDelta[snapCandidate.axis];
    const rawScale = snapCandidate.scale + 4 / Math.abs(snapAxisDelta);
    const snapPointer = {
      x: snapAnchor.x + snapDelta.x * rawScale,
      y: snapAnchor.y + snapDelta.y * rawScale,
    };
    const snapPointerClient = clientPoint(snapPointer);
    const snapHandle = snapFrame.querySelector(".akari-interaction-handle.is-se");
    const snapPointerId = resizePointerId++;
    const snapCommon = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: snapPointerId,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      shiftKey: false,
    };
    snapHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        ...snapCommon,
        buttons: 1,
        clientX: snapDraggedClient.x,
        clientY: snapDraggedClient.y,
      })
    );
    snapHandle.dispatchEvent(
      new PointerEvent("pointermove", {
        ...snapCommon,
        buttons: 1,
        clientX: snapPointerClient.x,
        clientY: snapPointerClient.y,
      })
    );
    await nextPaint();
    const snappedRect = selectedFrame().getBoundingClientRect();
    const snappedDragged = stagePoint(pointAtCorner(snappedRect, "se"));
    const snapError = Math.abs(
      snappedDragged[snapCandidate.axis] - snapCandidate.target
    );
    logResizeFrame(
      "resize-regular",
      "se",
      `snap-${snapCandidate.axis}`,
      zoomFixture,
      snapAnchor
    );
    assert(
      snapError <= RESIZE_ANCHOR_TOLERANCE_PX,
      `resize snap: ドラッグ中コーナーが ${snapCandidate.axis} 軸ターゲットへ吸着する ` +
        `(target=${snapCandidate.target}, error=${snapError.toFixed(6)}px, ` +
        `limit=${RESIZE_ANCHOR_TOLERANCE_PX}px)`
    );
    let finishedResizePatch = null;
    let resolveFinishedResize;
    const finishedResizePromise = new Promise((resolve) => {
      resolveFinishedResize = resolve;
    });
    const resizeOverlayWrite = window.akari.engine.overlayWrite;
    window.akari.engine.overlayWrite = (editPath, overlayId, patch) => {
      if (overlayId === "resize-regular" && patch?.transform) {
        finishedResizePatch = patch;
        resolveFinishedResize();
      }
      return resizeOverlayWrite(editPath, overlayId, patch);
    };
    snapHandle.dispatchEvent(
      new PointerEvent("pointerup", {
        ...snapCommon,
        buttons: 0,
        clientX: snapPointerClient.x,
        clientY: snapPointerClient.y,
      })
    );
    await finishedResizePromise;
    window.akari.engine.overlayWrite = resizeOverlayWrite;
    const finishedTransform = finishedResizePatch?.transform;
    assert(
      finishedTransform &&
        Math.abs(finishedTransform.scale - scaleOf(zoomFixture)) <=
          RESIZE_SCALE_RELATIVE_TOLERANCE &&
        Math.abs(
          finishedTransform.x -
            Number.parseFloat(zoomFixture.style.getPropertyValue("--x"))
        ) <= RESIZE_SCALE_RELATIVE_TOLERANCE &&
        Math.abs(
          finishedTransform.y -
            Number.parseFloat(zoomFixture.style.getPropertyValue("--y"))
        ) <= RESIZE_SCALE_RELATIVE_TOLERANCE,
      "finishResize: 固定アンカーで確定した transform と overlayWrite の保存値が一致する"
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
      !savedHtml.includes("contenteditable") &&
        !savedHtml.includes("data-akari-interaction") &&
        !savedHtml.includes("pointer-events"),
      "保存 DOM: contenteditable / data-akari-interaction* / ランタイム注入 pointer-events は書き出し前に剥がされている"
    );
    assert(
      fillEl.getAttribute("contenteditable") !== "true",
      "commitEdit 後: fill 層の contenteditable が解除されている（ライブ DOM 側）"
    );

    // CDP/L1 スクリーンショットの最終画面を resize 対象へ戻し、直近の実測ログが
    // 見える位置までスクロールする（テスト結果そのものは上の数値アサーション）。
    window.akari.runtime.tick(145, true);
    await nextPaint();
    const finalResizeFixture = stage.querySelector(
      '[data-overlay-id="resize-inset-wrapper"]'
    );
    await selectResizeFixture(
      finalResizeFixture,
      finalResizeFixture.querySelector(".resize-inset-plate")
    );

    print("");
    print("ALL PASS");
    logEl.scrollTop = logEl.scrollHeight;
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
