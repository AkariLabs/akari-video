(() => {
  // ../overlay-runtime/src/interaction.js
  window.akari = window.akari || {};
  window.akari.interaction = (() => {
    const stage = document.getElementById("overlay-stage");
    const dragStartDistance = 3;
    const SNAP_DISTANCE = 8;
    const SNAP_RELEASE_DISTANCE = 12;
    const SAFE_MARGIN_RATIO = 0.05;
    const DEFAULT_OUTPUT_WIDTH = 1280;
    const DEFAULT_OUTPUT_HEIGHT = 720;
    const NON_RENDERED_HIT_ELEMENTS = /* @__PURE__ */ new Set([
      "BASE",
      "HEAD",
      "LINK",
      "META",
      "NOSCRIPT",
      "SCRIPT",
      "STYLE",
      "TEMPLATE",
      "TITLE"
    ]);
    const REPLACED_HIT_ELEMENTS = /* @__PURE__ */ new Set([
      "AUDIO",
      "CANVAS",
      "EMBED",
      "IFRAME",
      "IMG",
      "OBJECT",
      "SVG",
      "VIDEO"
    ]);
    function stageScaleFactor() {
      const scale = window.akari.stageScale?.();
      return Number.isFinite(scale) && scale > 0 ? scale : 1;
    }
    const SCALE_MIN = 0.2;
    const SCALE_MAX = 4;
    const SCALE_SNAP_TOLERANCE = 0.035;
    let selectedOverlay = null;
    let selectionFrame = null;
    let selectionTrackingFrame = null;
    let activeDrag = null;
    let activeResize = null;
    let activeEdit = null;
    let selftestOverlayOverride = null;
    let verticalSnapGuide = null;
    let horizontalSnapGuide = null;
    const hitPolicyOriginalPointerEvents = /* @__PURE__ */ new WeakMap();
    const hitPolicyAppliedContainers = /* @__PURE__ */ new WeakSet();
    let writeTail = Promise.resolve();
    let writeGeneration = 0;
    let lastTransformWrite = null;
    function errorText(error) {
      return error instanceof Error ? error.message : String(error);
    }
    function resultText(result) {
      if (result === void 0) return "undefined";
      if (result === null) return "null";
      if (typeof result === "string") return result;
      try {
        return JSON.stringify(result) ?? String(result);
      } catch {
        return String(result);
      }
    }
    function reportWriteError(kind, overlayId, error) {
      console.error(`${kind} \u306E\u6C38\u7D9A\u5316\u306B\u5931\u6557\u3057\u307E\u3057\u305F (${overlayId}):`, error);
    }
    function captureWriteContext() {
      return {
        editPath: window.akari.state?.editPath ?? null,
        engine: window.akari.engine ?? null
      };
    }
    function enqueueWrite(context, overlayId, patch, kind) {
      const generation = ++writeGeneration;
      const promise = writeTail.then(() => {
        if (!context.editPath) {
          throw new Error("\u7DE8\u96C6\u4E2D\u306E edit.json \u304C\u3042\u308A\u307E\u305B\u3093");
        }
        if (typeof context.engine?.overlayWrite !== "function") {
          throw new Error("overlayWrite \u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093");
        }
        return context.engine.overlayWrite(context.editPath, overlayId, patch);
      });
      writeTail = promise.catch(() => void 0);
      promise.catch((error) => reportWriteError(kind, overlayId, error));
      return { generation, overlayId, promise };
    }
    function findOverlayContainer(target) {
      if (!stage || !(target instanceof Node)) return null;
      let element = target instanceof Element ? target : target.parentElement;
      while (element && element !== stage) {
        if (element.parentElement === stage && element.hasAttribute("data-overlay-id")) {
          return element;
        }
        element = element.parentElement;
      }
      return null;
    }
    const FULL_CONTAINER_COVERAGE_RATIO = 0.98;
    function looksLikeFullContainerWrapper(rect, containerRect) {
      if (!containerRect || !(containerRect.width > 0) || !(containerRect.height > 0)) {
        return false;
      }
      return rect.width >= containerRect.width * FULL_CONTAINER_COVERAGE_RATIO && rect.height >= containerRect.height * FULL_CONTAINER_COVERAGE_RATIO;
    }
    function fragmentBounds(container) {
      const root = fragmentRoot(container);
      if (!root) return null;
      const rootRect = root.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      if (!["NOSCRIPT", "SCRIPT", "STYLE", "TEMPLATE"].includes(root.tagName) && [rootRect.left, rootRect.top, rootRect.right, rootRect.bottom].every(
        Number.isFinite
      ) && rootRect.width > 0 && rootRect.height > 0 && !looksLikeFullContainerWrapper(rootRect, containerRect)) {
        return {
          left: rootRect.left,
          top: rootRect.top,
          right: rootRect.right,
          bottom: rootRect.bottom,
          width: rootRect.width,
          height: rootRect.height
        };
      }
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      const elements = root.querySelectorAll("*");
      for (const element of elements) {
        if (["NOSCRIPT", "SCRIPT", "STYLE", "TEMPLATE"].includes(element.tagName) || element.closest("[data-akari-interaction]")) {
          continue;
        }
        const rect = element.getBoundingClientRect();
        if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
          continue;
        }
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom);
      }
      if (![left, top, right, bottom].every(Number.isFinite)) {
        if (!["NOSCRIPT", "SCRIPT", "STYLE", "TEMPLATE"].includes(root.tagName) && [rootRect.left, rootRect.top, rootRect.right, rootRect.bottom].every(
          Number.isFinite
        ) && rootRect.width > 0 && rootRect.height > 0) {
          return {
            left: rootRect.left,
            top: rootRect.top,
            right: rootRect.right,
            bottom: rootRect.bottom,
            width: rootRect.width,
            height: rootRect.height
          };
        }
        return null;
      }
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    }
    function transparentColor(value) {
      const color = String(value ?? "").trim().toLowerCase();
      if (!color || color === "transparent") return true;
      const legacyAlpha = color.match(/^(?:rgba|hsla)\([^)]*,\s*([\d.]+)\)$/);
      if (legacyAlpha) return Number(legacyAlpha[1]) <= 0;
      const modernAlpha = color.match(/\/\s*([\d.]+)%?\s*\)$/);
      return Boolean(modernAlpha && Number(modernAlpha[1]) <= 0);
    }
    function visibleShadow(value) {
      const shadow = String(value ?? "").trim().toLowerCase();
      if (!shadow || shadow === "none") return false;
      const colors = shadow.match(/(?:rgba?|hsla?|color)\([^)]*\)|transparent/g) ?? [];
      return colors.length === 0 || colors.some((color) => !transparentColor(color));
    }
    function hasDirectText(element) {
      return Array.from(element.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== ""
      );
    }
    function drawsOwnContent(element, style) {
      if (NON_RENDERED_HIT_ELEMENTS.has(element.tagName)) return false;
      if (REPLACED_HIT_ELEMENTS.has(element.tagName)) return true;
      if (hasDirectText(element)) return true;
      if (!transparentColor(style.backgroundColor)) return true;
      if (style.backgroundImage && style.backgroundImage !== "none") return true;
      if (visibleShadow(style.boxShadow)) return true;
      for (const side of ["Top", "Right", "Bottom", "Left"]) {
        if (parseFloat(style[`border${side}Width`]) > 0 && !["none", "hidden"].includes(style[`border${side}Style`]) && !transparentColor(style[`border${side}Color`])) {
          return true;
        }
      }
      return parseFloat(style.outlineWidth) > 0 && !["none", "hidden"].includes(style.outlineStyle) && !transparentColor(style.outlineColor);
    }
    function setHitPointerEvents(element, value) {
      if (!hitPolicyOriginalPointerEvents.has(element)) {
        hitPolicyOriginalPointerEvents.set(element, {
          value: element.style.getPropertyValue("pointer-events"),
          priority: element.style.getPropertyPriority("pointer-events")
        });
      }
      element.style.setProperty("pointer-events", value, "important");
    }
    function fragmentRootCoversContainer(element, container) {
      const rootRect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      if (!(rootRect.width > 0) || !(rootRect.height > 0) || !(containerRect.width > 0) || !(containerRect.height > 0)) {
        return false;
      }
      return rootRect.width >= containerRect.width * 0.98 && rootRect.height >= containerRect.height * 0.98;
    }
    function applyOverlayHitPolicy(container) {
      if (!container || hitPolicyAppliedContainers.has(container)) return;
      setHitPointerEvents(container, "none");
      function visit(element, inheritedDirective, ancestorPainted, isFragmentRoot) {
        const declared = element.getAttribute("data-akari-hit");
        const directive = ["pass", "catch"].includes(declared) ? declared : inheritedDirective;
        const style = getComputedStyle(element);
        const participatesInPaint = ancestorPainted && style.display !== "none" && Number(style.opacity) > 0;
        const isVisible = participatesInPaint && !["hidden", "collapse"].includes(style.visibility);
        let pointerEvents = "none";
        if (isVisible && directive === "catch") {
          pointerEvents = "auto";
        } else if (isVisible && directive !== "pass" && (!isFragmentRoot || !fragmentRootCoversContainer(element, container)) && drawsOwnContent(element, style)) {
          pointerEvents = "auto";
        }
        setHitPointerEvents(element, pointerEvents);
        for (const child of element.children) {
          visit(child, directive, participatesInPaint, false);
        }
      }
      for (const root of container.children) visit(root, null, true, true);
      hitPolicyAppliedContainers.add(container);
    }
    function invalidateOverlayHitPolicy(container) {
      if (container) hitPolicyAppliedContainers.delete(container);
    }
    function restoreHitPolicyStyles(cloneRoot, liveRoot) {
      const clones = [cloneRoot, ...cloneRoot.querySelectorAll("*")];
      const liveElements = [liveRoot, ...liveRoot.querySelectorAll("*")];
      for (let index = 0; index < liveElements.length; index += 1) {
        const original = hitPolicyOriginalPointerEvents.get(liveElements[index]);
        const clone = clones[index];
        if (!original || !clone) continue;
        if (original.value) {
          clone.style.setProperty("pointer-events", original.value, original.priority);
        } else {
          clone.style.removeProperty("pointer-events");
          if (!clone.getAttribute("style")) clone.removeAttribute("style");
        }
      }
    }
    function syncOverlayHitRegion() {
    }
    function outputSize() {
      const output = window.akari.state?.summary?.output;
      const width = Number(output?.width);
      const height = Number(output?.height);
      return {
        width: Number.isFinite(width) && width > 0 ? width : DEFAULT_OUTPUT_WIDTH,
        height: Number.isFinite(height) && height > 0 ? height : DEFAULT_OUTPUT_HEIGHT
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
      if (!verticalSnapGuide?.isConnected || verticalSnapGuide.parentElement !== stage) {
        verticalSnapGuide = createSnapGuide("vertical");
        stage.appendChild(verticalSnapGuide);
      }
      if (!horizontalSnapGuide?.isConnected || horizontalSnapGuide.parentElement !== stage) {
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
      const { width, height } = outputSize();
      const clampGuidePosition = (target, extent) => Math.min(Math.max(target, 0.5), Math.max(0.5, extent - 0.5));
      guides.vertical.hidden = !snapX;
      if (snapX) {
        guides.vertical.style.left = `${clampGuidePosition(snapX.target, width)}px`;
      }
      guides.horizontal.hidden = !snapY;
      if (snapY) {
        guides.horizontal.style.top = `${clampGuidePosition(snapY.target, height)}px`;
      }
    }
    function overlayForEvent(event) {
      const eventTargetOverlay = findOverlayContainer(event.target);
      if (eventTargetOverlay && !isSelectable(eventTargetOverlay)) {
        return eventTargetOverlay;
      }
      if (selftestOverlayOverride && eventTargetOverlay === selftestOverlayOverride) {
        return selftestOverlayOverride;
      }
      return isSelectable(eventTargetOverlay) ? eventTargetOverlay : null;
    }
    function firstOverlayContainer() {
      if (!stage) return null;
      return Array.from(stage.children).find(
        (element) => element.hasAttribute("data-overlay-id")
      ) ?? null;
    }
    function fragmentRoot(container) {
      return Array.from(container.children).find(
        (element) => !element.hasAttribute("data-akari-interaction")
      ) ?? null;
    }
    let interactionEnabled = true;
    function setEnabled(next) {
      interactionEnabled = next !== false;
      if (!interactionEnabled) clearSelection();
    }
    function isSelectable(container) {
      if (!stage || !container || !container.isConnected || container.parentElement !== stage || !container.hasAttribute("data-overlay-id")) {
        return false;
      }
      return getComputedStyle(container).visibility !== "hidden";
    }
    function isBackgroundRole(container) {
      return Boolean(container?.dataset?.role === "background");
    }
    function isMovable(container) {
      return isSelectable(container) && !isBackgroundRole(container);
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
        rotate: cssVariableNumber(container, "--rotate", 0)
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
        document.body.appendChild(selectionFrame);
      }
      selectionFrame.classList.toggle("is-locked", isBackgroundRole(selectedOverlay));
      const usableRect = [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
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
      const WRITE_EPSILON_PX = 0.5;
      if (Math.abs(transform.x - drag.startX) < WRITE_EPSILON_PX && Math.abs(transform.y - drag.startY) < WRITE_EPSILON_PX) {
        drag.container.style.setProperty("--x", `${drag.startX}px`);
        drag.container.style.setProperty("--y", `${drag.startY}px`);
        refreshSelectionFrame();
        return null;
      }
      const record = enqueueWrite(
        drag.writeContext,
        drag.overlayId,
        { transform },
        "transform"
      );
      lastTransformWrite = record;
      return record;
    }
    function findHandleElement(target) {
      if (!(target instanceof Element)) return null;
      return target.closest('[data-akari-interaction="selection-handle"]');
    }
    function stageLocalPoint(clientX, clientY) {
      if (!stage) return null;
      const rect = stage.getBoundingClientRect();
      const layoutWidth = stage.clientWidth;
      const layoutHeight = stage.clientHeight;
      if (![clientX, clientY, rect.left, rect.top, rect.width, rect.height].every(
        Number.isFinite
      ) || rect.width <= 0 || rect.height <= 0 || layoutWidth <= 0 || layoutHeight <= 0) {
        return null;
      }
      const scaleX = rect.width / layoutWidth;
      const scaleY = rect.height / layoutHeight;
      if (!(scaleX > 0) || !(scaleY > 0)) return null;
      return {
        x: (clientX - rect.left) / scaleX,
        y: (clientY - rect.top) / scaleY,
        centerX: layoutWidth / 2,
        centerY: layoutHeight / 2
      };
    }
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
        bottom: bottomRight.y
      };
      if (!Object.values(bounds).every(Number.isFinite)) return null;
      return {
        ...bounds,
        centerX: (bounds.left + bounds.right) / 2,
        centerY: (bounds.top + bounds.bottom) / 2
      };
    }
    function closestAxisSnap(sources, targets, activeSnap, scale) {
      const displayScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
      if (activeSnap) {
        const source = sources[activeSnap.sourceIndex];
        const target = targets[activeSnap.targetIndex];
        const correction = target - source;
        if (Number.isFinite(correction) && Math.abs(correction) * displayScale <= SNAP_RELEASE_DISTANCE) {
          return { ...activeSnap, correction, target };
        }
      }
      let closest = null;
      for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
        for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
          const correction = targets[targetIndex] - sources[sourceIndex];
          const displayDistance = Math.abs(correction) * displayScale;
          if (displayDistance <= SNAP_DISTANCE && (!closest || displayDistance < Math.abs(closest.correction) * displayScale)) {
            closest = {
              sourceIndex,
              targetIndex,
              correction,
              target: targets[targetIndex]
            };
          }
        }
      }
      return closest;
    }
    function canvasSnapTargets() {
      const { width, height } = outputSize();
      return {
        x: [
          0,
          width * SAFE_MARGIN_RATIO,
          width / 2,
          width * (1 - SAFE_MARGIN_RATIO),
          width
        ],
        y: [
          0,
          height * SAFE_MARGIN_RATIO,
          height / 2,
          height * (1 - SAFE_MARGIN_RATIO),
          height
        ]
      };
    }
    function computeSnapCorrection(bounds, previousSnap) {
      if (!bounds) return { x: null, y: null };
      const targets = canvasSnapTargets();
      const scale = currentDisplayScale();
      const snapX = closestAxisSnap(
        [bounds.left, bounds.centerX, bounds.right],
        targets.x,
        previousSnap?.x ?? null,
        scale
      );
      const snapY = closestAxisSnap(
        [bounds.top, bounds.centerY, bounds.bottom],
        targets.y,
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
      anchorStageX,
      anchorStageY
    }) {
      if (!stage || !Number.isFinite(startScale) || startScale === 0 || !Number.isFinite(anchorStageX) || !Number.isFinite(anchorStageY)) {
        return null;
      }
      const dx = anchorStageX - stage.clientWidth / 2;
      const dy = anchorStageY - stage.clientHeight / 2;
      const scaleRatio = scale / startScale;
      return {
        x: dx - scaleRatio * (dx - startX),
        y: dy - scaleRatio * (dy - startY)
      };
    }
    function handleCorner(handleEl) {
      for (const corner of ["nw", "ne", "se", "sw"]) {
        if (handleEl.classList.contains(`is-${corner}`)) return corner;
      }
      return null;
    }
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
      }
    }
    function beginResize(event, container, handleEl) {
      if (activeEdit) void commitEdit();
      const visualRect = fragmentBounds(container) ?? container.getBoundingClientRect();
      const corner = handleCorner(handleEl);
      const anchorClient = cornerAnchorPoint(visualRect, corner);
      const draggedClient = namedCornerPoint(visualRect, corner);
      const anchor = stageLocalPoint(anchorClient.x, anchorClient.y);
      const dragged = stageLocalPoint(draggedClient.x, draggedClient.y);
      const pointer = stageLocalPoint(event.clientX, event.clientY);
      if (!anchor || !dragged || !pointer) return;
      const startDistance = Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y);
      const transform = readTransform(container);
      activeResize = {
        container,
        handleEl,
        overlayId: container.dataset.overlayId ?? "",
        pointerId: event.pointerId,
        corner,
        anchorStageX: anchor.x,
        anchorStageY: anchor.y,
        draggedStageX: dragged.x,
        draggedStageY: dragged.y,
        startDistance: startDistance || 1,
        // 0除算回避（アンカーとハンドルが重なる異常系向け保険）
        startScale: transform.scale,
        startX: transform.x,
        startY: transform.y,
        snapX: null,
        snapY: null,
        moved: false,
        writeContext: captureWriteContext()
      };
      try {
        handleEl.setPointerCapture?.(event.pointerId);
      } catch {
      }
      if (event.cancelable) event.preventDefault();
    }
    function computeAnchorResizeSnap({
      anchorStageX,
      anchorStageY,
      draggedStageX,
      draggedStageY,
      startScale,
      scale,
      snapX,
      snapY
    }) {
      if (!(Math.abs(scale) > 1e-6) || !(Math.abs(startScale) > 1e-6)) {
        return null;
      }
      const anchor = { x: anchorStageX, y: anchorStageY };
      const scaleRatio = scale / startScale;
      const dragged = {
        x: anchor.x + (draggedStageX - anchor.x) * scaleRatio,
        y: anchor.y + (draggedStageY - anchor.y) * scaleRatio
      };
      const targets = canvasSnapTargets();
      const displayScale = currentDisplayScale();
      const findCandidate = (draggedValue, anchorValue, targets2, previous) => {
        const denom = draggedValue - anchorValue;
        if (Math.abs(denom) < 1e-6) return null;
        let best = null;
        if (previous) {
          const target = targets2[previous.targetIndex];
          const distanceOutput = Math.abs(target - draggedValue);
          if (distanceOutput * displayScale <= SNAP_RELEASE_DISTANCE) {
            best = { targetIndex: previous.targetIndex, target, distanceOutput };
          }
        }
        if (!best) {
          for (let targetIndex = 0; targetIndex < targets2.length; targetIndex += 1) {
            const target = targets2[targetIndex];
            const distanceOutput = Math.abs(target - draggedValue);
            if (distanceOutput * displayScale <= SNAP_DISTANCE && (!best || distanceOutput < best.distanceOutput)) {
              best = { targetIndex, target, distanceOutput };
            }
          }
        }
        if (!best) return null;
        const solvedScale = clampScale((best.target - anchorValue) * scale / denom);
        if (!Number.isFinite(solvedScale)) return null;
        return { ...best, scale: solvedScale };
      };
      const candidateX = findCandidate(dragged.x, anchor.x, targets.x, snapX);
      const candidateY = findCandidate(dragged.y, anchor.y, targets.y, snapY);
      let axis = null;
      if (candidateX && candidateY) {
        axis = candidateX.distanceOutput <= candidateY.distanceOutput ? "x" : "y";
      } else if (candidateX) {
        axis = "x";
      } else if (candidateY) {
        axis = "y";
      }
      if (!axis) {
        hideSnapGuides();
        return { scale, snapX: null, snapY: null };
      }
      if (axis === "x") {
        const nextSnapX = { targetIndex: candidateX.targetIndex, target: candidateX.target };
        showSnapGuides(nextSnapX, null);
        return { scale: candidateX.scale, snapX: nextSnapX, snapY: null };
      }
      const nextSnapY = { targetIndex: candidateY.targetIndex, target: candidateY.target };
      showSnapGuides(null, nextSnapY);
      return { scale: candidateY.scale, snapX: null, snapY: nextSnapY };
    }
    function applyResizeSnap(resize, scale) {
      const solved = computeAnchorResizeSnap({
        anchorStageX: resize.anchorStageX,
        anchorStageY: resize.anchorStageY,
        draggedStageX: resize.draggedStageX,
        draggedStageY: resize.draggedStageY,
        startScale: resize.startScale,
        scale,
        snapX: resize.snapX,
        snapY: resize.snapY
      });
      if (!solved) return null;
      resize.snapX = solved.snapX;
      resize.snapY = solved.snapY;
      return solved.scale;
    }
    function applyResizeTransformAt(resize, scaleValue) {
      const translate = anchorPreservingTranslate({
        startX: resize.startX,
        startY: resize.startY,
        startScale: resize.startScale,
        scale: scaleValue,
        anchorStageX: resize.anchorStageX,
        anchorStageY: resize.anchorStageY
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
      const pointer = stageLocalPoint(event.clientX, event.clientY);
      if (!pointer) return;
      const currentDistance = Math.hypot(
        pointer.x - resize.anchorStageX,
        pointer.y - resize.anchorStageY
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
      return Number.isFinite(event.clientX) && Number.isFinite(event.clientY) && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    }
    function onPointerDown(event) {
      if (!interactionEnabled) return;
      if (event.button !== 0 || activeDrag || activeResize) return;
      const handleEl = findHandleElement(event.target);
      if (handleEl) {
        if (!isMovable(selectedOverlay)) return;
        beginResize(event, selectedOverlay, handleEl);
        return;
      }
      const container = overlayForEvent(event);
      if (!isSelectable(container)) {
        if (selectedOverlay && stage && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
          const stageRect = stage.getBoundingClientRect();
          if (event.clientX >= stageRect.left && event.clientX <= stageRect.right && event.clientY >= stageRect.top && event.clientY <= stageRect.bottom) {
            if (activeEdit) void commitEdit();
            clearSelection();
          }
        }
        return;
      }
      selectOverlay(container);
      if (activeEdit?.container === container && eventHitsElement(event, activeEdit.element)) {
        return;
      }
      if (activeEdit) void commitEdit();
      if (!isMovable(container)) return;
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
        writeContext: captureWriteContext()
      };
      hideSnapGuides();
      try {
        container.setPointerCapture?.(event.pointerId);
      } catch {
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
      if (!drag.moved && deltaX * deltaX + deltaY * deltaY < dragStartDistance * dragStartDistance) {
        return;
      }
      drag.moved = true;
      const currentStagePoint = stageLocalPoint(event.clientX, event.clientY);
      const scale = stageScaleFactor();
      const videoDeltaX = drag.startStagePoint && currentStagePoint ? currentStagePoint.x - drag.startStagePoint.x : deltaX / scale;
      const videoDeltaY = drag.startStagePoint && currentStagePoint ? currentStagePoint.y - drag.startStagePoint.y : deltaY / scale;
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
    function isMirrorTextLayer(element) {
      return element instanceof Element && element.getAttribute("data-mirror") === "text";
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
        "TEXTAREA"
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
      const elements = [root, ...root.querySelectorAll("*")];
      for (let index = elements.length - 1; index >= 0; index -= 1) {
        const element = elements[index];
        if (!canEditText(element)) continue;
        const rect = element.getBoundingClientRect();
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
          return element;
        }
      }
      return null;
    }
    function mirrorSyncScope(container, element) {
      let scope = element.parentElement;
      while (scope && scope !== container) {
        if (scope.querySelector('[data-mirror="text"]')) return scope;
        scope = scope.parentElement;
      }
      return element.parentElement;
    }
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
    function slotNameForElement(element) {
      if (!(element instanceof Element)) return null;
      const name = element.getAttribute("data-akari-slot");
      return typeof name === "string" && name.length > 0 ? name : null;
    }
    function syncSlotInstances(container, element, slotName) {
      if (!slotName) return;
      const text = element.textContent ?? "";
      for (const slot of container.querySelectorAll("[data-akari-slot]")) {
        if (slot !== element && slot.getAttribute("data-akari-slot") === slotName) {
          slot.textContent = text;
        }
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
      if (!root) throw new Error("\u30AA\u30FC\u30D0\u30FC\u30EC\u30A4\u65AD\u7247\u306E\u30EB\u30FC\u30C8\u8981\u7D20\u304C\u3042\u308A\u307E\u305B\u3093");
      const clone = root.cloneNode(true);
      restoreHitPolicyStyles(clone, root);
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
      if (!activeEdit) return Promise.resolve(void 0);
      const edit = activeEdit;
      activeEdit = null;
      syncMirrorLayers(edit.container, edit.element);
      if (edit.splitHost) window.akari.textSplit?.apply?.(edit.splitHost);
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
      invalidateOverlayHitPolicy(edit.container);
      applyOverlayHitPolicy(edit.container);
      syncOverlayHitRegion(edit.container);
      if (edit.slotName) {
        const record2 = enqueueWrite(
          edit.writeContext,
          edit.overlayId,
          { params: { [edit.slotName]: edit.element.textContent ?? "" } },
          "params"
        );
        return record2.promise;
      }
      let html;
      try {
        html = serializeFragment(edit.container);
      } catch (error) {
        reportWriteError("html", edit.overlayId, error);
        const failure = Promise.reject(error);
        failure.catch(() => void 0);
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
        editingMarkerValue: element.getAttribute("data-akari-interaction-editing") ?? "",
        slotName: slotNameForElement(element),
        writeContext: captureWriteContext()
      };
      const splitHost = window.akari.textSplit?.closestHost?.(element);
      if (splitHost) {
        activeEdit.splitHost = splitHost;
        window.akari.textSplit.collapse(splitHost);
      }
      element.setAttribute("contenteditable", "true");
      element.setAttribute("spellcheck", "false");
      element.setAttribute("data-akari-interaction-editing", "true");
      element.focus({ preventScroll: true });
      placeCaretAtEnd(element);
    }
    function onClick(event) {
      if (!interactionEnabled) return;
      const container = overlayForEvent(event);
      if (isSelectable(container)) selectOverlay(container);
    }
    function onDoubleClick(event) {
      if (!interactionEnabled) return;
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
    function onEditableInput(event) {
      if (!activeEdit || event.target !== activeEdit.element) return;
      syncMirrorLayers(activeEdit.container, activeEdit.element);
      syncSlotInstances(
        activeEdit.container,
        activeEdit.element,
        activeEdit.slotName
      );
    }
    function onKeyDown(event) {
      if (event.key === "Enter" && activeEdit && event.target === activeEdit.element && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        void commitEdit();
        return;
      }
      if (event.key !== "Escape" || !selectedOverlay && !activeDrag && !activeResize && !activeEdit) {
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
        if (!stage) throw new Error("#overlay-stage \u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
        if (typeof PointerEvent !== "function") {
          throw new Error("PointerEvent \u3092\u5229\u7528\u3067\u304D\u307E\u305B\u3093");
        }
        if (!window.akari.state?.editPath) {
          throw new Error("\u7DE8\u96C6\u4E2D\u306E edit.json \u304C\u3042\u308A\u307E\u305B\u3093");
        }
        container = firstOverlayContainer();
        if (!container) throw new Error("\u30AA\u30FC\u30D0\u30FC\u30EC\u30A4\u304C\u3042\u308A\u307E\u305B\u3093");
        if (!isSelectable(container)) {
          throw new Error("\u6700\u521D\u306E\u30AA\u30FC\u30D0\u30FC\u30EC\u30A4\u306F\u8868\u793A\u4E2D\u3067\u306F\u3042\u308A\u307E\u305B\u3093");
        }
        if (activeDrag) cancelDrag();
        if (activeResize) cancelResize();
        if (activeEdit) await commitEdit();
        clearSelection();
        beforeText = cssVariableText(container, "--x") || "(empty)";
        beforeValue = cssVariableNumber(container, "--x", 0);
        const rootRect = fragmentBounds(container);
        const startClientX = Number.isFinite(rootRect?.left) ? rootRect.left + rootRect.width / 2 : 100;
        const startClientY = Number.isFinite(rootRect?.top) ? rootRect.top + rootRect.height / 2 : 100;
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
          shiftKey: true
        };
        selftestOverlayOverride = container;
        try {
          container.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              composed: true,
              clientX: startClientX,
              clientY: startClientY
            })
          );
          if (selectedOverlay !== container) {
            throw new Error("\u30AF\u30EA\u30C3\u30AF\u3067\u9078\u629E\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F");
          }
          container.dispatchEvent(
            new PointerEvent("pointerdown", {
              ...common,
              buttons: 1,
              clientX: startClientX,
              clientY: startClientY
            })
          );
          container.dispatchEvent(
            new PointerEvent("pointermove", {
              ...common,
              buttons: 1,
              clientX: startClientX + 60,
              clientY: startClientY
            })
          );
          container.dispatchEvent(
            new PointerEvent("pointerup", {
              ...common,
              buttons: 0,
              clientX: startClientX + 60,
              clientY: startClientY
            })
          );
        } finally {
          selftestOverlayOverride = null;
          if (activeDrag?.container === container) cancelDrag();
        }
        const write = lastTransformWrite;
        if (!write || write.generation <= generationBefore || write.overlayId !== container.dataset.overlayId) {
          throw new Error("\u30C9\u30E9\u30C3\u30B0\u306E overlayWrite \u304C\u958B\u59CB\u3055\u308C\u307E\u305B\u3093\u3067\u3057\u305F");
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
        const expectedMove = 60 / dragStageScale;
        const dragOk = Math.abs(movedBy - expectedMove) < 1e-3;
        resizeSetupTransform = readTransform(container);
        container.style.setProperty("--scale", "1.5");
        refreshSelectionFrame();
        const resizeBeforeRect = fragmentBounds(container);
        if (!resizeBeforeRect || ![
          resizeBeforeRect.left,
          resizeBeforeRect.top,
          resizeBeforeRect.right,
          resizeBeforeRect.bottom,
          resizeBeforeRect.width,
          resizeBeforeRect.height
        ].every(Number.isFinite) || resizeBeforeRect.width <= 0 || resizeBeforeRect.height <= 0) {
          throw new Error("\u62E1\u7E2E\u524D\u306E\u65AD\u7247\u77E9\u5F62\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F");
        }
        const resizeHandle = selectionFrame?.querySelector(
          ".akari-interaction-handle.is-se"
        );
        if (!(resizeHandle instanceof HTMLElement)) {
          throw new Error("se \u62E1\u7E2E\u30CF\u30F3\u30C9\u30EB\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
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
          pointerId: resizePointerId
        };
        try {
          resizeHandle.dispatchEvent(
            new PointerEvent("pointerdown", {
              ...resizeCommon,
              buttons: 1,
              clientX: resizeStartClientX,
              clientY: resizeStartClientY
            })
          );
          resizeHandle.dispatchEvent(
            new PointerEvent("pointermove", {
              ...resizeCommon,
              buttons: 1,
              clientX: resizeStartClientX + 40,
              clientY: resizeStartClientY + 40
            })
          );
          resizeHandle.dispatchEvent(
            new PointerEvent("pointerup", {
              ...resizeCommon,
              buttons: 0,
              clientX: resizeStartClientX + 40,
              clientY: resizeStartClientY + 40
            })
          );
        } finally {
          if (activeResize?.container === container) cancelResize();
        }
        const resizeWrite = lastTransformWrite;
        if (!resizeWrite || resizeWrite.generation <= resizeGenerationBefore || resizeWrite.overlayId !== container.dataset.overlayId) {
          throw new Error("\u62E1\u7E2E\u306E overlayWrite \u304C\u958B\u59CB\u3055\u308C\u307E\u305B\u3093\u3067\u3057\u305F");
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
          throw new Error("\u62E1\u7E2E\u5F8C\u306E\u65AD\u7247\u77E9\u5F62\u3092\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F");
        }
        const anchorDrift = Math.hypot(
          resizeAfterRect.left - anchorBeforeX,
          resizeAfterRect.top - anchorBeforeY
        );
        const scaleOk = Number.isFinite(actualScale) && Math.abs(actualScale - expectedScale) < 1e-3;
        const anchorOk = Number.isFinite(anchorDrift) && anchorDrift < 1;
        const resizeOk = scaleOk && anchorOk;
        resizeDetail = `--scale: ${resizeStartScale} -> ${actualScale} (expected ${expectedScale}); nw drift: ${anchorDrift}px; overlayWrite: ${resizeWriteResultText}`;
        const ok = dragOk && resizeOk;
        const detail = `--x: ${beforeText} -> ${afterText}; moved: ${movedBy}px (expected ${expectedMove}px); overlayWrite: ${dragWriteResultText}; resize: ${resizeDetail}`;
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
          detail: `--x: ${beforeText} -> ${afterText}; drag overlayWrite: ${dragWriteResultText}; resize: ${resizeDetail}; resize overlayWrite: ${resizeWriteResultText}; error: ${errorText(error)}`
        };
      }
    }
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
        if (activeEdit && event.target instanceof Node && activeEdit.element.contains(event.target)) {
          return;
        }
        if (isSelectable(findOverlayContainer(event.target))) event.preventDefault();
      },
      true
    );
    if (stage) {
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
      anchorPreservingTranslate,
      computeAnchorResizeSnap,
      // ㉑ 素通し: overlay-runtime.js の tick() が可視化タイミングで呼ぶ。
      applyOverlayHitPolicy,
      invalidateOverlayHitPolicy,
      syncOverlayHitRegion,
      // Web UI（preview-server）が編集モードを抜けるときに選択枠を畳むための公開口
      // （Phase 2-4 一本化。shell では未使用の追加 export で挙動不変）。
      clearSelection,
      // Web UI が編集モードに合わせて素材操作そのものを止めるための公開口。
      setEnabled
    };
  })();
})();
