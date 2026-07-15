// インタラクション層
// 契約: docs/planning/contract-2026-07-13-m1-m4.md §M3
window.akari = window.akari || {};

window.akari.interaction = (() => {
  const stage = document.getElementById("overlay-stage");
  const dragStartDistance = 3;
  const SNAP_DISTANCE = 8;
  const SNAP_RELEASE_DISTANCE = 12;
  const SAFE_MARGIN_RATIO = 0.05;
  const DEFAULT_OUTPUT_WIDTH = 1280;
  const DEFAULT_OUTPUT_HEIGHT = 720;

  // 舞台は出力動画ピクセルの論理サイズを scale() でペイン内の動画矩形へ貼り付ける。
  // 通常の座標変換は stageLocalPoint() を使い、この倍率は異常系の退避と selftest に使う。
  function stageScaleFactor() {
    const scale = window.akari.stageScale?.();
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  // M3 拡縮ハンドル（ビューワー UI ラウンド §3）: uniform scale のクランプとスナップ。
  // 設計ノート（notes-2026-07-14-viewer-ui-round.md）は 0.2〜4.0 を明記しているが、
  // 実装依頼テキストは 0.2〜5.0 と記載していた。設計ノートを SSOT として 4.0 を採用する
  // （差分として成果報告に明記）。
  const SCALE_MIN = 0.2;
  const SCALE_MAX = 4.0;
  const SCALE_SNAP_TOLERANCE = 0.035; // ±3.5% で等倍にスナップ

  let selectedOverlay = null;
  let selectionFrame = null;
  let selectionTrackingFrame = null;
  let activeDrag = null;
  let activeResize = null;
  let activeEdit = null;
  let selftestOverlayOverride = null;
  let verticalSnapGuide = null;
  let horizontalSnapGuide = null;

  // overlay_write は操作順を保存する。selftest は今回の書き込みをこの記録から待つ。
  let writeTail = Promise.resolve();
  let writeGeneration = 0;
  let lastTransformWrite = null;

  function errorText(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function resultText(result) {
    if (result === undefined) return "undefined";
    if (result === null) return "null";
    if (typeof result === "string") return result;

    try {
      return JSON.stringify(result) ?? String(result);
    } catch {
      return String(result);
    }
  }

  function reportWriteError(kind, overlayId, error) {
    console.error(`${kind} の永続化に失敗しました (${overlayId}):`, error);
  }

  function captureWriteContext() {
    return {
      editPath: window.akari.state?.editPath ?? null,
      engine: window.akari.engine ?? null,
    };
  }

  function enqueueWrite(context, overlayId, patch, kind) {
    const generation = ++writeGeneration;
    const promise = writeTail.then(() => {
      if (!context.editPath) {
        throw new Error("編集中の edit.json がありません");
      }
      if (typeof context.engine?.overlayWrite !== "function") {
        throw new Error("overlayWrite を利用できません");
      }

      return context.engine.overlayWrite(context.editPath, overlayId, patch);
    });

    // 失敗後も後続の操作を流しつつ、呼び出し側には元の成否を返す。
    writeTail = promise.catch(() => undefined);
    promise.catch((error) => reportWriteError(kind, overlayId, error));

    return { generation, overlayId, promise };
  }

  function findOverlayContainer(target) {
    if (!stage || !(target instanceof Node)) return null;

    let element = target instanceof Element ? target : target.parentElement;
    while (element && element !== stage) {
      if (
        element.parentElement === stage &&
        element.hasAttribute("data-overlay-id")
      ) {
        return element;
      }
      element = element.parentElement;
    }

    return null;
  }

  function fragmentBounds(container) {
    const root = fragmentRoot(container);
    if (!root) return null;

    const rootRect = root.getBoundingClientRect();
    if (
      !["NOSCRIPT", "SCRIPT", "STYLE", "TEMPLATE"].includes(root.tagName) &&
      [rootRect.left, rootRect.top, rootRect.right, rootRect.bottom].every(
        Number.isFinite
      ) &&
      rootRect.width > 0 &&
      rootRect.height > 0
    ) {
      return {
        left: rootRect.left,
        top: rootRect.top,
        right: rootRect.right,
        bottom: rootRect.bottom,
        width: rootRect.width,
        height: rootRect.height,
      };
    }

    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    const elements = root.querySelectorAll("*");

    for (const element of elements) {
      if (
        ["NOSCRIPT", "SCRIPT", "STYLE", "TEMPLATE"].includes(element.tagName) ||
        element.closest("[data-akari-interaction]")
      ) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (
        ![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) ||
        rect.width <= 0 ||
        rect.height <= 0
      ) {
        continue;
      }

      left = Math.min(left, rect.left);
      top = Math.min(top, rect.top);
      right = Math.max(right, rect.right);
      bottom = Math.max(bottom, rect.bottom);
    }

    if (![left, top, right, bottom].every(Number.isFinite)) return null;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function outputSize() {
    const output = window.akari.state?.summary?.output;
    const width = Number(output?.width);
    const height = Number(output?.height);
    return {
      width: Number.isFinite(width) && width > 0 ? width : DEFAULT_OUTPUT_WIDTH,
      height:
        Number.isFinite(height) && height > 0 ? height : DEFAULT_OUTPUT_HEIGHT,
    };
  }

  function createSnapGuide(axis) {
    const guide = document.createElement("div");
    guide.className = `akari-interaction-snap-guide is-${axis}`;
    guide.setAttribute("data-akari-interaction", `snap-guide-${axis}`);
    guide.setAttribute("aria-hidden", "true");
    guide.hidden = true;
    return guide;
  }

  function ensureSnapGuides() {
    if (!stage) return null;

    if (
      !verticalSnapGuide?.isConnected ||
      verticalSnapGuide.parentElement !== stage
    ) {
      verticalSnapGuide = createSnapGuide("vertical");
      stage.appendChild(verticalSnapGuide);
    }
    if (
      !horizontalSnapGuide?.isConnected ||
      horizontalSnapGuide.parentElement !== stage
    ) {
      horizontalSnapGuide = createSnapGuide("horizontal");
      stage.appendChild(horizontalSnapGuide);
    }

    return { vertical: verticalSnapGuide, horizontal: horizontalSnapGuide };
  }

  function hideSnapGuides() {
    if (verticalSnapGuide) verticalSnapGuide.hidden = true;
    if (horizontalSnapGuide) horizontalSnapGuide.hidden = true;
  }

  function showSnapGuides(snapX, snapY) {
    if (!snapX && !snapY) {
      hideSnapGuides();
      return;
    }

    const guides = ensureSnapGuides();
    if (!guides) return;

    guides.vertical.hidden = !snapX;
    if (snapX) guides.vertical.style.left = `${snapX.target}px`;

    guides.horizontal.hidden = !snapY;
    if (snapY) guides.horizontal.style.top = `${snapY.target}px`;
  }

  function overlayForEvent(event) {
    const eventTargetOverlay = findOverlayContainer(event.target);
    if (eventTargetOverlay && !isSelectable(eventTargetOverlay)) {
      return eventTargetOverlay;
    }
    if (
      selftestOverlayOverride &&
      eventTargetOverlay === selftestOverlayOverride
    ) {
      return selftestOverlayOverride;
    }
    if (!stage || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return eventTargetOverlay;
    }

    const containers = Array.from(stage.children)
      .filter((element) => element.hasAttribute("data-overlay-id"))
      .reverse();

    for (const container of containers) {
      if (!isSelectable(container)) continue;
      const bounds = fragmentBounds(container);
      if (
        bounds &&
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom
      ) {
        return container;
      }
    }

    // 合成イベントは hit test を経ないため、dispatch 先をフォールバックにする。
    // ただしコンテナは inset:0 で全画面のため、断片ルートの矩形外（見た目上何もない
    // 場所）まで無条件に帰属させると誤選択になる。断片ルートの実際の矩形内に
    // ポインタがある場合のみ帰属させる。
    if (eventTargetOverlay) {
      const root = fragmentRoot(eventTargetOverlay);
      const rootRect = root?.getBoundingClientRect();
      if (
        rootRect &&
        event.clientX >= rootRect.left &&
        event.clientX <= rootRect.right &&
        event.clientY >= rootRect.top &&
        event.clientY <= rootRect.bottom
      ) {
        return eventTargetOverlay;
      }
    }

    return null;
  }

  function firstOverlayContainer() {
    if (!stage) return null;
    return (
      Array.from(stage.children).find((element) =>
        element.hasAttribute("data-overlay-id")
      ) ?? null
    );
  }

  function fragmentRoot(container) {
    return (
      Array.from(container.children).find(
        (element) => !element.hasAttribute("data-akari-interaction")
      ) ?? null
    );
  }

  function isSelectable(container) {
    if (
      !stage ||
      !container ||
      !container.isConnected ||
      container.parentElement !== stage ||
      !container.hasAttribute("data-overlay-id")
    ) {
      return false;
    }

    return getComputedStyle(container).visibility !== "hidden";
  }

  function cssVariableText(container, name) {
    const inlineValue = container.style.getPropertyValue(name).trim();
    if (inlineValue) return inlineValue;
    return getComputedStyle(container).getPropertyValue(name).trim();
  }

  function cssVariableNumber(container, name, fallback) {
    const value = Number.parseFloat(cssVariableText(container, name));
    return Number.isFinite(value) ? value : fallback;
  }

  function readTransform(container) {
    return {
      x: cssVariableNumber(container, "--x", 0),
      y: cssVariableNumber(container, "--y", 0),
      scale: cssVariableNumber(container, "--scale", 1),
      rotate: cssVariableNumber(container, "--rotate", 0),
    };
  }

  function createSelectionFrame() {
    const frame = document.createElement("div");
    frame.className = "akari-interaction-selection-frame";
    frame.setAttribute("data-akari-interaction", "selection-frame");

    for (const corner of ["nw", "ne", "se", "sw"]) {
      const handle = document.createElement("span");
      handle.className = `akari-interaction-handle is-${corner}`;
      handle.setAttribute("data-akari-interaction", "selection-handle");
      handle.setAttribute("aria-hidden", "true");
      frame.appendChild(handle);
    }

    return frame;
  }

  function refreshSelectionFrame() {
    if (!stage || !isSelectable(selectedOverlay)) return;

    const rect = fragmentBounds(selectedOverlay);
    if (!rect) {
      if (selectionFrame) selectionFrame.hidden = true;
      return;
    }

    if (!selectionFrame?.isConnected) {
      selectionFrame = createSelectionFrame();
      // 舞台には scale() が付いており、transform は position:fixed の包含ブロックを
      // 作る（= 舞台内に置くと fixed がクライアント座標でなく舞台基準になり、位置も
      // 大きさも倍率で歪む）。選択枠はクライアント座標の矩形（fragmentBounds）を
      // そのまま使うため、transform を持たない親（ペイン直下）へ置く
      (stage.parentElement ?? stage).appendChild(selectionFrame);
    }

    const usableRect =
      [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) &&
      rect.width > 0 &&
      rect.height > 0;

    selectionFrame.hidden = !usableRect;
    if (!usableRect) return;

    selectionFrame.style.left = `${rect.left}px`;
    selectionFrame.style.top = `${rect.top}px`;
    selectionFrame.style.width = `${rect.width}px`;
    selectionFrame.style.height = `${rect.height}px`;
  }

  function trackSelectionFrame() {
    selectionTrackingFrame = null;
    if (!selectedOverlay) return;
    if (!isSelectable(selectedOverlay)) {
      handleSelectedOverlayUnavailable(selectedOverlay);
      return;
    }

    refreshSelectionFrame();
    selectionTrackingFrame = requestAnimationFrame(trackSelectionFrame);
  }

  function startSelectionTracking() {
    if (selectionTrackingFrame === null) {
      selectionTrackingFrame = requestAnimationFrame(trackSelectionFrame);
    }
  }

  function clearSelection() {
    if (selectionTrackingFrame !== null) {
      cancelAnimationFrame(selectionTrackingFrame);
      selectionTrackingFrame = null;
    }
    selectedOverlay?.removeAttribute("data-akari-interaction-selected");
    selectedOverlay = null;

    selectionFrame?.remove();
    selectionFrame = null;
    hideSnapGuides();
  }

  function handleSelectedOverlayUnavailable(container) {
    if (selectedOverlay !== container) return;

    if (activeDrag?.container === container) cancelDrag();
    if (activeResize?.container === container) cancelResize();
    if (activeEdit?.container === container) void commitEdit();
    clearSelection();
  }

  function selectOverlay(container) {
    if (!isSelectable(container)) return false;

    if (selectedOverlay !== container) {
      clearSelection();
      selectedOverlay = container;
      selectedOverlay.setAttribute("data-akari-interaction-selected", "true");
    }

    refreshSelectionFrame();
    startSelectionTracking();
    return true;
  }

  function releasePointer(drag) {
    try {
      if (drag.container.hasPointerCapture?.(drag.pointerId)) {
        drag.container.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // 合成 PointerEvent では capture 対象として登録されないことがある。
    }
  }

  function cancelDrag() {
    if (!activeDrag) return;

    const drag = activeDrag;
    activeDrag = null;
    drag.container.style.setProperty("--x", `${drag.startX}px`);
    drag.container.style.setProperty("--y", `${drag.startY}px`);
    releasePointer(drag);
    hideSnapGuides();
    refreshSelectionFrame();
  }

  function finishDrag() {
    if (!activeDrag) return null;

    const drag = activeDrag;
    activeDrag = null;
    releasePointer(drag);
    hideSnapGuides();

    if (!drag.moved) return null;

    const transform = readTransform(drag.container);
    const record = enqueueWrite(
      drag.writeContext,
      drag.overlayId,
      { transform },
      "transform"
    );
    lastTransformWrite = record;
    return record;
  }

  // ---- 拡縮ハンドル（M3、ビューワー UI ラウンド §3） ----
  // コンテナは #overlay-stage 直下で inset:0（= ステージ全体を覆う全画面ボックス）
  // であり、断片自体はその内部で任意の位置（画面下部中央の字幕、左上のコーナー
  // キャプション等）に絶対配置される。かつて「コンテナ中心とポインタの距離比」で
  // scale していたが、その「コンテナ中心」は常にステージ中心であり、断片の実際の
  // 見た目の位置とは無関係だった（オーナー実機報告: 左上寄りの断片で拡縮の向き・
  // 原点がずれる）。
  //
  // 修正: 基準を選択中オーバーレイの実表示矩形（fragmentBounds = 断片ルートの実測
  // getBoundingClientRect）にし、ドラッグしているハンドルの対角コーナーをアンカー
  // とする。アンカーからの距離比で次の scale を決める。
  //
  // transform-origin は M2 の既定値（コンテナ中心）から動かさない。描画後アンカー A
  // の中心からのローカルベクトルを V、開始時の translate / scale を T0 / S0 と
  // すると、断片側の回転済みベクトルは (V - T0) / S0。新しい scale S1 でも A を
  // 固定する translate は次式になる（回転は V に既に含まれるため明示計算は不要）。
  //   T1 = V - (S1 / S0) * (V - T0)
  // ドラッグ中もこの T1 を --x/--y へ反映し、保存値だけで同じ見た目を再現する。

  function findHandleElement(target) {
    if (!(target instanceof Element)) return null;
    return target.closest('[data-akari-interaction="selection-handle"]');
  }

  // stageScale のキャッシュ値ではなく、その時点の描画矩形とレイアウト寸法から
  // クライアント座標のアンカーを動画座標へ戻す。ズーム・全画面切替後も stale な
  // 基準矩形を使わないよう、補正が必要になるたびに呼び出す。
  function stageLocalPoint(clientX, clientY) {
    if (!stage) return null;

    const rect = stage.getBoundingClientRect();
    const layoutWidth = stage.clientWidth;
    const layoutHeight = stage.clientHeight;
    if (
      ![clientX, clientY, rect.left, rect.top, rect.width, rect.height].every(
        Number.isFinite
      ) ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      layoutWidth <= 0 ||
      layoutHeight <= 0
    ) {
      return null;
    }

    const scaleX = rect.width / layoutWidth;
    const scaleY = rect.height / layoutHeight;
    if (!(scaleX > 0) || !(scaleY > 0)) return null;

    return {
      x: (clientX - rect.left) / scaleX,
      y: (clientY - rect.top) / scaleY,
      centerX: layoutWidth / 2,
      centerY: layoutHeight / 2,
    };
  }

  function fragmentVideoBounds(container) {
    const rect = fragmentBounds(container);
    if (!rect) return null;

    const topLeft = stageLocalPoint(rect.left, rect.top);
    const bottomRight = stageLocalPoint(rect.right, rect.bottom);
    if (!topLeft || !bottomRight) return null;

    const bounds = {
      left: topLeft.x,
      top: topLeft.y,
      right: bottomRight.x,
      bottom: bottomRight.y,
    };
    if (!Object.values(bounds).every(Number.isFinite)) return null;

    return {
      ...bounds,
      centerX: (bounds.left + bounds.right) / 2,
      centerY: (bounds.top + bounds.bottom) / 2,
    };
  }

  function closestAxisSnap(sources, targets, activeSnap) {
    if (activeSnap) {
      const source = sources[activeSnap.sourceIndex];
      const target = targets[activeSnap.targetIndex];
      const correction = target - source;
      if (
        Number.isFinite(correction) &&
        Math.abs(correction) <= SNAP_RELEASE_DISTANCE
      ) {
        return { ...activeSnap, correction, target };
      }
    }

    let closest = null;
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        const correction = targets[targetIndex] - sources[sourceIndex];
        const distance = Math.abs(correction);
        if (
          distance <= SNAP_DISTANCE &&
          (!closest || distance < Math.abs(closest.correction))
        ) {
          closest = {
            sourceIndex,
            targetIndex,
            correction,
            target: targets[targetIndex],
          };
        }
      }
    }
    return closest;
  }

  function applyDragSnapping(drag, rawX, rawY, disabled) {
    drag.container.style.setProperty("--x", `${rawX}px`);
    drag.container.style.setProperty("--y", `${rawY}px`);

    if (disabled) {
      drag.snapX = null;
      drag.snapY = null;
      hideSnapGuides();
      return;
    }

    const bounds = fragmentVideoBounds(drag.container);
    if (!bounds) {
      drag.snapX = null;
      drag.snapY = null;
      hideSnapGuides();
      return;
    }

    const { width, height } = outputSize();
    const xTargets = [
      width * SAFE_MARGIN_RATIO,
      width / 2,
      width * (1 - SAFE_MARGIN_RATIO),
    ];
    const yTargets = [
      height * SAFE_MARGIN_RATIO,
      height / 2,
      height * (1 - SAFE_MARGIN_RATIO),
    ];

    drag.snapX = closestAxisSnap(
      [bounds.left, bounds.centerX, bounds.right],
      xTargets,
      drag.snapX
    );
    drag.snapY = closestAxisSnap(
      [bounds.top, bounds.centerY, bounds.bottom],
      yTargets,
      drag.snapY
    );

    if (drag.snapX) {
      drag.container.style.setProperty(
        "--x",
        `${rawX + drag.snapX.correction}px`
      );
    }
    if (drag.snapY) {
      drag.container.style.setProperty(
        "--y",
        `${rawY + drag.snapY.correction}px`
      );
    }
    showSnapGuides(drag.snapX, drag.snapY);
  }

  function anchorPreservingTranslate({
    startX,
    startY,
    startScale,
    scale,
    anchorClientX,
    anchorClientY,
  }) {
    if (!Number.isFinite(startScale) || startScale === 0) return null;

    const anchor = stageLocalPoint(anchorClientX, anchorClientY);
    if (!anchor) return null;

    const dx = anchor.x - anchor.centerX;
    const dy = anchor.y - anchor.centerY;
    const scaleRatio = scale / startScale;
    return {
      x: dx - scaleRatio * (dx - startX),
      y: dy - scaleRatio * (dy - startY),
    };
  }

  function handleCorner(handleEl) {
    for (const corner of ["nw", "ne", "se", "sw"]) {
      if (handleEl.classList.contains(`is-${corner}`)) return corner;
    }
    return null;
  }

  // アンカーは「ドラッグしているハンドルの対角コーナー」（例: se ハンドルなら nw）。
  function cornerAnchorPoint(rect, corner) {
    switch (corner) {
      case "nw":
        return { x: rect.right, y: rect.bottom };
      case "ne":
        return { x: rect.left, y: rect.bottom };
      case "se":
        return { x: rect.left, y: rect.top };
      case "sw":
        return { x: rect.right, y: rect.top };
      default:
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
  }

  function clampScale(value) {
    if (!Number.isFinite(value)) return 1;
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
  }

  function releaseResizePointer(resize) {
    try {
      if (resize.handleEl?.hasPointerCapture?.(resize.pointerId)) {
        resize.handleEl.releasePointerCapture(resize.pointerId);
      }
    } catch {
      // 合成 PointerEvent では capture 対象として登録されないことがある。
    }
  }

  function beginResize(event, container, handleEl) {
    if (activeEdit) void commitEdit();

    // 断片の実表示矩形（ステージ全体=コンテナの矩形ではなく、実際に見えている
    // 断片ルートの矩形）を基準にする。取得できない異常系のみコンテナ矩形へ退避。
    const visualRect = fragmentBounds(container) ?? container.getBoundingClientRect();
    const corner = handleCorner(handleEl);
    const anchor = cornerAnchorPoint(visualRect, corner);
    const startDistance = Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y);
    const transform = readTransform(container);

    activeResize = {
      container,
      handleEl,
      overlayId: container.dataset.overlayId ?? "",
      pointerId: event.pointerId,
      corner,
      anchorX: anchor.x,
      anchorY: anchor.y,
      startDistance: startDistance || 1, // 0除算回避（アンカーとハンドルが重なる異常系向け保険）
      startScale: transform.scale,
      startX: transform.x,
      startY: transform.y,
      moved: false,
      writeContext: captureWriteContext(),
    };

    try {
      handleEl.setPointerCapture?.(event.pointerId);
    } catch {
      // 合成 PointerEvent では capture 対象として登録されないことがある。
    }

    if (event.cancelable) event.preventDefault();
  }

  function updateResize(event) {
    const resize = activeResize;
    if (!resize || event.pointerId !== resize.pointerId) return;

    const currentDistance = Math.hypot(
      event.clientX - resize.anchorX,
      event.clientY - resize.anchorY
    );
    if (!Number.isFinite(currentDistance)) return;

    let nextScale = resize.startScale * (currentDistance / resize.startDistance);
    nextScale = clampScale(nextScale);
    if (Math.abs(nextScale - 1) <= SCALE_SNAP_TOLERANCE) nextScale = 1;

    // scale を変える前の描画後アンカーを、その時点の stage 矩形で動画座標へ戻す。
    // 直前フレームの transform を基準に補正するため、resize 中に stage のズームや
    // 全画面状態が変わっても、古いクライアント座標へ引き戻さない。
    const visualRect =
      fragmentBounds(resize.container) ?? resize.container.getBoundingClientRect();
    const visualAnchor = cornerAnchorPoint(visualRect, resize.corner);
    const currentTransform = readTransform(resize.container);
    const translate = anchorPreservingTranslate({
      startX: currentTransform.x,
      startY: currentTransform.y,
      startScale: currentTransform.scale,
      scale: nextScale,
      anchorClientX: visualAnchor.x,
      anchorClientY: visualAnchor.y,
    });
    if (!translate) return;

    resize.moved = true;
    resize.container.style.setProperty("--x", `${translate.x}px`);
    resize.container.style.setProperty("--y", `${translate.y}px`);
    resize.container.style.setProperty("--scale", String(nextScale));

    if (event.cancelable) event.preventDefault();
  }

  function cancelResize() {
    if (!activeResize) return;

    const resize = activeResize;
    activeResize = null;
    resize.container.style.setProperty("--x", `${resize.startX}px`);
    resize.container.style.setProperty("--y", `${resize.startY}px`);
    resize.container.style.setProperty("--scale", String(resize.startScale));
    releaseResizePointer(resize);
    refreshSelectionFrame();
  }

  function finishResize() {
    if (!activeResize) return null;

    const resize = activeResize;
    activeResize = null;
    releaseResizePointer(resize);

    if (!resize.moved) return null;

    const transform = readTransform(resize.container);
    const record = enqueueWrite(
      resize.writeContext,
      resize.overlayId,
      { transform },
      "transform"
    );
    lastTransformWrite = record;
    return record;
  }

  function eventHitsElement(event, element) {
    if (event.target instanceof Node && element.contains(event.target)) {
      return true;
    }

    const rect = element.getBoundingClientRect();
    return (
      Number.isFinite(event.clientX) &&
      Number.isFinite(event.clientY) &&
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  function onPointerDown(event) {
    if (event.button !== 0 || activeDrag || activeResize) return;

    const handleEl = findHandleElement(event.target);
    if (handleEl) {
      if (!isSelectable(selectedOverlay)) return;
      beginResize(event, selectedOverlay, handleEl);
      return;
    }

    const container = overlayForEvent(event);
    if (!isSelectable(container)) return;

    selectOverlay(container);

    if (
      activeEdit?.container === container &&
      eventHitsElement(event, activeEdit.element)
    ) {
      return;
    }

    if (activeEdit) void commitEdit();

    const transform = readTransform(container);
    activeDrag = {
      container,
      overlayId: container.dataset.overlayId ?? "",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startStagePoint: stageLocalPoint(event.clientX, event.clientY),
      startX: transform.x,
      startY: transform.y,
      snapX: null,
      snapY: null,
      moved: false,
      writeContext: captureWriteContext(),
    };
    hideSnapGuides();

    try {
      container.setPointerCapture?.(event.pointerId);
    } catch {
      // synthetic drag は window 側の move/up リスナーで継続する。
    }
  }

  function onPointerMove(event) {
    if (activeResize && event.pointerId === activeResize.pointerId) {
      updateResize(event);
      return;
    }

    const drag = activeDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;

    if (
      !drag.moved &&
      deltaX * deltaX + deltaY * deltaY < dragStartDistance * dragStartDistance
    ) {
      return;
    }

    drag.moved = true;
    // 始点と現在点をその時点の舞台矩形で動画座標へ戻す。ズーム・全画面切替が
    // ドラッグ中に入っても、stale な倍率で --x/--y を計算しない。
    const currentStagePoint = stageLocalPoint(event.clientX, event.clientY);
    const scale = stageScaleFactor();
    const videoDeltaX =
      drag.startStagePoint && currentStagePoint
        ? currentStagePoint.x - drag.startStagePoint.x
        : deltaX / scale;
    const videoDeltaY =
      drag.startStagePoint && currentStagePoint
        ? currentStagePoint.y - drag.startStagePoint.y
        : deltaY / scale;
    applyDragSnapping(
      drag,
      drag.startX + videoDeltaX,
      drag.startY + videoDeltaY,
      event.shiftKey
    );

    if (event.cancelable) event.preventDefault();
  }

  function onPointerUp(event) {
    if (activeResize && event.pointerId === activeResize.pointerId) {
      finishResize();
      return;
    }
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    finishDrag();
  }

  function onPointerCancel(event) {
    if (activeResize && event.pointerId === activeResize.pointerId) {
      cancelResize();
      return;
    }
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    cancelDrag();
  }

  function hasDirectText(element) {
    return Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
    );
  }

  function canEditText(element) {
    if (!(element instanceof HTMLElement) || !hasDirectText(element)) return false;

    return ![
      "INPUT",
      "NOSCRIPT",
      "SCRIPT",
      "STYLE",
      "TEMPLATE",
      "TEXTAREA",
    ].includes(element.tagName);
  }

  function textElementAt(container, event) {
    const root = fragmentRoot(container);
    if (!root) return null;

    let candidate = event.target instanceof Element ? event.target : null;
    while (candidate && candidate !== container) {
      if (root.contains(candidate) && canEditText(candidate)) return candidate;
      if (candidate === root) break;
      candidate = candidate.parentElement;
    }

    // pointer-events:none の断片でも、描画矩形からテキスト要素を見つける。
    const elements = [root, ...root.querySelectorAll("*")];
    for (let index = elements.length - 1; index >= 0; index -= 1) {
      const element = elements[index];
      if (!canEditText(element)) continue;

      const rect = element.getBoundingClientRect();
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        return element;
      }
    }

    return null;
  }

  function restoreAttribute(element, name, hadAttribute, value) {
    if (hadAttribute) {
      element.setAttribute(name, value);
    } else {
      element.removeAttribute(name);
    }
  }

  function serializeFragment(container) {
    const root = fragmentRoot(container);
    if (!root) throw new Error("オーバーレイ断片のルート要素がありません");

    const clone = root.cloneNode(true);
    clone.removeAttribute("data-akari-interaction");
    clone.removeAttribute("data-akari-interaction-editing");
    for (const element of clone.querySelectorAll("[data-akari-interaction]")) {
      element.remove();
    }
    for (const element of clone.querySelectorAll(
      "[data-akari-interaction-editing]"
    )) {
      element.removeAttribute("data-akari-interaction-editing");
    }

    return clone.outerHTML;
  }

  function commitEdit({ blur = true } = {}) {
    if (!activeEdit) return Promise.resolve(undefined);

    const edit = activeEdit;
    activeEdit = null;

    restoreAttribute(
      edit.element,
      "contenteditable",
      edit.hadContentEditable,
      edit.contentEditableValue
    );
    restoreAttribute(
      edit.element,
      "spellcheck",
      edit.hadSpellcheck,
      edit.spellcheckValue
    );
    restoreAttribute(
      edit.element,
      "data-akari-interaction-editing",
      edit.hadEditingMarker,
      edit.editingMarkerValue
    );

    if (blur && document.activeElement === edit.element) edit.element.blur();

    let html;
    try {
      html = serializeFragment(edit.container);
    } catch (error) {
      reportWriteError("html", edit.overlayId, error);
      const failure = Promise.reject(error);
      failure.catch(() => undefined);
      return failure;
    }

    const record = enqueueWrite(
      edit.writeContext,
      edit.overlayId,
      { html },
      "html"
    );
    return record.promise;
  }

  function placeCaretAtEnd(element) {
    const selection = window.getSelection();
    if (!selection) return;

    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function beginEdit(container, element) {
    if (activeEdit?.element === element) {
      element.focus({ preventScroll: true });
      return;
    }
    if (activeEdit) void commitEdit();

    activeEdit = {
      container,
      element,
      overlayId: container.dataset.overlayId ?? "",
      hadContentEditable: element.hasAttribute("contenteditable"),
      contentEditableValue: element.getAttribute("contenteditable") ?? "",
      hadSpellcheck: element.hasAttribute("spellcheck"),
      spellcheckValue: element.getAttribute("spellcheck") ?? "",
      hadEditingMarker: element.hasAttribute("data-akari-interaction-editing"),
      editingMarkerValue:
        element.getAttribute("data-akari-interaction-editing") ?? "",
      writeContext: captureWriteContext(),
    };

    element.setAttribute("contenteditable", "true");
    element.setAttribute("spellcheck", "false");
    element.setAttribute("data-akari-interaction-editing", "true");
    element.focus({ preventScroll: true });
    placeCaretAtEnd(element);
  }

  function onClick(event) {
    const container = overlayForEvent(event);
    if (isSelectable(container)) selectOverlay(container);
  }

  function onDoubleClick(event) {
    const container = overlayForEvent(event);
    if (!isSelectable(container)) return;

    const element = textElementAt(container, event);
    if (!element) return;

    selectOverlay(container);
    beginEdit(container, element);
    if (event.cancelable) event.preventDefault();
  }

  function onBlur(event) {
    if (activeEdit && event.target === activeEdit.element) {
      void commitEdit({ blur: false });
    }
  }

  function onKeyDown(event) {
    if (
      event.key === "Enter" &&
      activeEdit &&
      event.target === activeEdit.element &&
      !event.isComposing
    ) {
      event.preventDefault();
      event.stopPropagation();
      void commitEdit();
      return;
    }

    if (
      event.key !== "Escape" ||
      (!selectedOverlay && !activeDrag && !activeResize && !activeEdit)
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (activeDrag) cancelDrag();
    if (activeResize) cancelResize();
    if (activeEdit) void commitEdit();
    clearSelection();
  }

  async function selftest() {
    let container = null;
    let beforeValue = null;
    let beforeText = "n/a";
    let afterText = "n/a";
    let dragWriteResultText = "not-run";
    let resizeWriteResultText = "not-run";
    let resizeDetail = "not-run";
    let resizeSetupTransform = null;
    let resizeWriteCommitted = false;

    try {
      if (!stage) throw new Error("#overlay-stage が見つかりません");
      if (typeof PointerEvent !== "function") {
        throw new Error("PointerEvent を利用できません");
      }
      if (!window.akari.state?.editPath) {
        throw new Error("編集中の edit.json がありません");
      }

      container = firstOverlayContainer();
      if (!container) throw new Error("オーバーレイがありません");
      if (!isSelectable(container)) {
        throw new Error("最初のオーバーレイは表示中ではありません");
      }

      if (activeDrag) cancelDrag();
      if (activeResize) cancelResize();
      if (activeEdit) await commitEdit();
      clearSelection();

      beforeText = cssVariableText(container, "--x") || "(empty)";
      beforeValue = cssVariableNumber(container, "--x", 0);

      const rootRect = fragmentBounds(container);
      const startClientX = Number.isFinite(rootRect?.left)
        ? rootRect.left + rootRect.width / 2
        : 100;
      const startClientY = Number.isFinite(rootRect?.top)
        ? rootRect.top + rootRect.height / 2
        : 100;

      const pointerId = 73013;
      const generationBefore = writeGeneration;
      const dragStageScale = stageScaleFactor();
      const common = {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        shiftKey: true,
      };

      selftestOverlayOverride = container;
      try {
        container.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: startClientX,
            clientY: startClientY,
          })
        );
        if (selectedOverlay !== container) {
          throw new Error("クリックで選択できませんでした");
        }

        container.dispatchEvent(
          new PointerEvent("pointerdown", {
            ...common,
            buttons: 1,
            clientX: startClientX,
            clientY: startClientY,
          })
        );
        container.dispatchEvent(
          new PointerEvent("pointermove", {
            ...common,
            buttons: 1,
            clientX: startClientX + 60,
            clientY: startClientY,
          })
        );
        container.dispatchEvent(
          new PointerEvent("pointerup", {
            ...common,
            buttons: 0,
            clientX: startClientX + 60,
            clientY: startClientY,
          })
        );
      } finally {
        selftestOverlayOverride = null;
        if (activeDrag?.container === container) cancelDrag();
      }

      const write = lastTransformWrite;
      if (
        !write ||
        write.generation <= generationBefore ||
        write.overlayId !== container.dataset.overlayId
      ) {
        throw new Error("ドラッグの overlayWrite が開始されませんでした");
      }

      try {
        const result = await write.promise;
        dragWriteResultText = resultText(result);
      } catch (error) {
        dragWriteResultText = `rejected(${errorText(error)})`;
        throw error;
      }

      afterText = cssVariableText(container, "--x") || "(empty)";
      const afterValue = cssVariableNumber(container, "--x", 0);
      const movedBy = afterValue - beforeValue;
      // クライアント +60px のドラッグは、動画座標では 60 ÷ 舞台倍率 px の移動になる
      const expectedMove = 60 / dragStageScale;
      const dragOk = Math.abs(movedBy - expectedMove) < 0.001;

      // 既定サンプルの scale=1 だけでは開始倍率の除算漏れを検出できないため、
      // 実際の PointerEvent resize は明示的に非等倍から開始する。
      resizeSetupTransform = readTransform(container);
      container.style.setProperty("--scale", "1.5");
      refreshSelectionFrame();

      const resizeBeforeRect = fragmentBounds(container);
      if (
        !resizeBeforeRect ||
        ![
          resizeBeforeRect.left,
          resizeBeforeRect.top,
          resizeBeforeRect.right,
          resizeBeforeRect.bottom,
          resizeBeforeRect.width,
          resizeBeforeRect.height,
        ].every(Number.isFinite) ||
        resizeBeforeRect.width <= 0 ||
        resizeBeforeRect.height <= 0
      ) {
        throw new Error("拡縮前の断片矩形を取得できませんでした");
      }

      const resizeHandle = selectionFrame?.querySelector(
        ".akari-interaction-handle.is-se"
      );
      if (!(resizeHandle instanceof HTMLElement)) {
        throw new Error("se 拡縮ハンドルが見つかりません");
      }

      const resizeStartScale = cssVariableNumber(container, "--scale", 1);
      const resizeStartClientX = resizeBeforeRect.right;
      const resizeStartClientY = resizeBeforeRect.bottom;
      const anchorBeforeX = resizeBeforeRect.left;
      const anchorBeforeY = resizeBeforeRect.top;
      const resizePointerId = 73014;
      const resizeGenerationBefore = writeGeneration;
      const resizeCommon = {
        ...common,
        pointerId: resizePointerId,
      };

      try {
        resizeHandle.dispatchEvent(
          new PointerEvent("pointerdown", {
            ...resizeCommon,
            buttons: 1,
            clientX: resizeStartClientX,
            clientY: resizeStartClientY,
          })
        );
        resizeHandle.dispatchEvent(
          new PointerEvent("pointermove", {
            ...resizeCommon,
            buttons: 1,
            clientX: resizeStartClientX + 40,
            clientY: resizeStartClientY + 40,
          })
        );
        resizeHandle.dispatchEvent(
          new PointerEvent("pointerup", {
            ...resizeCommon,
            buttons: 0,
            clientX: resizeStartClientX + 40,
            clientY: resizeStartClientY + 40,
          })
        );
      } finally {
        if (activeResize?.container === container) cancelResize();
      }

      const resizeWrite = lastTransformWrite;
      if (
        !resizeWrite ||
        resizeWrite.generation <= resizeGenerationBefore ||
        resizeWrite.overlayId !== container.dataset.overlayId
      ) {
        throw new Error("拡縮の overlayWrite が開始されませんでした");
      }

      try {
        const result = await resizeWrite.promise;
        resizeWriteResultText = resultText(result);
        resizeWriteCommitted = true;
      } catch (error) {
        resizeWriteResultText = `rejected(${errorText(error)})`;
        throw error;
      }

      const resizeStartDistance = Math.hypot(
        resizeStartClientX - anchorBeforeX,
        resizeStartClientY - anchorBeforeY
      );
      const resizeEndDistance = Math.hypot(
        resizeStartClientX + 40 - anchorBeforeX,
        resizeStartClientY + 40 - anchorBeforeY
      );
      let expectedScale = clampScale(
        resizeStartScale * (resizeEndDistance / resizeStartDistance)
      );
      if (Math.abs(expectedScale - 1) <= SCALE_SNAP_TOLERANCE) {
        expectedScale = 1;
      }

      const actualScale = cssVariableNumber(container, "--scale", NaN);
      const resizeAfterRect = fragmentBounds(container);
      if (!resizeAfterRect) {
        throw new Error("拡縮後の断片矩形を取得できませんでした");
      }
      const anchorDrift = Math.hypot(
        resizeAfterRect.left - anchorBeforeX,
        resizeAfterRect.top - anchorBeforeY
      );
      const scaleOk =
        Number.isFinite(actualScale) &&
        Math.abs(actualScale - expectedScale) < 0.001;
      const anchorOk = Number.isFinite(anchorDrift) && anchorDrift < 1;
      const resizeOk = scaleOk && anchorOk;
      resizeDetail =
        `--scale: ${resizeStartScale} -> ${actualScale} ` +
        `(expected ${expectedScale}); nw drift: ${anchorDrift}px; ` +
        `overlayWrite: ${resizeWriteResultText}`;

      const ok = dragOk && resizeOk;
      const detail =
        `--x: ${beforeText} -> ${afterText}; ` +
        `moved: ${movedBy}px (expected ${expectedMove}px); ` +
        `overlayWrite: ${dragWriteResultText}; resize: ${resizeDetail}`;

      return { ok, detail };
    } catch (error) {
      selftestOverlayOverride = null;
      if (activeDrag?.container === container) cancelDrag();
      if (activeResize?.container === container) cancelResize();
      if (container && resizeSetupTransform && !resizeWriteCommitted) {
        container.style.setProperty("--x", `${resizeSetupTransform.x}px`);
        container.style.setProperty("--y", `${resizeSetupTransform.y}px`);
        container.style.setProperty("--scale", String(resizeSetupTransform.scale));
        container.style.setProperty("--rotate", `${resizeSetupTransform.rotate}deg`);
        refreshSelectionFrame();
      }
      if (container) {
        afterText = cssVariableText(container, "--x") || "(empty)";
      }
      return {
        ok: false,
        detail:
          `--x: ${beforeText} -> ${afterText}; ` +
          `drag overlayWrite: ${dragWriteResultText}; ` +
          `resize: ${resizeDetail}; ` +
          `resize overlayWrite: ${resizeWriteResultText}; ` +
          `error: ${errorText(error)}`,
      };
    }
  }

  // リスナーの付け先は stage 自体ではなく「stage と選択枠（#preview-pane 直下に
  // 移設済み）の共通祖先」にする。選択枠の拡縮ハンドルは舞台の外にあるため、
  // stage にしかリスナーが無いと捕捉フェーズが舞台を経由せずハンドル上の
  // pointerdown が拾えない（本日の実機回帰: 拡縮ハンドルが効かない）。
  // ハンドラ内部は findOverlayContainer / findHandleElement で対象を絞っている
  // ため、祖先を広げても pane 直下の他要素（#drop-hint 等）への誤発火は無い
  // （#drop-hint は動画ロード後 display:none で hit-test から外れる）。
  const listenerRoot = stage?.parentElement ?? document;

  listenerRoot.addEventListener("click", onClick, true);
  listenerRoot.addEventListener("pointerdown", onPointerDown, true);
  listenerRoot.addEventListener("dblclick", onDoubleClick, true);
  listenerRoot.addEventListener("blur", onBlur, true);
  listenerRoot.addEventListener(
    "dragstart",
    (event) => {
      if (
        activeEdit &&
        event.target instanceof Node &&
        activeEdit.element.contains(event.target)
      ) {
        return;
      }
      if (isSelectable(findOverlayContainer(event.target))) event.preventDefault();
    },
    true
  );

  if (stage) {
    // オーバーレイコンテナの増減監視は舞台限定でよい（選択枠自体は監視不要）。
    new MutationObserver(() => {
      if (selectedOverlay && !isSelectable(selectedOverlay)) {
        handleSelectedOverlayUnavailable(selectedOverlay);
      }
    }).observe(stage, { childList: true });
  }

  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerCancel, true);
  window.addEventListener("keydown", onKeyDown, true);

  return { selftest };
})();
