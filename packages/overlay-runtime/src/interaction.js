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

  // 断片ルートは「inset:0 全画面ラッパー + flex/絶対配置」パターン（overlay-authoring
  // 規約・text-behind-person.md 等）を許容するため、ルート自身の矩形がコンテナ（断片の
  // 親 = [data-overlay-id] 要素。overlay-runtime.js の mount() が inset:0 で全画面付与）
  // をほぼ覆う場合は「ルート＝見た目上の透明な位置決めラッパー」とみなし、可視子孫の
  // union へフォールバックする。マット動画等で子孫側も実際に全画面を占める場合は
  // union も自然に全画面へ収束する（= 見た目どおりで正しい）。
  const FULL_CONTAINER_COVERAGE_RATIO = 0.98;

  function looksLikeFullContainerWrapper(rect, containerRect) {
    if (!containerRect || !(containerRect.width > 0) || !(containerRect.height > 0)) {
      return false;
    }
    return (
      rect.width >= containerRect.width * FULL_CONTAINER_COVERAGE_RATIO &&
      rect.height >= containerRect.height * FULL_CONTAINER_COVERAGE_RATIO
    );
  }

  function fragmentBounds(container) {
    const root = fragmentRoot(container);
    if (!root) return null;

    const rootRect = root.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (
      !["NOSCRIPT", "SCRIPT", "STYLE", "TEMPLATE"].includes(root.tagName) &&
      [rootRect.left, rootRect.top, rootRect.right, rootRect.bottom].every(
        Number.isFinite
      ) &&
      rootRect.width > 0 &&
      rootRect.height > 0 &&
      !looksLikeFullContainerWrapper(rootRect, containerRect)
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

    if (![left, top, right, bottom].every(Number.isFinite)) {
      // 可視子孫が一つも無い（ルート自身が唯一のコンテンツ、かつ全画面ラッパー疑い）
      // 場合、選択そのものを失わせるより「全画面でも」ルート自身の矩形を使う方が実用的。
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
      return null;
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  // ㉑ 素通し: コンテナ（[data-overlay-id]、mount() が inset:0 で全画面付与）は
  // pointer-events:auto のまま、clip-path で「可視コンテンツの実寸 bbox」だけに
  // ネイティブな当たり判定を絞る。clip-path の inset() はコンテナ自身の
  // ローカル（transform 適用前）ボックスに対する割合として解決されるため、コンテナに
  // 掛かる translate/scale/rotate（ここでは非回転のみ対応）は clip 領域にも均一に
  // 適用される。したがって「現在（transform 適用後）のクライアント矩形」同士の比で
  // 割合を求めれば、transform を打ち消して測り直さなくても正しい割合が得られる
  // （非回転の平行移動+一様拡縮は比を保存するため）。回転が乗っている場合は
  // 軸並行 bbox の比が単純な割合にならないため clip を諦め、フルコンテナのまま返す
  // （現行 UI に回転ハンドルは無く到達しない分岐）。
  function computeHitClipPath(container) {
    const transform = readTransform(container);
    const normalizedRotate = ((transform.rotate % 360) + 360) % 360;
    if (normalizedRotate > 0.01 && normalizedRotate < 359.99) return null;

    const containerRect = container.getBoundingClientRect();
    if (!(containerRect.width > 0) || !(containerRect.height > 0)) return null;

    const contentRect = fragmentBounds(container);
    if (!contentRect) return null;

    const top = ((contentRect.top - containerRect.top) / containerRect.height) * 100;
    const right = ((containerRect.right - contentRect.right) / containerRect.width) * 100;
    const bottom = ((containerRect.bottom - contentRect.bottom) / containerRect.height) * 100;
    const left = ((contentRect.left - containerRect.left) / containerRect.width) * 100;
    if (![top, right, bottom, left].every(Number.isFinite)) return null;

    return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
  }

  // mount 直後や表示区間へ入った直後（overlay-runtime.js tick()）、および断片 HTML
  // が変わり得るタイミング（テキスト編集確定）に呼ぶ。ドラッグ/拡縮そのものは
  // transform-invariant な割合のため、その最中は呼び直さなくてよい（性能: 可視化・
  // 内容変化のタイミングだけに限定する運用は overlay-runtime.js 側の既存方針と同じ）。
  function syncOverlayHitRegion(container) {
    if (!container) return;
    const clipPath = computeHitClipPath(container);
    container.style.clipPath = clipPath || "none";
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
      // そのまま使うため、transform を持たない祖先へ置く必要がある。
      // ㉑ 実機で発見・是正: 旧実装は「stage.parentElement」（テストハーネスでは
      // transform 無しの #preview-pane）へ置いていたが、本番シェルでは同じ階層が
      // #zoom-layer（プレビューズーム用に常時 transform: translate() scale() を
      // 持つ — 100% ズームでも scale(1) が設定される）で、これ自体が新たな
      // containing block を作ってしまい選択枠が本来の位置から系統的にズレる
      // （実測: 100% ズームで表示px換算 約36px×46pxの一定オフセット、機能
      // （選択・ドラッグ・拡縮）は fragmentBounds の生値を直接使うため無傷だが
      // 視覚表示だけがズレる）。document.body は transform を持たない保証がある
      // ため、そこへ固定する（listenerRoot 側も同じ理由で document 全体へ広げ済み、
      // ハンドラ内部の対象絞り込みは変更なし = 既存コメントの「祖先を広げても
      // 誤発火は無い」という設計判断のまま）。
      document.body.appendChild(selectionFrame);
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

  // stageLocalPoint() と同じ scaleX（表示px / 出力px）を、単独の倍率として返す。
  // プレビューズーム（#zoom-layer の scale）と #overlay-stage 自身の frameScale の
  // 両方を stage.getBoundingClientRect() が反映済みなので、この一値だけで
  // 「見た目 8px 相当」を出力px単位のしきい値へ正規化できる（M2 のスナップしきい値の
  // ズーム非対応を解消する本実装の核）。
  function currentDisplayScale() {
    if (!stage) return 1;

    const rect = stage.getBoundingClientRect();
    const layoutWidth = stage.clientWidth;
    if (!(rect.width > 0) || !(layoutWidth > 0)) return 1;

    const scale = rect.width / layoutWidth;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
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

  // distance/release のしきい値は「表示px（見た目）」で評価する。sources/targets は
  // 出力px（stage-local）単位のため、比較の直前だけ scale（=currentDisplayScale()）を
  // 掛けて表示px化する。実際に --x/--y へ加える correction 自体は出力px単位のまま
  // （見た目と保存値の両方が正しくなる: M2 ㉒ のズーム非対応解消）。
  function closestAxisSnap(sources, targets, activeSnap, scale) {
    const displayScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

    if (activeSnap) {
      const source = sources[activeSnap.sourceIndex];
      const target = targets[activeSnap.targetIndex];
      const correction = target - source;
      if (
        Number.isFinite(correction) &&
        Math.abs(correction) * displayScale <= SNAP_RELEASE_DISTANCE
      ) {
        return { ...activeSnap, correction, target };
      }
    }

    let closest = null;
    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
        const correction = targets[targetIndex] - sources[sourceIndex];
        const displayDistance = Math.abs(correction) * displayScale;
        if (
          displayDistance <= SNAP_DISTANCE &&
          (!closest || displayDistance < Math.abs(closest.correction) * displayScale)
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

  // キャンバス端（セーフマージン5%）+ センター縦横への吸着候補を、出力px単位の bounds
  // {left,top,right,bottom,centerX,centerY} から計算する。overlays のドラッグに限らず、
  // resize・layers[]・cut/caption のドラッグからも共通で呼べるよう window.akari.interaction
  // 経由でも公開する（㉒ スナップ統一の単一正本）。
  function computeSnapCorrection(bounds, previousSnap) {
    if (!bounds) return { x: null, y: null };

    const { width, height } = outputSize();
    const scale = currentDisplayScale();
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

    const snapX = closestAxisSnap(
      [bounds.left, bounds.centerX, bounds.right],
      xTargets,
      previousSnap?.x ?? null,
      scale
    );
    const snapY = closestAxisSnap(
      [bounds.top, bounds.centerY, bounds.bottom],
      yTargets,
      previousSnap?.y ?? null,
      scale
    );

    return { x: snapX, y: snapY };
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

    const snap = computeSnapCorrection(bounds, { x: drag.snapX, y: drag.snapY });
    drag.snapX = snap.x;
    drag.snapY = snap.y;

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

  // cornerAnchorPoint() の対角（アンカー）ではなく、実際にドラッグしているハンドル
  // 自身のコーナー座標（resize スナップの対象点）。
  function namedCornerPoint(rect, corner) {
    switch (corner) {
      case "nw":
        return { x: rect.left, y: rect.top };
      case "ne":
        return { x: rect.right, y: rect.top };
      case "se":
        return { x: rect.right, y: rect.bottom };
      case "sw":
        return { x: rect.left, y: rect.bottom };
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
      snapX: null,
      snapY: null,
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

  // resize 中に、ドラッグしているハンドル自身のコーナーをキャンバス端/センターへ吸着
  // させる（㉒: これまで resize には位置スナップが皆無だった）。
  //
  // 幾何: transform-origin はコンテナ中心 C（stage-local）固定・アンカー（対角コーナー）
  // は anchorPreservingTranslate() により scale が変わっても世界座標で不動に保たれる。
  // このときアンカー A・ドラッグ中コーナー D は同一 scale S の下で
  //   D(S) = A + S * (Dlocal - Alocal)
  // という S の一次式になる（A・(Dlocal-Alocal) は S に依存しない定数）。よって、
  // 現在の scale での実測 D(scale) と A から (Dlocal-Alocal) を逆算でき、
  // 目標位置 target に一致させる scale は
  //   S_snap = (target - A) * scale / (D(scale) - A)
  // で閉じた形に解ける（軸ごとに独立、uniform scale なので一度に1軸のみ採用）。
  function applyResizeSnap(resize, scale) {
    if (!(Math.abs(scale) > 1e-6)) return null;

    const anchor = stageLocalPoint(resize.anchorX, resize.anchorY);
    const visualRect =
      fragmentBounds(resize.container) ?? resize.container.getBoundingClientRect();
    const draggedClient = namedCornerPoint(visualRect, resize.corner);
    const dragged = stageLocalPoint(draggedClient.x, draggedClient.y);
    if (!anchor || !dragged) return null;

    const { width, height } = outputSize();
    const displayScale = currentDisplayScale();
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

    const findCandidate = (draggedValue, anchorValue, targets, previous) => {
      const denom = draggedValue - anchorValue;
      if (Math.abs(denom) < 1e-6) return null;

      let best = null;
      if (previous) {
        const target = targets[previous.targetIndex];
        const distanceOutput = Math.abs(target - draggedValue);
        if (distanceOutput * displayScale <= SNAP_RELEASE_DISTANCE) {
          best = { targetIndex: previous.targetIndex, target, distanceOutput };
        }
      }
      if (!best) {
        for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
          const target = targets[targetIndex];
          const distanceOutput = Math.abs(target - draggedValue);
          if (
            distanceOutput * displayScale <= SNAP_DISTANCE &&
            (!best || distanceOutput < best.distanceOutput)
          ) {
            best = { targetIndex, target, distanceOutput };
          }
        }
      }
      if (!best) return null;

      const solvedScale = clampScale(((best.target - anchorValue) * scale) / denom);
      if (!Number.isFinite(solvedScale)) return null;
      return { ...best, scale: solvedScale };
    };

    const candidateX = findCandidate(dragged.x, anchor.x, xTargets, resize.snapX);
    const candidateY = findCandidate(dragged.y, anchor.y, yTargets, resize.snapY);

    let axis = null;
    if (candidateX && candidateY) {
      axis = candidateX.distanceOutput <= candidateY.distanceOutput ? "x" : "y";
    } else if (candidateX) {
      axis = "x";
    } else if (candidateY) {
      axis = "y";
    }

    if (!axis) {
      resize.snapX = null;
      resize.snapY = null;
      hideSnapGuides();
      return null;
    }

    if (axis === "x") {
      resize.snapX = { targetIndex: candidateX.targetIndex, target: candidateX.target };
      resize.snapY = null;
      showSnapGuides(resize.snapX, null);
      return candidateX.scale;
    }

    resize.snapY = { targetIndex: candidateY.targetIndex, target: candidateY.target };
    resize.snapX = null;
    showSnapGuides(null, resize.snapY);
    return candidateY.scale;
  }

  function applyResizeTransformAt(resize, scaleValue) {
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
      scale: scaleValue,
      anchorClientX: visualAnchor.x,
      anchorClientY: visualAnchor.y,
    });
    if (!translate) return false;

    resize.container.style.setProperty("--x", `${translate.x}px`);
    resize.container.style.setProperty("--y", `${translate.y}px`);
    resize.container.style.setProperty("--scale", String(scaleValue));
    return true;
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

    if (!applyResizeTransformAt(resize, nextScale)) return;

    if (event.shiftKey) {
      resize.snapX = null;
      resize.snapY = null;
      hideSnapGuides();
    } else {
      const snappedScale = applyResizeSnap(resize, nextScale);
      if (snappedScale !== null) {
        applyResizeTransformAt(resize, snappedScale);
      }
    }

    resize.moved = true;
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
    hideSnapGuides();
    refreshSelectionFrame();
  }

  function finishResize() {
    if (!activeResize) return null;

    const resize = activeResize;
    activeResize = null;
    releaseResizePointer(resize);
    hideSnapGuides();

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

  // 多層積み断片（overlay-authoring telop.md「多層テキスト断片と data-mirror 規約」）:
  // 縁取り・影・裏打ち等でテキストを複製した層は data-mirror="text" を持つ。
  // これらは直接テキストを持っていても編集候補から除外し、断片ごとに残る唯一の
  // 直接テキスト層（最前面の fill 層）だけが編集対象になるようにする。
  function isMirrorTextLayer(element) {
    return (
      element instanceof Element && element.getAttribute("data-mirror") === "text"
    );
  }

  function canEditText(element) {
    if (!(element instanceof HTMLElement) || !hasDirectText(element)) return false;
    if (isMirrorTextLayer(element)) return false;

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

  // ミラー同期のスコープ特定: 編集層の直近の祖先のうち、data-mirror="text" 層を
  // 子孫に持つ最初のもの。既定は編集層の親要素（PoC 由来の積層断片は fill 層と
  // ミラー層が同じ積層コンテナ = 親要素の直下に並ぶ — telop.md 参照）。container
  // （[data-overlay-id]）を超えて他のオーバーレイ側へは探しに行かない。
  function mirrorSyncScope(container, element) {
    let scope = element.parentElement;
    while (scope && scope !== container) {
      if (scope.querySelector('[data-mirror="text"]')) return scope;
      scope = scope.parentElement;
    }
    return element.parentElement;
  }

  // 編集層の textContent を同一 stack 内の全ミラー層へコピーする（P0-R 契約 §2）。
  // 呼び出し元は input / compositionend のたびに、および保存直前の安全網として
  // commitEdit からも呼ぶ。
  function syncMirrorLayers(container, element) {
    const scope = mirrorSyncScope(container, element);
    if (!scope) return;

    const mirrors = scope.querySelectorAll('[data-mirror="text"]');
    if (!mirrors.length) return;

    const text = element.textContent ?? "";
    for (const mirror of mirrors) {
      if (mirror.textContent !== text) mirror.textContent = text;
    }
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

    // 保存直前の安全網: input/compositionend を取りこぼした場合でも、確定した
    // 編集層のテキストで全ミラー層を同期してから書き出す（P0-R 契約 §3）。
    syncMirrorLayers(edit.container, edit.element);

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

    // テキスト編集で断片内容の実寸が変わり得るため、当たり判定（clip-path）を
    // 最新の bbox に合わせ直す（refreshSelectionFrame は毎フレーム再計算されるが、
    // clip-path は内容変化時のみの明示同期が必要）。
    syncOverlayHitRegion(edit.container);

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

  // 文字確定（input）/ IME 確定（compositionend）のたびにミラー層へ同期する
  // （P0-R 契約 §2）。IME 変換中の中間状態も input が発火する環境ではそのまま
  // コピーしてよい（ミラー層は mount() が aria-hidden="true" を付与済み）。
  function onEditableInput(event) {
    if (!activeEdit || event.target !== activeEdit.element) return;
    syncMirrorLayers(activeEdit.container, activeEdit.element);
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

  // リスナーの付け先は stage 自体ではなく「stage と選択枠の共通祖先」にする。
  // 選択枠の拡縮ハンドルは舞台の外にあるため、stage にしかリスナーが無いと
  // 捕捉フェーズが舞台を経由せずハンドル上の pointerdown が拾えない
  // （本日の実機回帰: 拡縮ハンドルが効かない）。
  // ハンドラ内部は findOverlayContainer / findHandleElement で対象を絞っている
  // ため、祖先を広げても他要素（#drop-hint 等）への誤発火は無い
  // （#drop-hint は動画ロード後 display:none で hit-test から外れる）。
  // ㉑ 実機是正: 選択枠は document.body 直下（上記 refreshSelectionFrame 参照、
  // 本番シェルの #zoom-layer が常時 transform を持つための移設）に統一したため、
  // listenerRoot も document 全体へ揃える（stage.parentElement のままだと
  // body 直下のハンドルが capture フェーズの対象外になり拾えなくなる）。
  const listenerRoot = document;

  listenerRoot.addEventListener("click", onClick, true);
  listenerRoot.addEventListener("pointerdown", onPointerDown, true);
  listenerRoot.addEventListener("dblclick", onDoubleClick, true);
  listenerRoot.addEventListener("blur", onBlur, true);
  listenerRoot.addEventListener("input", onEditableInput, true);
  listenerRoot.addEventListener("compositionend", onEditableInput, true);
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

  return {
    selftest,
    // ㉒ スナップ統一: layers[] / cut / caption のドラッグ実装（akari-preview-open-handler.ts、
    // 別パッケージ）が同じしきい値・座標系・ガイド線を再利用するための共有 API。
    // overlays[] 自身のドラッグ/拡縮（上の内部関数群）も同じ実装を通る（単一正本）。
    stageLocalPoint,
    computeSnapCorrection,
    showSnapGuides,
    hideSnapGuides,
    outputSize,
    currentDisplayScale,
    // ㉑ 素通し: overlay-runtime.js の tick() が可視化タイミングで呼ぶ。
    syncOverlayHitRegion,
    // Web UI（preview-server）が編集モードを抜けるときに選択枠を畳むための公開口
    // （Phase 2-4 一本化。shell では未使用の追加 export で挙動不変）。
    clearSelection,
  };
})();
