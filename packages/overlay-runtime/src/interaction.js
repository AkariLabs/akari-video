// インタラクション層
// 契約: docs/planning/contract-2026-07-13-m1-m4.md §M3
window.akari = window.akari || {};

window.akari.interaction = (() => {
// BEGIN selection-scope
function lineage(tree, id) {
  const nodes = new Map(tree.map(node => [node.id, node]));
  const result = [], visited = new Set();
  while (id != null && nodes.has(id) && !visited.has(id)) {
    visited.add(id);
    result.unshift(id);
    id = nodes.get(id).parentId;
  }
  return result;
}

function resolveScopedSelection(tree, scopeId, hitLeafId, { deep = false } = {}) {
  const path = lineage(tree, hitLeafId);
  if (!path.length) return { selectId: hitLeafId, scopeId };
  if (deep) return { selectId: hitLeafId, scopeId: path.at(-2) ?? null };
  // Keep the nearest enclosing scope that also contains this hit.
  const scopes = lineage(tree, scopeId);
  while (scopeId !== null && (!path.includes(scopeId) || scopeId === hitLeafId)) {
    scopes.pop();
    scopeId = scopes.at(-1) ?? null;
  }
  return { selectId: path[path.indexOf(scopeId) + 1], scopeId };
}

function enterScope(tree, selectedId, hitLeafId) {
  const node = tree.find(candidate => candidate.id === selectedId);
  if (!node || node.kind === "leaf") {
    return { selectId: selectedId, scopeId: node?.parentId ?? null };
  }
  const path = lineage(tree, hitLeafId);
  const selectId = path.includes(selectedId) && hitLeafId !== selectedId
    ? path[path.indexOf(selectedId) + 1]
    : tree.find(candidate => candidate.parentId === selectedId)?.id ?? null;
  return { selectId, scopeId: selectedId };
}

function exitScope(tree, selectedId, scopeId, floorScopeId = null) {
  if (scopeId === floorScopeId || scopeId === null) {
    return { selectId: null, scopeId: floorScopeId };
  }
  const path = lineage(tree, scopeId);
  if (floorScopeId !== null && !path.includes(floorScopeId)) {
    return { selectId: null, scopeId: floorScopeId };
  }
  return { selectId: scopeId, scopeId: path.at(-2) ?? floorScopeId };
}

function descendantLeafIds(tree, id) {
  return tree.filter(node => node.kind === "leaf" && lineage(tree, node.id).includes(id))
    .map(node => node.id);
}
function shouldHandleScopeEscape(selectedId, scopeId, floorScopeId) {
  return selectedId !== null || scopeId !== floorScopeId;
}

function lazyBagForScope(tree, scopeId) {
  const node = tree.find(candidate => candidate.id === scopeId);
  return node?.kind === "bag" && node.lazy === true ? node.id : null;
}

function nextCycleCandidate(candidates, currentId) {
  if (!candidates.length) return null;
  return candidates[(candidates.indexOf(currentId) + 1) % candidates.length];
}

// Toggle only immediate siblings in the current scope; preserve insertion order.
function toggleScopedSelection(tree, selectedIds, scopeId, next) {
  const sibling = id => tree.some(node => node.id === id && node.parentId === scopeId);
  const additive = next.scopeId === scopeId && sibling(next.selectId) && selectedIds.every(sibling);
  const ids = additive
    ? selectedIds.includes(next.selectId) ? selectedIds.filter(id => id !== next.selectId) : [...selectedIds, next.selectId]
    : next.selectId === null ? [] : [next.selectId];
  return { selectedIds: ids, selectId: ids.at(-1) ?? null, scopeId: next.scopeId };
}

// Client-space AABBs. Touching an edge counts as a hit.
function marqueeHits(candidates, rect) {
  if (!rect) return [];
  return candidates.filter(({ bounds }) => bounds
    && bounds.left <= rect.right && bounds.right >= rect.left
    && bounds.top <= rect.bottom && bounds.bottom >= rect.top).map(({ id }) => id);
}

// END selection-scope

  const stage = document.getElementById("overlay-stage");
  const dragStartDistance = 4;
  const SNAP_DISTANCE = 6;
  const SNAP_RELEASE_DISTANCE = 6;
  const DEFAULT_OUTPUT_WIDTH = 1280;
  const DEFAULT_OUTPUT_HEIGHT = 720;
  const NON_RENDERED_HIT_ELEMENTS = new Set([
    "BASE",
    "HEAD",
    "LINK",
    "META",
    "NOSCRIPT",
    "SCRIPT",
    "STYLE",
    "TEMPLATE",
    "TITLE",
  ]);
  const REPLACED_HIT_ELEMENTS = new Set([
    "AUDIO",
    "CANVAS",
    "EMBED",
    "IFRAME",
    "IMG",
    "OBJECT",
    "SVG",
    "VIDEO",
  ]);

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
  let selectedId = null;
  let selectedIds = [];
  let scopeId = null;
  let floorScopeId = window.akari.state?.selectionFloor ?? null;
  scopeId = floorScopeId;
  let groupSelection = false;
  let selectionFrame = null;
  let selectionTrackingFrame = null;
  let activeDrag = null;
  let activeResize = null;
  let activeRotate = null;
  let activeLine = null;
  let rotationBadge = null;
  let handleHint = null;
  let activeEdit = null;
  let selftestOverlayOverride = null;
  let verticalSnapGuide = null;
  let horizontalSnapGuide = null;
  let nudge = null;
  let nudgeTimer = null;
  let lastClick = null;
  let clickOrigin = null;
  let pendingBlank = null;
  let marqueeFrame = null;
  let hoverFrame = null;
  let hoverTick = null;
  let hoverEvent = null;

  // 当たり判定規約は断片の inline style へ一時的に pointer-events を置く。
  // テキスト編集で断片 HTML を保存するときに作者の元指定へ戻せるよう、初回値だけ保持する。
  const hitPolicyOriginalPointerEvents = new WeakMap();
  const hitPolicyAppliedContainers = new WeakSet();

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

  function enqueueWriteBatch(context, writes) {
    const generation = ++writeGeneration;
    const promise = writeTail.then(() => {
      if (!context.editPath) throw new Error("編集中の edit.json がありません");
      if (typeof context.engine?.overlayWriteBatch !== 'function') throw new Error('overlayWriteBatch を利用できません');
      return context.engine.overlayWriteBatch(writes);
    });
    writeTail = promise.catch(() => undefined);
    return { generation, promise };
  }

  function selectionKind() { return selectedIds.length > 1 ? 'multi' : groupSelection ? 'group' : 'leaf'; }
  function collectiveSelection() { return groupSelection || selectedIds.length > 1; }
  function selectionMembers() { return [...new Set(selectedIds.flatMap(id => visibleMembers(id)))]; }
  function markSelectionMembers() {
    const members = new Set(selectionMembers());
    for (const element of stage?.children ?? []) {
      if (members.has(element)) {
        if (!element.hasAttribute('data-akari-interaction-selected')) element.setAttribute('data-akari-interaction-selected', 'true');
      } else element.removeAttribute('data-akari-interaction-selected');
    }
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
      !looksLikeFullContainerWrapper(rootRect, containerRect) &&
      root.tagName !== "CANVAS"
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
    const candidates = [];
    for (const element of [root, ...root.querySelectorAll("*")]) {
      if (NON_RENDERED_HIT_ELEMENTS.has(element.tagName)
        || element.closest("[data-akari-interaction]")
        || !isPaintedElement(element, container)) continue;
      const rect = element.tagName === "CANVAS"
        ? (canvasHasDecoration(element) ? element.getBoundingClientRect()
          : window.akari.threeRuntime?.contentBounds?.(element)
            ?? measureCanvasBounds(element) ?? element.getBoundingClientRect())
        : element.getBoundingClientRect();
      if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
        || rect.width <= 0 || rect.height <= 0) continue;
      candidates.push({ element, rect });
    }
    for (const { element, rect } of candidates) {
      // 透明な全画面位置決め要素だけを縮み包む。背景/画像等の実体は残す。
      if (looksLikeFullContainerWrapper(rect, containerRect)
        && !drawsOwnContent(element, getComputedStyle(element))
        && candidates.some((candidate) => candidate.element !== element
          && element.contains(candidate.element)
          && !looksLikeFullContainerWrapper(candidate.rect, containerRect))) continue;
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

  function isPaintedElement(element, container) {
    const style = getComputedStyle(element);
    if (["hidden", "collapse"].includes(style.visibility)) return false;
    for (let node = element; node && node !== container; node = node.parentElement) {
      const ancestorStyle = getComputedStyle(node);
      if (ancestorStyle.display === "none" || Number(ancestorStyle.opacity) === 0) return false;
    }
    return true;
  }

  const canvasSnapshots = new WeakMap();
  const alphaHitCanvases = new WeakSet();
  const forwardedCanvasEvents = new WeakSet();
  const CANVAS_ALPHA_THRESHOLD = 16;

  // Three の内容枠申告と同じ描画直後にコピーする。preserveDrawingBuffer=false の
  // バッファが提示後に消えても読める。GPU→CPU の 1px 読み出しはクリック時だけ。
  function captureCanvasContent(canvas) {
    try {
      let copy = canvasSnapshots.get(canvas);
      if (!copy) copy = document.createElement("canvas");
      if (copy.width !== canvas.width) copy.width = canvas.width;
      if (copy.height !== canvas.height) copy.height = canvas.height;
      const context = copy.getContext("2d", { willReadFrequently: true });
      context.clearRect(0, 0, copy.width, copy.height);
      context.drawImage(canvas, 0, 0);
      canvasSnapshots.set(canvas, copy);
    } catch {
      canvasSnapshots.delete(canvas);
    }
  }

  function readableCanvas(canvas) {
    const copy = canvasSnapshots.get(canvas);
    if (copy && copy.width === canvas.width && copy.height === canvas.height) return copy;
    if (canvas.getContext("2d")) return canvas;
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    // 未保存の WebGL バッファは「透明」ではなく「読めない」。従来の当たりへ退避する。
    if (!gl || gl.isContextLost() || !gl.getContextAttributes()?.preserveDrawingBuffer) return null;
    return canvas;
  }

  function canvasClientGeometry(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = canvas.offsetWidth, height = canvas.offsetHeight;
    if (!window.DOMMatrix || !(width > 0 && height > 0)) return null;
    let matrix = new window.DOMMatrix();
    for (let node = canvas; node instanceof Element; node = node.parentElement) {
      const transform = getComputedStyle(node).transform;
      if (transform && transform !== "none") {
        const parentMatrix = new window.DOMMatrix(transform);
        if (!parentMatrix.is2D) return null;
        matrix = parentMatrix.multiply(matrix);
      }
    }
    // rect 中心が transform-origin/translate を含む平行移動をすべて吸収する。
    return { rect, width, height, matrix };
  }

  function canvasClientBounds(canvas, box) {
    const rect = canvas.getBoundingClientRect();
    const geometry = canvasClientGeometry(canvas);
    const points = [];
    for (const x of [box.left, box.right]) {
      for (const y of [box.top, box.bottom]) {
        if (geometry) {
          const point = geometry.matrix.transformPoint({
            x: (x - 0.5) * geometry.width, y: (y - 0.5) * geometry.height,
          });
          points.push({ x: rect.left + rect.width / 2 + point.x - geometry.matrix.e,
            y: rect.top + rect.height / 2 + point.y - geometry.matrix.f });
        } else points.push({ x: rect.left + x * rect.width, y: rect.top + y * rect.height });
      }
    }
    const left = Math.min(...points.map(point => point.x));
    const top = Math.min(...points.map(point => point.y));
    const right = Math.max(...points.map(point => point.x));
    const bottom = Math.max(...points.map(point => point.y));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function canvasAlphaAtPoint(canvas, clientX, clientY) {
    try {
      const rect = canvas.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0 && canvas.width > 0 && canvas.height > 0)) return 255;
      let x = (clientX - rect.left) / rect.width;
      let y = (clientY - rect.top) / rect.height;
      const geometry = canvasClientGeometry(canvas);
      if (geometry) {
        const point = geometry.matrix.inverse().transformPoint({
          x: clientX - rect.left - rect.width / 2 + geometry.matrix.e,
          y: clientY - rect.top - rect.height / 2 + geometry.matrix.f,
        });
        x = point.x / geometry.width + 0.5;
        y = point.y / geometry.height + 0.5;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) return 255;
      if (x < 0 || y < 0 || x >= 1 || y >= 1) return 0;
      // CSS の背景/枠も canvas 自身の描画。ビットマップが透明でも素通ししない。
      if (canvasHasDecoration(canvas)) return 255;
      const source = readableCanvas(canvas);
      if (!source) return 255;
      const sample = document.createElement("canvas");
      sample.width = sample.height = 1;
      const context = sample.getContext("2d", { willReadFrequently: true });
      context.drawImage(source, Math.floor(x * source.width), Math.floor(y * source.height), 1, 1, 0, 0, 1, 1);
      return context.getImageData(0, 0, 1, 1).data[3];
    } catch {
      return 255;
    }
  }

  function canvasHasDecoration(canvas) {
    // CANVAS の置換要素扱いだけを除外し、同じ背景/枠/影ルールを使う。
    return drawsOwnContent({ tagName: "DIV", childNodes: [] }, getComputedStyle(canvas));
  }

  function measureCanvasBounds(canvas) {
    try {
      if (canvasHasDecoration(canvas)) return null;
      const source = readableCanvas(canvas);
      if (!source || !(source.width > 0 && source.height > 0)) return null;
      const sample = document.createElement("canvas");
      const scale = Math.min(1, 320 / Math.max(source.width, source.height));
      sample.width = Math.max(1, Math.round(source.width * scale));
      sample.height = Math.max(1, Math.round(source.height * scale));
      const context = sample.getContext("2d", { willReadFrequently: true });
      context.drawImage(source, 0, 0, sample.width, sample.height);
      const data = context.getImageData(0, 0, sample.width, sample.height).data;
      let x0 = sample.width, y0 = sample.height, x1 = -1, y1 = -1;
      for (let y = 0; y < sample.height; y++) {
        for (let x = 0; x < sample.width; x++) {
          if (data[(y * sample.width + x) * 4 + 3] <= CANVAS_ALPHA_THRESHOLD) continue;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y);
          x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
      if (x1 < 0) return null;
      return canvasClientBounds(canvas, { left: x0 / sample.width, top: y0 / sample.height,
        right: (x1 + 1) / sample.width, bottom: (y1 + 1) / sample.height });
    } catch {
      return null;
    }
  }

  function passTransparentCanvasEvent(event) {
    if (forwardedCanvasEvents.has(event) || !alphaHitCanvases.has(event.target)
      || canvasAlphaAtPoint(event.target, event.clientX, event.clientY) > CANVAS_ALPHA_THRESHOLD) return;
    const hidden = [];
    let target = event.target;
    try {
      // 重なった透明 canvas も順に外し、実際の DOM z 順で下の素材を選ぶ。
      while (target && alphaHitCanvases.has(target)
        && canvasAlphaAtPoint(target, event.clientX, event.clientY) <= CANVAS_ALPHA_THRESHOLD) {
        hidden.push(target);
        target.style.setProperty("pointer-events", "none", "important");
        target = document.elementFromPoint(event.clientX, event.clientY);
      }
      if (!target || target === event.target) return;
      const EventType = event.type.startsWith("pointer") ? PointerEvent : MouseEvent;
      const forwarded = new EventType(event.type, event);
      forwardedCanvasEvents.add(forwarded);
      event.stopImmediatePropagation();
      if (event.cancelable) event.preventDefault();
      target.dispatchEvent(forwarded);
    } finally {
      for (const canvas of hidden) canvas.style.setProperty("pointer-events", "auto", "important");
    }
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
    const colors =
      shadow.match(/(?:rgba?|hsla?|color)\([^)]*\)|transparent/g) ?? [];
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
      if (
        parseFloat(style[`border${side}Width`]) > 0 &&
        !["none", "hidden"].includes(style[`border${side}Style`]) &&
        !transparentColor(style[`border${side}Color`])
      ) {
        return true;
      }
    }

    return (
      parseFloat(style.outlineWidth) > 0 &&
      !["none", "hidden"].includes(style.outlineStyle) &&
      !transparentColor(style.outlineColor)
    );
  }

  function setHitPointerEvents(element, value) {
    if (!hitPolicyOriginalPointerEvents.has(element)) {
      hitPolicyOriginalPointerEvents.set(element, {
        value: element.style.getPropertyValue("pointer-events"),
        priority: element.style.getPropertyPriority("pointer-events"),
      });
    }
    // 作者 CSS に旧来の pointer-events 指定が残っていても、逃げ道を data-akari-hit へ
    // 一本化するためランタイム規約を優先する。保存時は上の記録から元指定へ戻す。
    element.style.setProperty("pointer-events", value, "important");
  }

  // 全画面の外側コンテナと断片ルートは素通しにし、実際に背景・枠・影・文字・置換要素を
  // 描く可視の子孫だけを拾う。data-akari-hit は最寄りの指定を配下へ継承し、機械判定より
  // 優先する。字幕が 1,000 件級でも全件を走査しないよう、runtime の可視化時に一度だけ呼ぶ。
  function fragmentRootCoversContainer(element, container) {
    const rootRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (!(rootRect.width > 0) || !(rootRect.height > 0)
      || !(containerRect.width > 0) || !(containerRect.height > 0)) {
      return false;
    }
    return rootRect.width >= containerRect.width * 0.98
      && rootRect.height >= containerRect.height * 0.98;
  }

  function applyOverlayHitPolicy(container) {
    if (!container || hitPolicyAppliedContainers.has(container)) return;

    setHitPointerEvents(container, "none");

    function visit(element, inheritedDirective, ancestorPainted, isFragmentRoot) {
      const declared = element.getAttribute("data-akari-hit");
      const directive = ["pass", "catch"].includes(declared)
        ? declared
        : inheritedDirective;
      const style = getComputedStyle(element);
      const participatesInPaint =
        ancestorPainted && style.display !== "none" && Number(style.opacity) > 0;
      const isVisible =
        participatesInPaint && !["hidden", "collapse"].includes(style.visibility);

      let pointerEvents = "none";
      if (isVisible && directive === "catch") {
        pointerEvents = "auto";
      } else if (
        isVisible &&
        directive !== "pass" &&
        (!isFragmentRoot || !fragmentRootCoversContainer(element, container)) &&
        drawsOwnContent(element, style)
      ) {
        pointerEvents = "auto";
      }
      if ((container.dataset.role === 'shape-line' || container.dataset.role === 'shape')
        && isVisible && !directive) {
        pointerEvents = ['line', 'path', 'polyline', 'polygon', 'circle', 'rect']
          .includes(element.tagName.toLowerCase()) ? 'visiblePainted' : 'none';
      }
      // 明示 catch/pass は優先。自動判定の canvas は window 捕捉でアルファを検査する。
      alphaHitCanvases.delete(element);
      if (element.tagName === "CANVAS" && pointerEvents === "auto" && !directive) {
        alphaHitCanvases.add(element);
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

  // 旧ホストとの公開 API 互換のため呼び口は残す。当たり判定は
  // applyOverlayHitPolicy() の pointer-events 規約だけで完結し、描画を切る
  // clip-path は一切書かない。
  function syncOverlayHitRegion() {}

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
      verticalSnapGuide.parentElement !== document.body
    ) {
      verticalSnapGuide = createSnapGuide("vertical");
      document.body.appendChild(verticalSnapGuide);
    }
    if (
      !horizontalSnapGuide?.isConnected ||
      horizontalSnapGuide.parentElement !== document.body
    ) {
      horizontalSnapGuide = createSnapGuide("horizontal");
      document.body.appendChild(horizontalSnapGuide);
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

    // 外周ターゲットは 0 / width / height だが、ガイドは -0.5px
    // translate で線の中心を合わせる。overflow:hidden にクリップされないよう、
    // 表示位置だけをステージ内側へ半ピクセルクランプする。
    const { width, height } = outputSize();
    const stageRect = stage.getBoundingClientRect();
    const sx = stageRect.width / width, sy = stageRect.height / height;
    const clampGuidePosition = (target, extent) =>
      Math.min(Math.max(target, 0.5), Math.max(0.5, extent - 0.5));

    guides.vertical.hidden = !snapX;
    if (snapX) {
      guides.vertical.style.left = `${stageRect.left + clampGuidePosition(snapX.target, width) * sx}px`;
      guides.vertical.classList.toggle('is-item', snapX.kind === 'item');
      guides.vertical.style.top = `${stageRect.top + (snapX.guide?.start ?? 0) * sy}px`;
      guides.vertical.style.bottom = 'auto';
      guides.vertical.style.height = `${((snapX.guide?.end ?? height) - (snapX.guide?.start ?? 0)) * sy}px`;
    }

    guides.horizontal.hidden = !snapY;
    if (snapY) {
      guides.horizontal.style.top = `${stageRect.top + clampGuidePosition(snapY.target, height) * sy}px`;
      guides.horizontal.classList.toggle('is-item', snapY.kind === 'item');
      guides.horizontal.style.left = `${stageRect.left + (snapY.guide?.start ?? 0) * sx}px`;
      guides.horizontal.style.right = 'auto';
      guides.horizontal.style.width = `${((snapY.guide?.end ?? width) - (snapY.guide?.start ?? 0)) * sx}px`;
    }
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
    return isSelectable(eventTargetOverlay) ? eventTargetOverlay : null;
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

  // 素材の選択・ドラッグをまとめて止めるスイッチ。既定は有効なので shell / store は挙動不変。
  // Web UI は編集モードでない間これを false にする。後から選択を畳む方式だと、捕捉フェーズで
  // 既に始まったドラッグが生き残り「枠は出ないのに動かせる」状態になる（実機 2026-08-07）。
  let interactionEnabled = true;
  function setEnabled(next) {
    interactionEnabled = next !== false;
    if (!interactionEnabled) { clearMarquee(); clearSelection(); }
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

  // 2026-08-07 オーナー裁定・確定: role==="background" は
  // 「選択・削除はできるが、ドラッグ・拡縮では動かせない」種別（mount() が dataset.role を立てる。
  // preview-server の app.js / shell の overlay-runtime.js 双方）。要件の本質は「ずれたら直せる」
  // ではなく「ずらせない」なので、ドラッグ/リサイズの開始点そのものを isSelectable とは別に
  // isMovable で塞ぐ（選択自体は isSelectable のまま生かす）。
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
    const scale = cssVariableNumber(container, "--scale", 1);
    const hasAxis = ["--scale-x", "--scale-y"].some(name => container.style.getPropertyValue(name).trim());
    const scaleX = cssVariableNumber(container, "--scale-x", scale);
    const scaleY = cssVariableNumber(container, "--scale-y", scale);
    return {
      x: cssVariableNumber(container, "--x", 0),
      y: cssVariableNumber(container, "--y", 0),
      scale: hasAxis && scaleX === scaleY ? scaleX : scale,
      ...(hasAxis && scaleX !== scaleY ? { scaleX, scaleY } : {}),
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
    for (const edge of ["n", "e", "s", "w"]) {
      const handle = document.createElement("span");
      handle.className = `akari-interaction-handle is-edge is-${edge}`;
      handle.setAttribute("data-akari-interaction", "selection-handle");
      handle.setAttribute("aria-hidden", "true");
      frame.appendChild(handle);
    }
    for (const endpoint of ['start', 'end']) {
      const handle = document.createElement('span');
      handle.className = `akari-interaction-handle is-line-${endpoint}`;
      handle.hidden = true;
      handle.style.display = 'none';
      handle.setAttribute('data-akari-interaction', 'selection-handle');
      handle.setAttribute('aria-label', endpoint === 'start' ? '線の始点' : '線の終点');
      frame.appendChild(handle);
    }

    for (const [kind, label, path] of [
      ['rotate', '回転', '<path d="M19 7v5h-5M5 17v-5h5"/><path d="M6.7 9A7 7 0 0 1 19 12M17.3 15A7 7 0 0 1 5 12"/>'],
      ['move', '移動', '<path d="M12 2v20M2 12h20M12 2l-3 3m3-3 3 3m-3 17-3-3m3 3 3-3M2 12l3-3m-3 3 3 3m17-3-3-3m3 3-3 3"/>'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `akari-interaction-handle akari-interaction-action is-${kind}`;
      button.setAttribute('data-akari-interaction', 'selection-handle');
      button.setAttribute('aria-label', label);
      button.title = label;
      button.style.cssText = `top:auto;bottom:-38px;left:${kind === 'rotate' ? 'calc(50% - 27px)' : 'calc(50% + 2px)'};width:25px;height:25px;transform:none;`;
      button.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
      frame.appendChild(button);
    }

    return frame;
  }

  function refreshSelectionFrame() {
    if (collectiveSelection()) { refreshGroupFrame(); return; }
    if (!stage || !isSelectable(selectedOverlay)) return;

    const transform = readTransform(selectedOverlay);
    const rect = transform.rotate ? unrotatedLeafBounds(selectedOverlay) : fragmentBounds(selectedOverlay);
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

    // 背景は動かせない選択であることを視覚でも伝える（拡縮ハンドルを消し、枠を破線にする。
    // interaction.css の .is-locked）。isMovable ではなく isBackgroundRole を見るのは、
    // 選択自体は許すが移動系操作だけを塞ぐという役割分担を CSS 側にも一致させるため。
    selectionFrame.classList.toggle("is-locked", isBackgroundRole(selectedOverlay));
    selectionFrame.classList.toggle('is-busy', Boolean(activeDrag || activeResize || activeRotate || activeLine));
    selectionFrame.classList.toggle('is-moving', Boolean(activeDrag || activeRotate));
    selectionFrame.classList.toggle('is-text', selectedOverlay.dataset.role === 'text');
    selectionFrame.classList.toggle('is-line', selectedOverlay.dataset.role === 'shape-line');
    for (const endpoint of selectionFrame.querySelectorAll('.is-line-start, .is-line-end')) {
      endpoint.hidden = selectedOverlay.dataset.role !== 'shape-line';
      endpoint.style.display = selectedOverlay.dataset.role === 'shape-line' ? '' : 'none';
    }
    selectionFrame.dataset.akariSelectionKind = 'leaf';

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
    const pivot = leafPivotClient(transform);
    selectionFrame.style.transformOrigin = pivot
      ? `${pivot.x - rect.left}px ${pivot.y - rect.top}px` : 'center';
    selectionFrame.style.transform = transform.rotate ? `rotate(${transform.rotate}deg)` : '';
  }

  function trackSelectionFrame() {
    selectionTrackingFrame = null;
    if (collectiveSelection()) {
      refreshGroupFrame();
      selectionTrackingFrame = requestAnimationFrame(trackSelectionFrame);
      return;
    }
    if (!selectedOverlay && selectedId && selectionTree().length) {
      if (!treeNode(selectedId)) { clearSelection(); publishScopedSelection(false); return; }
      const replacement = containerById(selectedId);
      if (replacement) {
        selectedOverlay = replacement;
        replacement.setAttribute('data-akari-interaction-selected', 'true');
      } else {
        selectionTrackingFrame = requestAnimationFrame(trackSelectionFrame);
        return;
      }
    }
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
    if (activeRotate) cancelRotate();
    if (activeLine) finishLineEndpoint(true);
    flushNudge();
    hideHover();
    if (selectionTrackingFrame !== null) {
      cancelAnimationFrame(selectionTrackingFrame);
      selectionTrackingFrame = null;
    }
    for (const element of stage?.children ?? []) element.removeAttribute('data-akari-interaction-selected');
    selectedOverlay?.removeAttribute("data-akari-interaction-selected");
    selectedOverlay = null;
    selectedId = null;
    selectedIds = [];
    groupSelection = false;

    selectionFrame?.remove();
    selectionFrame = null;
    hideSnapGuides();
  }

  function handleSelectedOverlayUnavailable(container) {
    if (selectedOverlay !== container) return;
    if (selectionTree().length && !container.isConnected && treeNode(selectedId)) {
      selectedOverlay = null;
      if (selectionFrame) selectionFrame.hidden = true;
      startSelectionTracking();
      return;
    }

    if (activeDrag?.container === container) cancelDrag();
    if (activeResize?.container === container) cancelResize();
    if (activeRotate?.container === container) cancelRotate();
    if (activeEdit?.container === container) void commitEdit();
    clearSelection();
  }

  function selectOverlay(container) {
    if (!isSelectable(container)) return false;

    if (selectedOverlay !== container || selectedIds.length > 1) {
      clearSelection();
      selectedOverlay = container;
      selectedId = container.dataset.overlayId ?? null;
      selectedIds = selectedId === null ? [] : [selectedId];
      selectedOverlay.setAttribute("data-akari-interaction-selected", "true");
    }

    refreshSelectionFrame();
    startSelectionTracking();
    return true;
  }

  function selectionTree() {
    const tree = window.akari.state?.summary?.tree;
    return Array.isArray(tree) ? tree : [];
  }

  function treeNode(id) { return selectionTree().find(node => node.id === id); }
  function containerById(id) {
    return Array.from(stage?.children ?? []).find(element => element.dataset?.overlayId === id) ?? null;
  }
  function visibleMembers(id = selectedId) {
    const ids = new Set(descendantLeafIds(selectionTree(), id).map(leafId => {
      const parent = treeNode(treeNode(leafId)?.parentId);
      return parent?.lazy && containerById(parent.id) ? parent.id : leafId;
    }));
    if (containerById(id)) ids.add(id);
    return [...ids].map(containerById).filter(container => {
      if (!isSelectable(container)) return false;
      const style = getComputedStyle(container);
      return style.display !== 'none' && Number(style.opacity) !== 0;
    });
  }
  function unionBounds(containers) {
    const boxes = containers.map(fragmentBounds).filter(rect => rect?.width > 0 && rect?.height > 0);
    if (!boxes.length) return null;
    const left = Math.min(...boxes.map(rect => rect.left)), top = Math.min(...boxes.map(rect => rect.top));
    const right = Math.max(...boxes.map(rect => rect.right)), bottom = Math.max(...boxes.map(rect => rect.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }
  function refreshGroupFrame() {
    markSelectionMembers();
    const rect = activeRotate?.group && activeRotate.overlayId === selectedId
      ? activeRotate.startRect : unionBounds(selectionMembers());
    if (!rect) { if (selectionFrame) selectionFrame.hidden = true; return; }
    if (!selectionFrame?.isConnected) {
      selectionFrame = createSelectionFrame();
      document.body.appendChild(selectionFrame);
    }
    if (selectionKind() === 'multi') {
      for (const element of selectionFrame.querySelectorAll('.akari-interaction-handle, .akari-interaction-rotate-stem')) element.remove();
    } else if (!selectionFrame.querySelector('.akari-interaction-handle')) {
      const replacement = createSelectionFrame();
      selectionFrame.replaceWith(replacement);
      selectionFrame = replacement;
    }
    selectionFrame.dataset.akariSelectionKind = selectionKind();
    selectionFrame.classList.toggle('is-locked', selectionMembers().some(member => !isMovable(member)));
    selectionFrame.classList.toggle('is-busy', Boolean(activeDrag || activeResize || activeRotate));
    selectionFrame.classList.toggle('is-moving', Boolean(activeDrag || activeRotate));
    selectionFrame.style.transformOrigin = 'center';
    selectionFrame.style.transform = activeRotate?.group && activeRotate.overlayId === selectedId
      ? `rotate(${activeRotate.angle}deg)` : '';
    selectionFrame.hidden = false;
    Object.assign(selectionFrame.style, { left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px` });
  }
  function renderScopeBreadcrumb() {
    const nav = document.querySelector('[data-akari-ui="preview-scope-breadcrumb"]');
    if (!nav) return;
    nav.hidden = scopeId === floorScopeId || !selectionTree().length;
    nav.replaceChildren();
    if (nav.hidden) return;
    const path = lineage(selectionTree(), scopeId);
    const ids = floorScopeId === null ? [null, ...path] : path.slice(path.indexOf(floorScopeId));
    ids.forEach((id, index) => {
      if (index) nav.append(' › ');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = id === null ? '全体' : treeNode(id)?.label ?? id;
      button.addEventListener('click', () => {
        const hit = descendantLeafIds(selectionTree(), selectedId)[0] ?? selectedId;
        const next = resolveScopedSelection(selectionTree(), id, hit);
        applyScopedSelection({ scopeId: id, selectId: next.scopeId === id ? next.selectId : null });
      });
      nav.appendChild(button);
    });
  }
  function publishScopedSelection(notify = true) {
    syncLazyBag();
    renderScopeBreadcrumb();
    window.dispatchEvent(new CustomEvent('akari-preview-scope-selection', { detail: { notify } }));
  }
  let requestedBagId = null;
  function syncLazyBag() {
    const bagId = lazyBagForScope(selectionTree(), scopeId);
    if (bagId === requestedBagId || !window.akari.requestBagExpansion) return;
    requestedBagId = bagId;
    window.akari.requestBagExpansion(bagId);
  }
  function scopedHitId(container, event) {
    const id = container?.dataset.overlayId;
    if (!treeNode(id)?.lazy) return id;
    // The unexpanded bag still has the original named DOM. Resolve the hit
    // there before asking the host to replace it with masked part mounts.
    const candidates = [event.target, ...document.elementsFromPoint(event.clientX, event.clientY)];
    const part = candidates.map(element => element instanceof Element
      ? element.closest('[data-akari-part]') : null).find(element => element && container.contains(element));
    const partId = part?.getAttribute('data-akari-part') ?? null;
    const childId = partId === null ? null : id + '#' + partId;
    return treeNode(childId) ? childId : id;
  }
  function applyScopedSelection(next, { notify = true } = {}) {
    const previousId = selectedId;
    const previousIds = [...selectedIds];
    const previousScopeId = scopeId;
    const wasMultiple = selectedIds.length > 1;
    const tree = selectionTree();
    if (floorScopeId !== null && next.selectId !== null
      && !lineage(tree, next.selectId).includes(floorScopeId)) return false;
    if (floorScopeId !== null && next.scopeId !== floorScopeId
      && !lineage(tree, next.scopeId).includes(floorScopeId)) next = { ...next, scopeId: floorScopeId };
    const node = treeNode(next.selectId);
    scopeId = next.scopeId;
    if (node && node.kind !== 'leaf') {
      clearSelection();
      selectedId = node.id;
      selectedIds = [node.id];
      groupSelection = true;
      refreshSelectionFrame();
      startSelectionTracking();
    } else if (next.selectId === null) clearSelection();
    else if (!selectOverlay(containerById(next.selectId))) {
      if (!node?.lazy || lazyBagForScope(tree, scopeId) !== node.parentId) return false;
      clearSelection();
      selectedId = node.id;
      selectedIds = [node.id];
      startSelectionTracking(); // Rebind to the leaf after the host response mounts it.
    }
    const unchangedMultiRepresentative = (wasMultiple || selectedIds.length > 1) && previousId === selectedId;
    const changedSetOrScope = previousScopeId !== scopeId || previousIds.length !== selectedIds.length
      || previousIds.some((id, index) => id !== selectedIds[index]);
    publishScopedSelection(notify && (!unchangedMultiRepresentative || changedSetOrScope));
    return true;
  }
  function selectScopedHit(container, event) {
    const id = scopedHitId(container, event);
    if (!id) return false;
    const next = resolveScopedSelection(selectionTree(), scopeId, id,
      { deep: Boolean(event.metaKey || event.ctrlKey) });
    if (!event.shiftKey) return applyScopedSelection(next);
    if (floorScopeId !== null && !lineage(selectionTree(), next.selectId).includes(floorScopeId)) return false;
    const selection = toggleScopedSelection(selectionTree(), selectedIds, scopeId, next);
    if (selection.selectedIds.length < 2) return applyScopedSelection(selection);
    return setScopedMultiSelection(selection.selectedIds, selection.scopeId);
  }
  function setScopedMultiSelection(ids, nextScopeId) {
    if (ids.length < 2) return false;
    const unchanged = scopeId === nextScopeId && ids.length === selectedIds.length
      && ids.every((id, index) => id === selectedIds[index]);
    if (unchanged) return true;
    clearSelection();
    scopeId = nextScopeId;
    selectedIds = [...ids];
    selectedId = ids.at(-1);
    refreshSelectionFrame();
    startSelectionTracking();
    publishScopedSelection();
    return true;
  }

  function marqueeCandidates() {
    return selectionTree().filter(node => node.parentId === scopeId
      && (floorScopeId === null || lineage(selectionTree(), node.id).includes(floorScopeId)))
      .map(node => {
        const leaf = containerById(node.id);
        return { id: node.id, bounds: node.kind === 'leaf'
          ? leaf ? fragmentBounds(leaf) : null : unionBounds(visibleMembers(node.id)) };
      })
      .filter(candidate => candidate.bounds);
  }
  function marqueeRect(start, end) {
    const left = Math.min(start.x, end.x), top = Math.min(start.y, end.y);
    const right = Math.max(start.x, end.x), bottom = Math.max(start.y, end.y);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }
  function clearMarquee() {
    pendingBlank = null;
    marqueeFrame?.remove();
    marqueeFrame = null;
    for (const element of stage?.children ?? []) element.removeAttribute('data-akari-interaction-marquee-hit');
  }
  function updateMarquee(event) {
    const pending = pendingBlank;
    if (!pending) return;
    if (!marqueeFrame) {
      marqueeFrame = document.createElement('div');
      marqueeFrame.setAttribute('data-akari-ui', 'preview-marquee');
      marqueeFrame.setAttribute('aria-hidden', 'true');
      Object.assign(marqueeFrame.style, { position: 'fixed', pointerEvents: 'none',
        boxSizing: 'border-box', border: '1px solid var(--akari-accent, #4da3ff)',
        background: 'rgba(77, 163, 255, 0.14)', zIndex: '91' });
      document.body.appendChild(marqueeFrame);
    }
    const rect = marqueeRect(pending, { x: event.clientX, y: event.clientY });
    Object.assign(marqueeFrame.style, { left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px` });
    const ids = marqueeHits(marqueeCandidates(), rect);
    pending.hits = ids;
    const members = new Set(ids.flatMap(id => visibleMembers(id)));
    for (const element of stage?.children ?? []) {
      if (members.has(element)) element.setAttribute('data-akari-interaction-marquee-hit', 'true');
      else element.removeAttribute('data-akari-interaction-marquee-hit');
    }
  }
  function finishMarquee(event) {
    const pending = pendingBlank;
    if (!pending) return;
    if (!pending.started) {
      clearMarquee();
      if (!pending.release) return;
      if (activeEdit) void commitEdit();
      applyScopedSelection({ selectId: null,
        scopeId: pending.bagExit !== undefined ? pending.bagExit : pending.scopeId });
      return;
    }
    updateMarquee(event);
    const hits = pending.hits ?? [];
    const sibling = id => treeNode(id)?.parentId === pending.scopeId;
    const additive = pending.shift && selectedIds.every(sibling) && scopeId === pending.scopeId;
    const ids = additive ? [...selectedIds, ...hits.filter(id => !selectedIds.includes(id))] : hits;
    clearMarquee();
    if (!ids.length) {
      if (!pending.shift) applyScopedSelection({ selectId: null, scopeId: pending.scopeId });
    } else if (ids.length === 1) applyScopedSelection({ selectId: ids[0], scopeId: pending.scopeId });
    else setScopedMultiSelection(ids, pending.scopeId);
  }
  function selectFromTimeline(id) {
    if (!selectionTree().length) return false;
    if (id === selectedId) return true; // Selection echo must not reset drill-in.
    if (id === null) return applyScopedSelection({ selectId: null, scopeId }, { notify: false });
    const node = treeNode(id);
    if (!node) return false;
    return applyScopedSelection({ selectId: id, scopeId: node.parentId }, { notify: false });
  }
  function setSelectionFloor(id) {
    if (!selectionTree().length) { floorScopeId = null; scopeId = null; return; }
    if (id !== null && typeof id !== 'string') return;
    if (activeDrag) cancelDrag();
    if (activeResize) cancelResize();
    if (activeRotate) cancelRotate();
    if (activeEdit) void commitEdit();
    floorScopeId = id;
    scopeId = id;
    clearSelection();
    publishScopedSelection(false);
  }
  function beginGroupDrag(event, container) {
    const members = selectionMembers().map(element => ({ element, transform: readTransform(element) }));
    if (!members.length || (selectedIds.length > 1 && members.some(member => !isMovable(member.element)))) return;
    const world = treeNode(selectedId)?.transform ?? {};
    activeDrag = { group: true, targets: movementTargets(), container, members, overlayId: selectedId, pointerId: event.pointerId,
      startClientX: event.clientX, startClientY: event.clientY,
      startStagePoint: stageLocalPoint(event.clientX, event.clientY),
      startX: world.x ?? 0, startY: world.y ?? 0, dx: 0, dy: 0,
      snapX: null, snapY: null, moved: false, duplicate: event.altKey,
      writeContext: captureWriteContext() };
    try { container.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
  }
  function moveGroupMembers(drag, dx, dy) {
    drag.dx = dx; drag.dy = dy;
    for (const { element, transform } of drag.members) {
      element.style.setProperty('--x', `${transform.x + dx}px`);
      element.style.setProperty('--y', `${transform.y + dy}px`);
    }
    refreshGroupFrame();
  }

  // Keep this classic-script copy identical to world-delta.mjs.
  // BEGIN world-delta
  function worldDelta(oldPose, newPose) {
    const scale = (newPose.scale ?? 1) / (oldPose.scale ?? 1);
    const rotate = (newPose.rotate ?? 0) - (oldPose.rotate ?? 0);
    const radians = rotate * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    const oldX = oldPose.x ?? 0, oldY = oldPose.y ?? 0;
    return { scale, rotate,
      x: (newPose.x ?? 0) - scale * (cosine * oldX - sine * oldY),
      y: (newPose.y ?? 0) - scale * (sine * oldX + cosine * oldY) };
  }

  function applyWorldDelta(delta, childWorld) {
    const radians = delta.rotate * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    const x = childWorld.x ?? 0, y = childWorld.y ?? 0;
    return { ...childWorld,
      x: delta.x + delta.scale * (cosine * x - sine * y),
      y: delta.y + delta.scale * (sine * x + cosine * y),
      scale: (childWorld.scale ?? 1) * delta.scale,
      ...(childWorld.scaleX === undefined ? {} : { scaleX: childWorld.scaleX * delta.scale }),
      ...(childWorld.scaleY === undefined ? {} : { scaleY: childWorld.scaleY * delta.scale }),
      rotate: (childWorld.rotate ?? 0) + delta.rotate };
  }
  // END world-delta

  function syncLeafTransformOnSuccess(record, overlayId, transform) {
    record.promise.then(() => {
      const node = treeNode(overlayId);
      if (node?.kind === 'leaf') node.transform = { ...transform };
    }, () => undefined);
  }

  function syncGroupDescendants(overlayId, oldPose, newPose, members) {
    const delta = worldDelta(oldPose, newPose);
    const memberWorlds = new Map(members.map(member => [member.element.dataset.overlayId, member.transform]));
    const tree = selectionTree();
    for (const node of tree) {
      if (node.id === overlayId || !lineage(tree, node.id).includes(overlayId)) continue;
      const world = node.transform ?? memberWorlds.get(node.id);
      if (world) node.transform = applyWorldDelta(delta, world);
    }
  }

  function setWorldTransform(element, transform) {
    element.style.setProperty('--x', `${transform.x}px`);
    element.style.setProperty('--y', `${transform.y}px`);
    element.style.setProperty('--scale', String(transform.scale));
    element.style.setProperty('--rotate', `${transform.rotate}deg`);
    if (transform.scaleX !== undefined) element.style.setProperty('--scale-x', String(transform.scaleX));
    if (transform.scaleY !== undefined) element.style.setProperty('--scale-y', String(transform.scaleY));
  }

  function groupPoseAt(gesture, nextPose) {
    gesture.pose = nextPose;
    const delta = worldDelta(gesture.oldPose, nextPose);
    for (const member of gesture.members) {
      setWorldTransform(member.element, applyWorldDelta(delta, member.transform));
    }
    if (!activeRotate?.group) refreshGroupFrame();
  }

  function restoreGroupPose(gesture) {
    for (const member of gesture.members) setWorldTransform(member.element, member.transform);
    selectionFrame.style.transform = '';
    refreshGroupFrame();
  }

  function finishGroupTransform(gesture) {
    const node = treeNode(gesture.overlayId);
    const previous = node?.transform;
    const transform = { x: gesture.pose.x, y: gesture.pose.y,
      scale: gesture.pose.scale, rotate: gesture.pose.rotate };
    const applied = { ...previous, ...transform };
    if (node) node.transform = applied;
    const record = enqueueWrite(gesture.writeContext, gesture.overlayId, { transform }, 'transform');
    record.promise.then(() => syncGroupDescendants(gesture.overlayId, previous ?? {}, applied, gesture.members),
      () => undefined);
    record.promise.catch(error => {
      if (node?.transform === applied) node.transform = previous;
      restoreGroupPose(gesture);
      reportWriteError('transform', gesture.overlayId, error);
    });
    lastTransformWrite = record;
    return record;
  }
  function moveGroupDrag(drag, dx, dy, disabled, lockedAxis = null) {
    moveGroupMembers(drag, dx, dy);
    const rect = unionBounds(drag.members.map(member => member.element).filter(isSelectable));
    const tl = rect && stageLocalPoint(rect.left, rect.top), br = rect && stageLocalPoint(rect.right, rect.bottom);
    if (disabled || !tl || !br) { drag.snapX = null; drag.snapY = null; hideSnapGuides(); return; }
    const bounds = { left: tl.x, top: tl.y, right: br.x, bottom: br.y,
      centerX: (tl.x + br.x) / 2, centerY: (tl.y + br.y) / 2 };
    const snap = computeSnapCorrection(bounds, { x: drag.snapX, y: drag.snapY });
    if (lockedAxis === 'x') snap.y = null;
    if (lockedAxis === 'y') snap.x = null;
    drag.snapX = snap.x; drag.snapY = snap.y;
    moveGroupMembers(drag, dx + (snap.x?.correction ?? 0), dy + (snap.y?.correction ?? 0));
    showSnapGuides(snap.x, snap.y);
  }
  function movementTargets() {
    return selectedIds.map(id => {
      const node = treeNode(id);
      const container = containerById(id);
      const transform = node?.kind === 'leaf' && container ? readTransform(container) : node?.transform ?? {};
      return { id, node, previousTransform: node?.transform, x: transform.x ?? 0, y: transform.y ?? 0 };
    });
  }
  function finishGroupDrag(drag) {
    if (!drag.moved || (Math.abs(drag.dx) < .5 && Math.abs(drag.dy) < .5)) {
      moveGroupMembers(drag, 0, 0); return null;
    }
    const targets = drag.targets ?? [{ id: drag.overlayId, node: treeNode(drag.overlayId),
      previousTransform: treeNode(drag.overlayId)?.transform, x: drag.startX, y: drag.startY }];
    if (drag.duplicate && targets.length === 1) {
      const target = targets[0];
      const transform = { x: target.x + drag.dx, y: target.y + drag.dy };
      moveGroupMembers(drag, 0, 0);
      const record = enqueueWrite(drag.writeContext, target.id,
        { transform, duplicate: true }, 'transform');
      lastTransformWrite = record;
      return record;
    }
    const writes = targets.map(target => {
      const transform = { x: target.x + drag.dx, y: target.y + drag.dy };
      target.appliedTransform = target.node?.kind === 'leaf' && containerById(target.id)
        ? readTransform(containerById(target.id)) : { ...target.previousTransform, ...transform };
      if (target.node) target.node.transform = target.appliedTransform;
      return { overlayId: target.id, patch: { transform } };
    });
    const record = writes.length > 1 ? enqueueWriteBatch(drag.writeContext, writes)
      : enqueueWrite(drag.writeContext, writes[0].overlayId, writes[0].patch, 'transform');
    record.promise.then(() => {
      for (const target of targets) {
        if (target.node?.kind === 'group') {
          syncGroupDescendants(target.id, target.previousTransform ?? {}, target.appliedTransform, drag.members);
        }
      }
    }, () => undefined);
    record.promise.catch(error => {
      for (const target of targets) {
        if (target.node?.transform === target.appliedTransform) target.node.transform = target.previousTransform;
      }
      moveGroupMembers(drag, 0, 0);
      reportWriteError('transform', drag.overlayId, error);
    });
    lastTransformWrite = record;
    return record;
  }

  function flushNudge() {
    clearTimeout(nudgeTimer);
    nudgeTimer = null;
    const session = nudge;
    nudge = null;
    if (!session || (!session.dx && !session.dy)) return;
    if (session.group) { finishGroupDrag(session); return; }
    const transform = { ...session.transform,
      x: session.startX + session.dx, y: session.startY + session.dy };
    const record = enqueueWrite(session.writeContext, session.overlayId, { transform }, 'transform');
    syncLeafTransformOnSuccess(record, session.overlayId, transform);
    lastTransformWrite = record;
    record.promise.catch(() => {
      const current = readTransform(session.container);
      if (current.x !== transform.x || current.y !== transform.y) return;
      session.container.style.setProperty('--x', `${session.startX}px`);
      session.container.style.setProperty('--y', `${session.startY}px`);
      refreshSelectionFrame();
    });
  }

  function handleNudge(event) {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta || !interactionEnabled || !selectedId || activeEdit || activeDrag || activeResize
      || event.metaKey || event.ctrlKey || event.altKey || !document.hasFocus()) return false;
    const isControl = target => target instanceof Element
      && (target.isContentEditable || target.closest('input, textarea, select, button, [role="textbox"]'));
    if (isControl(event.target) || isControl(document.activeElement)) return false;
    const members = collectiveSelection() ? selectionMembers() : [selectedOverlay];
    if (!members.length || members.some(element => !isMovable(element))) return false;
    if (nudge && nudge.overlayId !== selectedId) flushNudge();
    if (!nudge) {
      const transform = collectiveSelection() ? treeNode(selectedId)?.transform ?? {} : readTransform(selectedOverlay);
      nudge = { group: collectiveSelection(), targets: collectiveSelection() ? movementTargets() : null, overlayId: selectedId, container: selectedOverlay,
        members: members.map(element => ({ element, transform: readTransform(element) })),
        transform, startX: transform.x ?? 0, startY: transform.y ?? 0, dx: 0, dy: 0,
        moved: true, writeContext: captureWriteContext() };
    }
    const step = event.shiftKey ? 10 : 1;
    nudge.dx += delta[0] * step; nudge.dy += delta[1] * step;
    for (const { element, transform } of nudge.members) {
      element.style.setProperty('--x', `${transform.x + nudge.dx}px`);
      element.style.setProperty('--y', `${transform.y + nudge.dy}px`);
    }
    hideHover();
    refreshSelectionFrame();
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(flushNudge, 400);
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    return true;
  }

  function cycleCandidates(event) {
    const candidates = [];
    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
      const container = findOverlayContainer(element);
      if (!isSelectable(container)) continue;
      const next = resolveScopedSelection(selectionTree(), scopeId, scopedHitId(container, { clientX: event.clientX, clientY: event.clientY, target: element }));
      if (next.scopeId !== scopeId || !next.selectId || candidates.includes(next.selectId)) continue;
      if (floorScopeId !== null && !lineage(selectionTree(), next.selectId).includes(floorScopeId)) continue;
      candidates.push(next.selectId);
    }
    return candidates;
  }

  function hideHover() {
    hoverEvent = null;
    if (hoverTick !== null) cancelAnimationFrame(hoverTick);
    hoverTick = null;
    if (hoverFrame) hoverFrame.hidden = true;
  }
  function scheduleHover(event) {
    if (!interactionEnabled || activeDrag || activeResize || activeEdit || event.buttons) { hideHover(); return; }
    hoverEvent = event;
    if (hoverTick !== null) return;
    hoverTick = requestAnimationFrame(() => {
      hoverTick = null;
      const event = hoverEvent;
      if (!event || activeDrag || activeResize || activeEdit) { hideHover(); return; }
      const container = overlayForEvent(event);
      const next = isSelectable(container) && resolveScopedSelection(selectionTree(), scopeId,
        scopedHitId(container, event), { deep: Boolean(event.metaKey || event.ctrlKey) });
      if (!next || selectedIds.includes(next.selectId) || selectionMembers().includes(container) || (floorScopeId !== null
        && !lineage(selectionTree(), next.selectId).includes(floorScopeId))) { hideHover(); return; }
      const node = treeNode(next.selectId);
      const leaf = containerById(next.selectId);
      const rect = node && node.kind !== 'leaf' ? unionBounds(visibleMembers(next.selectId))
        : leaf ? fragmentBounds(leaf) : null;
      if (!rect) { hideHover(); return; }
      if (!hoverFrame) {
        hoverFrame = document.createElement('div');
        hoverFrame.setAttribute('data-akari-ui', 'preview-hover-frame');
        hoverFrame.setAttribute('aria-hidden', 'true');
        // Standalone hosts also get a non-interactive, viewport-based frame.
        Object.assign(hoverFrame.style, { position: 'fixed', pointerEvents: 'none',
          boxSizing: 'border-box', border: '1px solid var(--akari-accent, #4da3ff)', opacity: '0.45', zIndex: '90' });
        document.body.appendChild(hoverFrame);
      }
      hoverFrame.dataset.overlayId = next.selectId;
      hoverFrame.hidden = false;
      Object.assign(hoverFrame.style, { left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px` });
    });
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
    if (drag.group) {
      moveGroupMembers(drag, 0, 0);
      releasePointer(drag); hideSnapGuides(); return;
    }
    drag.container.style.setProperty("--x", `${drag.startX}px`);
    drag.container.style.setProperty("--y", `${drag.startY}px`);
    if (drag.motionDriven) delete drag.container.dataset.akariMotionDragging;
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

    if (drag.group) return finishGroupDrag(drag);
    if (!drag.moved) {
      if (drag.motionDriven) delete drag.container.dataset.akariMotionDragging;
      return null;
    }

    const transform = readTransform(drag.container);
    // 位置が実質変わっていないなら書かない。drag.moved は「動き始めたか」しか見ていないので、
    // しきい値を越えてから元の位置へ戻して離すと、変化ゼロのまま書き込みが走っていた
    // （実機 2026-08-07: 移動量 0.00004px の transform が edit.json に残留）。
    // 出力座標で 0.5px 未満 = 目にも見えないし、意図した調整でもない。
    const WRITE_EPSILON_PX = 0.5;
    if (
      Math.abs(transform.x - drag.startX) < WRITE_EPSILON_PX &&
      Math.abs(transform.y - drag.startY) < WRITE_EPSILON_PX
    ) {
      // 端数を残さないよう開始値へ戻し、何も書かずに終える
      drag.container.style.setProperty("--x", `${drag.startX}px`);
      drag.container.style.setProperty("--y", `${drag.startY}px`);
      if (drag.motionDriven) delete drag.container.dataset.akariMotionDragging;
      refreshSelectionFrame();
      return null;
    }
    const patch = drag.motionDriven && !drag.duplicate ? { x: transform.x, y: transform.y } : transform;
    const record = enqueueWrite(
      drag.writeContext,
      drag.overlayId,
      { transform: patch, ...(drag.duplicate ? { duplicate: true } : {}) },
      "transform"
    );
    if (drag.duplicate) {
      drag.container.style.setProperty('--x', `${drag.startX}px`);
      drag.container.style.setProperty('--y', `${drag.startY}px`);
      if (drag.motionDriven) delete drag.container.dataset.akariMotionDragging;
      refreshSelectionFrame();
    } else {
      syncLeafTransformOnSuccess(record, drag.overlayId, transform);
      if (drag.motionDriven) record.promise.catch(() => {
        delete drag.container.dataset.akariMotionDragging;
        drag.container.style.setProperty('--x', `${drag.startX}px`);
        drag.container.style.setProperty('--y', `${drag.startY}px`);
        refreshSelectionFrame();
      });
    }
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
    if (container?.dataset?.role === 'shape-line') {
      const transform = readTransform(container);
      const left = rotatedLeafCorners(container, null, transform, 'w');
      const right = rotatedLeafCorners(container, null, transform, 'e');
      const a = left && stageLocalPoint(left.dragged.x, left.dragged.y);
      const b = right && stageLocalPoint(right.dragged.x, right.dragged.y);
      if (a && b) {
        const stroke = Number(container.querySelector('line')?.getAttribute('stroke-width')) || 1;
        const radius = stroke * Math.abs(transform.scaleY ?? transform.scale) / 2;
        const bounds = { left: Math.min(a.x, b.x) - radius, right: Math.max(a.x, b.x) + radius,
          top: Math.min(a.y, b.y) - radius, bottom: Math.max(a.y, b.y) + radius };
        return { ...bounds, centerX: (bounds.left + bounds.right) / 2,
          centerY: (bounds.top + bounds.bottom) / 2 };
      }
    }
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

  // キャンバス外周 + センター縦横の共通吸着ターゲット。
  // 移動と四隅 resize の候補がずれないよう、並びを含めここを単一正本にする。
  function canvasSnapTargets() {
    const { width, height } = outputSize();
    return {
      x: [0, width / 2, width],
      y: [0, height / 2, height],
    };
  }

  // 共通吸着候補を、出力px単位の bounds
  // {left,top,right,bottom,centerX,centerY} から計算する。overlays のドラッグに限らず、
  // resize・layers[]・cut/caption のドラッグからも共通で呼べるよう window.akari.interaction
  // 経由でも公開する（㉒ スナップ統一の単一正本）。
  function computeSnapCorrection(bounds, previousSnap) {
    if (!bounds) return { x: null, y: null };
    if (!globalThis.akariHandleGeometry) {
      const targets = canvasSnapTargets();
      return { x: closestAxisSnap([bounds.left, bounds.centerX, bounds.right], targets.x,
        previousSnap?.x ?? null, currentDisplayScale()),
      y: closestAxisSnap([bounds.top, bounds.centerY, bounds.bottom], targets.y,
        previousSnap?.y ?? null, currentDisplayScale()) };
    }
    const others = stage ? Array.from(stage.children)
      .filter(element => isSelectable(element) && element !== selectedOverlay)
      .map(fragmentVideoBounds).filter(Boolean) : [];
    return globalThis.akariHandleGeometry.snapBounds(bounds, others, outputSize(), currentDisplayScale());
  }

  function applyDragSnapping(drag, rawX, rawY, disabled, lockedAxis = null) {
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
    if (lockedAxis === 'x') snap.y = null;
    if (lockedAxis === 'y') snap.x = null;
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
    anchorStageY,
  }) {
    if (
      !stage ||
      !Number.isFinite(startScale) ||
      startScale === 0 ||
      !Number.isFinite(anchorStageX) ||
      !Number.isFinite(anchorStageY)
    ) {
      return null;
    }

    const dx = anchorStageX - stage.clientWidth / 2;
    const dy = anchorStageY - stage.clientHeight / 2;
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

  function handleEdge(handleEl) {
    if (!handleEl.classList.contains('is-edge')) return null;
    return ['n', 'e', 's', 'w'].find(edge => handleEl.classList.contains(`is-${edge}`)) ?? null;
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

  function edgePoint(rect, edge, opposite = false) {
    const side = opposite ? { n: 's', e: 'w', s: 'n', w: 'e' }[edge] : edge;
    switch (side) {
      case 'n': return { x: rect.left + rect.width / 2, y: rect.top };
      case 'e': return { x: rect.right, y: rect.top + rect.height / 2 };
      case 's': return { x: rect.left + rect.width / 2, y: rect.bottom };
      default: return { x: rect.left, y: rect.top + rect.height / 2 };
    }
  }

  function clampScale(value) {
    if (!Number.isFinite(value)) return 1;
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
  }

  function unrotatedLeafBounds(container) {
    const previous = container.style.getPropertyValue('--rotate');
    container.style.setProperty('--rotate', '0deg');
    const rect = fragmentBounds(container);
    if (previous) container.style.setProperty('--rotate', previous);
    else container.style.removeProperty('--rotate');
    return rect;
  }

  function leafPivotClient(transform) {
    if (!stage) return null;
    const stageRect = stage.getBoundingClientRect();
    const displayX = stageRect.width / stage.clientWidth;
    const displayY = stageRect.height / stage.clientHeight;
    return { x: stageRect.left + stageRect.width / 2 + transform.x * displayX,
      y: stageRect.top + stageRect.height / 2 + transform.y * displayY };
  }

  function rotatedLeafCorners(container, corner, transform, edge = null) {
    if (!transform.rotate) return null;
    const rect = unrotatedLeafBounds(container);
    if (!rect) return null;
    const stageRect = stage.getBoundingClientRect();
    const displayX = stageRect.width / stage.clientWidth;
    const displayY = stageRect.height / stage.clientHeight;
    const pivot = leafPivotClient(transform);
    const radians = transform.rotate * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    const rotatePoint = point => {
      // The unrotated bounds already include axis scale. CSS applies R after S,
      // so rotate those displayed corners around the same pivot without S^-1.
      const dx = (point.x - pivot.x) / displayX, dy = (point.y - pivot.y) / displayY;
      return { x: pivot.x + displayX * (cosine * dx - sine * dy),
        y: pivot.y + displayY * (sine * dx + cosine * dy) };
    };
    return { anchor: rotatePoint(edge ? edgePoint(rect, edge, true) : cornerAnchorPoint(rect, corner)),
      dragged: rotatePoint(edge ? edgePoint(rect, edge) : namedCornerPoint(rect, corner)) };
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

  function beginLineEndpoint(event, handleEl) {
    if (!selectedOverlay || !globalThis.akariHandleGeometry) return;
    const pose = readTransform(selectedOverlay);
    const start = rotatedLeafCorners(selectedOverlay, null, pose, 'w');
    const end = rotatedLeafCorners(selectedOverlay, null, pose, 'e');
    const rect = unrotatedLeafBounds(selectedOverlay);
    const left = start?.dragged ?? (rect && edgePoint(rect, 'w'));
    const right = end?.dragged ?? (rect && edgePoint(rect, 'e'));
    if (!left || !right) return;
    const a = stageLocalPoint(left.x, left.y), b = stageLocalPoint(right.x, right.y);
    const pointer = stageLocalPoint(event.clientX, event.clientY);
    if (!a || !b || !pointer) return;
    const movingEndpoint = handleEl.classList.contains('is-line-start') ? 'start' : 'end';
    activeLine = { container: selectedOverlay, overlayId: selectedId, pose,
      fixed: movingEndpoint === 'start' ? b : a,
      originalMoving: movingEndpoint === 'start' ? a : b,
      movingEndpoint, handleEl, pointerId: event.pointerId,
      pointerOffset: { x: (movingEndpoint === 'start' ? a : b).x - pointer.x,
        y: (movingEndpoint === 'start' ? a : b).y - pointer.y },
      moved: false, writeContext: captureWriteContext() };
    handleHint?.remove();
    handleHint = document.createElement('div');
    handleHint.className = 'akari-interaction-hint';
    handleHint.setAttribute('data-akari-interaction', 'handle-hint');
    handleHint.textContent = '線の長さと向き';
    handleHint.style.left = `${event.clientX + 12}px`;
    handleHint.style.top = `${event.clientY + 12}px`;
    document.body.appendChild(handleHint);
    try { handleEl.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
    if (event.cancelable) event.preventDefault();
  }

  function updateLineEndpoint(event) {
    const line = activeLine;
    if (!line || event.pointerId !== line.pointerId) return;
    const point = stageLocalPoint(event.clientX, event.clientY);
    if (!point) return;
    const others = stage ? Array.from(stage.children)
      .filter(element => isSelectable(element) && element !== line.container)
      .map(fragmentVideoBounds).filter(Boolean) : [];
    const solved = globalThis.akariHandleGeometry.solveLineEndpoint(line.fixed,
      { x: point.x + line.pointerOffset.x, y: point.y + line.pointerOffset.y },
      others, outputSize(), currentDisplayScale(), event.metaKey || event.ctrlKey, point);
    const pose = globalThis.akariHandleGeometry.lineTransform({ fixed: line.fixed,
      originalMoving: line.originalMoving, moving: solved.point,
      movingEndpoint: line.movingEndpoint,
      stageCenter: { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }, pose: line.pose });
    if (!pose) return;
    line.container.style.setProperty('--x', `${pose.x}px`);
    line.container.style.setProperty('--y', `${pose.y}px`);
    line.container.style.setProperty('--scale-x', String(pose.scaleX));
    line.container.style.setProperty('--scale-y', String(pose.scaleY));
    line.container.style.setProperty('--rotate', `${pose.rotate}deg`);
    line.moved = true;
    showSnapGuides(solved.snap.x, solved.snap.y);
    if (event.cancelable) event.preventDefault();
  }

  function finishLineEndpoint(cancelled = false) {
    const line = activeLine;
    if (!line) return null;
    activeLine = null;
    handleHint?.remove(); handleHint = null;
    releaseResizePointer(line);
    hideSnapGuides();
    if (cancelled || !line.moved) {
      for (const [name, value] of [['--x', `${line.pose.x}px`], ['--y', `${line.pose.y}px`],
        ['--scale', String(line.pose.scale)], ['--rotate', `${line.pose.rotate}deg`]]) {
        line.container.style.setProperty(name, value);
      }
      if (line.pose.scaleX === undefined) line.container.style.removeProperty('--scale-x');
      else line.container.style.setProperty('--scale-x', String(line.pose.scaleX));
      if (line.pose.scaleY === undefined) line.container.style.removeProperty('--scale-y');
      else line.container.style.setProperty('--scale-y', String(line.pose.scaleY));
      refreshSelectionFrame();
      return null;
    }
    const transform = readTransform(line.container);
    const record = enqueueWrite(line.writeContext, line.overlayId, { transform }, 'transform');
    syncLeafTransformOnSuccess(record, line.overlayId, transform);
    lastTransformWrite = record;
    return record;
  }

  function beginResize(event, container, handleEl) {
    if (activeEdit) void commitEdit();

    // 断片の実表示矩形（ステージ全体=コンテナの矩形ではなく、実際に見えている
    // 断片ルートの矩形）を基準にする。取得できない異常系のみコンテナ矩形へ退避。
    const visualRect = fragmentBounds(container) ?? container.getBoundingClientRect();
    const corner = handleCorner(handleEl);
    const edge = handleEdge(handleEl);
    const transform = readTransform(container);
    const rotated = rotatedLeafCorners(container, corner, transform, edge);
    const anchorClient = rotated?.anchor ?? (edge ? edgePoint(visualRect, edge, true) : cornerAnchorPoint(visualRect, corner));
    const draggedClient = rotated?.dragged ?? (edge ? edgePoint(visualRect, edge) : namedCornerPoint(visualRect, corner));
    const anchor = stageLocalPoint(anchorClient.x, anchorClient.y);
    const dragged = stageLocalPoint(draggedClient.x, draggedClient.y);
    const pointer = stageLocalPoint(event.clientX, event.clientY);
    if (!anchor || !dragged || !pointer) return;

    const pointerOffsetX = rotated ? dragged.x - pointer.x : 0;
    const pointerOffsetY = rotated ? dragged.y - pointer.y : 0;
    const startDistance = Math.hypot(pointer.x + pointerOffsetX - anchor.x,
      pointer.y + pointerOffsetY - anchor.y);

    activeResize = {
      container,
      handleEl,
      overlayId: container.dataset.overlayId ?? "",
      pointerId: event.pointerId,
      corner,
      edge,
      rotation: transform.rotate * Math.PI / 180,
      anchorStageX: anchor.x,
      anchorStageY: anchor.y,
      draggedStageX: dragged.x,
      draggedStageY: dragged.y,
      startDistance: startDistance || 1, // 0除算回避（アンカーとハンドルが重なる異常系向け保険）
      pointerOffsetX,
      pointerOffsetY,
      startScale: transform.scale,
      startScaleX: transform.scaleX ?? transform.scale,
      startScaleY: transform.scaleY ?? transform.scale,
      axisCss: [container.style.getPropertyValue("--scale-x"), container.style.getPropertyValue("--scale-y")],
      startX: transform.x,
      startY: transform.y,
      snapX: null,
      snapY: null,
      moved: false,
      writeContext: captureWriteContext(),
    };
    handleHint?.remove();
    handleHint = document.createElement('div');
    handleHint.className = 'akari-interaction-hint';
    handleHint.setAttribute('data-akari-interaction', 'handle-hint');
    handleHint.textContent = edge ? (container.dataset.role === 'text' ? '折り返し幅' : '形を伸ばす') : '大きさ';
    handleHint.style.left = `${event.clientX + 12}px`;
    handleHint.style.top = `${event.clientY + 12}px`;
    document.body.appendChild(handleHint);

    try {
      handleEl.setPointerCapture?.(event.pointerId);
    } catch {
      // 合成 PointerEvent では capture 対象として登録されないことがある。
    }

    if (event.cancelable) event.preventDefault();
  }

  function beginGroupResize(event, handleEl) {
    if (activeEdit) void commitEdit();
    const members = selectionMembers().map(element => ({ element, transform: readTransform(element) }));
    if (!members.length || members.some(member => !isMovable(member.element))) return;
    const rect = unionBounds(members.map(member => member.element));
    if (!rect) return;
    const corner = handleCorner(handleEl);
    const anchorClient = cornerAnchorPoint(rect, corner);
    const draggedClient = namedCornerPoint(rect, corner);
    const anchor = stageLocalPoint(anchorClient.x, anchorClient.y);
    const dragged = stageLocalPoint(draggedClient.x, draggedClient.y);
    const pointer = stageLocalPoint(event.clientX, event.clientY);
    if (!anchor || !dragged || !pointer) return;
    const world = treeNode(selectedId)?.transform ?? {};
    const oldPose = { x: world.x ?? 0, y: world.y ?? 0, scale: world.scale ?? 1,
      rotate: world.rotate ?? 0 };
    activeResize = { group: true, overlayId: selectedId, members, oldPose, pose: oldPose,
      handleEl, pointerId: event.pointerId, anchorStageX: anchor.x, anchorStageY: anchor.y,
      draggedStageX: dragged.x, draggedStageY: dragged.y,
      startDistance: Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y) || 1,
      startScale: oldPose.scale, snapX: null, snapY: null, moved: false,
      writeContext: captureWriteContext() };
    handleHint?.remove();
    handleHint = document.createElement('div');
    handleHint.className = 'akari-interaction-hint';
    handleHint.setAttribute('data-akari-interaction', 'handle-hint');
    handleHint.textContent = '大きさ';
    handleHint.style.left = `${event.clientX + 12}px`;
    handleHint.style.top = `${event.clientY + 12}px`;
    document.body.appendChild(handleHint);
    try { handleEl.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
    if (event.cancelable) event.preventDefault();
  }

  function beginRotate(event, handleEl) {
    if (activeEdit) void commitEdit();
    const group = groupSelection;
    const members = group ? selectionMembers().map(element => ({ element, transform: readTransform(element) })) : [];
    if (group && (!members.length || members.some(member => !isMovable(member.element)))) return;
    const rect = group ? unionBounds(members.map(member => member.element)) : fragmentBounds(selectedOverlay);
    if (!rect) return;
    const center = stageLocalPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const pointer = stageLocalPoint(event.clientX, event.clientY);
    if (!center || !pointer) return;
    const current = group ? treeNode(selectedId)?.transform ?? {} : readTransform(selectedOverlay);
    const oldPose = { x: current.x ?? 0, y: current.y ?? 0, scale: current.scale ?? 1,
      rotate: current.rotate ?? 0 };
    activeRotate = { group, overlayId: selectedId, container: selectedOverlay, members,
      handleEl, pointerId: event.pointerId, oldPose, pose: oldPose, startRect: rect,
      center, pivot: { x: stage.clientWidth / 2 + oldPose.x, y: stage.clientHeight / 2 + oldPose.y },
      startAngle: Math.atan2(pointer.y - center.y, pointer.x - center.x),
      angle: 0, moved: false, writeContext: captureWriteContext() };
    rotationBadge = document.createElement('div');
    rotationBadge.className = 'akari-interaction-angle';
    rotationBadge.setAttribute('data-akari-interaction', 'rotation-angle');
    document.body.appendChild(rotationBadge);
    try { handleEl.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
    if (event.cancelable) event.preventDefault();
  }

  function updateRotate(event) {
    const rotation = activeRotate;
    if (!rotation || event.pointerId !== rotation.pointerId) return;
    const pointer = stageLocalPoint(event.clientX, event.clientY);
    if (!pointer) return;
    let angle = (Math.atan2(pointer.y - rotation.center.y, pointer.x - rotation.center.x)
      - rotation.startAngle) * 180 / Math.PI;
    const absolute = rotation.oldPose.rotate + angle;
    const normalized = ((absolute + 180) % 360 + 360) % 360 - 180;
    const target = Math.round(normalized / 45) * 45;
    const snapped = globalThis.akariHandleGeometry?.snapAngle(absolute, event.metaKey || event.ctrlKey)
      ?? (!(event.metaKey || event.ctrlKey) && Math.abs(normalized - target) <= 4 ? target : normalized);
    angle = ((snapped - rotation.oldPose.rotate + 180) % 360 + 360) % 360 - 180;
    rotation.angle = angle;
    if (rotationBadge) {
      rotationBadge.textContent = `${Math.round(globalThis.akariHandleGeometry?.normalizeAngle(rotation.oldPose.rotate + angle)
        ?? rotation.oldPose.rotate + angle)}°`;
      rotationBadge.style.left = `${event.clientX + 15}px`;
      rotationBadge.style.top = `${event.clientY + 17}px`;
    }
    const tangent = Math.atan2(event.clientY - (stage.getBoundingClientRect().top + rotation.center.y * currentDisplayScale()),
      event.clientX - (stage.getBoundingClientRect().left + rotation.center.x * currentDisplayScale())) * 180 / Math.PI + 90;
    const cursorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g transform="rotate(${Math.round(tangent)} 16 16)" fill="none" stroke="white" stroke-width="2"><path d="M5 16a11 11 0 0 1 19-7m3 7a11 11 0 0 1-19 7"/><path d="m21 8 4 1-1-4M11 24l-4-1 1 4"/></g></svg>`;
    document.body.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(cursorSvg)}") 16 16, crosshair`;
    if (rotation.group) {
      const theta = angle * Math.PI / 180, cosine = Math.cos(theta), sine = Math.sin(theta);
      const cx = rotation.center.x - stage.clientWidth / 2;
      const cy = rotation.center.y - stage.clientHeight / 2;
      const dx = cx - rotation.oldPose.x, dy = cy - rotation.oldPose.y;
      groupPoseAt(rotation, { ...rotation.oldPose, rotate: rotation.oldPose.rotate + angle,
        x: cx - (cosine * dx - sine * dy), y: cy - (sine * dx + cosine * dy) });
      selectionFrame.style.transform = `rotate(${angle}deg)`;
    } else {
      rotation.container.style.setProperty('--rotate', `${rotation.oldPose.rotate + angle}deg`);
      const radians = angle * Math.PI / 180;
      const dx = rotation.center.x - rotation.pivot.x;
      const dy = rotation.center.y - rotation.pivot.y;
      const next = globalThis.akariHandleGeometry?.rotationAroundPoint(rotation.oldPose,
        rotation.pivot, rotation.center, angle) ?? {
          x: rotation.oldPose.x + dx - (Math.cos(radians) * dx - Math.sin(radians) * dy),
          y: rotation.oldPose.y + dy - (Math.sin(radians) * dx + Math.cos(radians) * dy),
        };
      rotation.container.style.setProperty('--x', `${next.x}px`);
      rotation.container.style.setProperty('--y', `${next.y}px`);
    }
    rotation.moved = Math.abs(angle) > .01;
    if (event.cancelable) event.preventDefault();
  }

  function cancelRotate() {
    if (!activeRotate) return;
    const rotation = activeRotate;
    activeRotate = null;
    rotationBadge?.remove(); rotationBadge = null;
    document.body.style.cursor = '';
    releaseResizePointer(rotation);
    if (rotation.group) restoreGroupPose(rotation);
    else {
      rotation.container.style.setProperty('--rotate', `${rotation.oldPose.rotate}deg`);
      rotation.container.style.setProperty('--x', `${rotation.oldPose.x}px`);
      rotation.container.style.setProperty('--y', `${rotation.oldPose.y}px`);
      refreshSelectionFrame();
    }
  }

  function finishRotate() {
    if (!activeRotate) return null;
    const rotation = activeRotate;
    activeRotate = null;
    rotationBadge?.remove(); rotationBadge = null;
    document.body.style.cursor = '';
    releaseResizePointer(rotation);
    if (rotation.group) {
      selectionFrame.style.transform = '';
      refreshGroupFrame();
      return rotation.moved ? finishGroupTransform(rotation) : null;
    }
    if (!rotation.moved) return null;
    const current = readTransform(rotation.container);
    const transform = { x: current.x, y: current.y, rotate: current.rotate };
    const record = enqueueWrite(rotation.writeContext, rotation.overlayId,
      { transform }, 'transform');
    syncLeafTransformOnSuccess(record, rotation.overlayId, readTransform(rotation.container));
    record.promise.catch(error => {
      rotation.container.style.setProperty('--rotate', `${rotation.oldPose.rotate}deg`);
      rotation.container.style.setProperty('--x', `${rotation.oldPose.x}px`);
      rotation.container.style.setProperty('--y', `${rotation.oldPose.y}px`);
      refreshSelectionFrame();
      reportWriteError('transform', rotation.overlayId, error);
    });
    lastTransformWrite = record;
    return record;
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
  function computeAnchorResizeSnap({
    anchorStageX,
    anchorStageY,
    draggedStageX,
    draggedStageY,
    startScale,
    scale,
    snapX,
    snapY,
  }) {
    if (!(Math.abs(scale) > 1e-6) || !(Math.abs(startScale) > 1e-6)) {
      return null;
    }

    // pointerdown 時の stage-local 幾何だけからドラッグ中コーナーを求める。
    // fragmentBounds() を測り直すと、前フレームの transform や断片内レイアウトの
    // 変化が次フレームの基準へ混ざるため、resize の固定アンカーとは分離する。
    const anchor = { x: anchorStageX, y: anchorStageY };
    const scaleRatio = scale / startScale;
    const dragged = {
      x: anchor.x + (draggedStageX - anchor.x) * scaleRatio,
      y: anchor.y + (draggedStageY - anchor.y) * scaleRatio,
    };

    const targets = canvasSnapTargets();
    const displayScale = currentDisplayScale();

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
      snapY: resize.snapY,
    });
    if (!solved) return null;
    resize.snapX = solved.snapX;
    resize.snapY = solved.snapY;
    return solved.scale;
  }

  function applyResizeTransformAt(resize, scaleValue) {
    // pointerdown 時に確定した対角コーナー（stage-local）と開始 transform だけを使う。
    // stage-local 値なので、ズームや全画面切替で client 矩形が変われば表示位置は自然に
    // 追従する一方、断片自身の前フレームの変形結果は次の基準へ混ざらない。
    const translate = anchorPreservingTranslate({
      startX: resize.startX,
      startY: resize.startY,
      startScale: resize.startScale,
      scale: scaleValue,
      anchorStageX: resize.anchorStageX,
      anchorStageY: resize.anchorStageY,
    });
    if (!translate) return false;

    resize.container.style.setProperty("--x", `${translate.x}px`);
    resize.container.style.setProperty("--y", `${translate.y}px`);
    resize.container.style.setProperty("--scale", String(scaleValue));
    if (resize.axisCss.some(Boolean)) {
      resize.container.style.setProperty("--scale-x", String(resize.startScaleX * scaleValue / resize.startScale));
      resize.container.style.setProperty("--scale-y", String(resize.startScaleY * scaleValue / resize.startScale));
    } else {
      resize.container.style.removeProperty('--scale-x');
      resize.container.style.removeProperty('--scale-y');
    }
    return true;
  }

  function axisResizePosition(resize, ratioX, ratioY) {
    const cosine = Math.cos(resize.rotation), sine = Math.sin(resize.rotation);
    const dx = resize.anchorStageX - stage.clientWidth / 2 - resize.startX;
    const dy = resize.anchorStageY - stage.clientHeight / 2 - resize.startY;
    const localX = cosine * dx + sine * dy;
    const localY = -sine * dx + cosine * dy;
    return {
      x: resize.anchorStageX - stage.clientWidth / 2
        - (cosine * ratioX * localX - sine * ratioY * localY),
      y: resize.anchorStageY - stage.clientHeight / 2
        - (sine * ratioX * localX + cosine * ratioY * localY),
    };
  }

  function applyAxisResize(resize, scaleX, scaleY) {
    const position = axisResizePosition(resize,
      scaleX / resize.startScaleX, scaleY / resize.startScaleY);
    resize.container.style.setProperty('--x', `${position.x}px`);
    resize.container.style.setProperty('--y', `${position.y}px`);
    resize.container.style.setProperty('--scale-x', String(scaleX));
    resize.container.style.setProperty('--scale-y', String(scaleY));
  }

  function axisResizeSnap(resize, axis, scaleX, scaleY) {
    const ratio = axis === 'x' ? scaleX / resize.startScaleX : scaleY / resize.startScaleY;
    const radians = resize.rotation;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    const startDx = resize.draggedStageX - resize.anchorStageX;
    const startDy = resize.draggedStageY - resize.anchorStageY;
    const localDistance = axis === 'x' ? cosine * startDx + sine * startDy
      : -sine * startDx + cosine * startDy;
    const vector = axis === 'x'
      ? { x: cosine * localDistance, y: sine * localDistance }
      : { x: -sine * localDistance, y: cosine * localDistance };
    const targets = canvasSnapTargets();
    const displayScale = currentDisplayScale();
    let best = null;
    for (const coordinate of ['x', 'y']) {
      const coefficient = vector[coordinate];
      if (Math.abs(coefficient) < 1e-6) continue;
      const anchor = coordinate === 'x' ? resize.anchorStageX : resize.anchorStageY;
      const dragged = anchor + coefficient * ratio;
      for (let index = 0; index < targets[coordinate].length; index += 1) {
        const target = targets[coordinate][index];
        const distance = Math.abs(target - dragged) * displayScale;
        const previous = coordinate === 'x' ? resize.snapX : resize.snapY;
        const limit = previous?.targetIndex === index ? SNAP_RELEASE_DISTANCE : SNAP_DISTANCE;
        if (distance <= limit && (!best || distance < best.distance)) {
          best = { coordinate, targetIndex: index, target, distance,
            scale: clampScale((target - anchor) / coefficient
              * (axis === 'x' ? resize.startScaleX : resize.startScaleY)) };
        }
      }
    }
    resize.snapX = best?.coordinate === 'x' ? best : null;
    resize.snapY = best?.coordinate === 'y' ? best : null;
    showSnapGuides(resize.snapX, resize.snapY);
    return best?.scale ?? (axis === 'x' ? scaleX : scaleY);
  }

  function updateAxisResize(resize, event, pointer) {
    const cosine = Math.cos(resize.rotation), sine = Math.sin(resize.rotation);
    const dx = pointer.x + resize.pointerOffsetX - resize.anchorStageX;
    const dy = pointer.y + resize.pointerOffsetY - resize.anchorStageY;
    const startDx = resize.draggedStageX - resize.anchorStageX;
    const startDy = resize.draggedStageY - resize.anchorStageY;
    const x0 = cosine * startDx + sine * startDy;
    const y0 = -sine * startDx + cosine * startDy;
    const useX = !resize.edge || resize.edge === 'e' || resize.edge === 'w';
    const useY = !resize.edge || resize.edge === 'n' || resize.edge === 's';
    let scaleX = useX && Math.abs(x0) > 1e-6
      ? clampScale(resize.startScaleX * (cosine * dx + sine * dy) / x0) : resize.startScaleX;
    let scaleY = useY && Math.abs(y0) > 1e-6
      ? clampScale(resize.startScaleY * (-sine * dx + cosine * dy) / y0) : resize.startScaleY;
    if (event.metaKey || event.ctrlKey) {
      resize.snapX = null; resize.snapY = null; hideSnapGuides();
    } else if (resize.edge) {
      if (useX) scaleX = axisResizeSnap(resize, 'x', scaleX, scaleY);
      else scaleY = axisResizeSnap(resize, 'y', scaleX, scaleY);
    } else {
      hideSnapGuides();
    }
    applyAxisResize(resize, scaleX, scaleY);
    resize.moved = Math.abs(scaleX - resize.startScaleX) > 1e-6
      || Math.abs(scaleY - resize.startScaleY) > 1e-6;
    if (event.cancelable) event.preventDefault();
  }

  function updateResize(event) {
    const resize = activeResize;
    if (!resize || event.pointerId !== resize.pointerId) return;

    const pointer = stageLocalPoint(event.clientX, event.clientY);
    if (!pointer) return;
    if (!resize.group && !resize.edge && globalThis.akariHandleGeometry) {
      const scales = globalThis.akariHandleGeometry.anchoredScales({
        anchor: { x: resize.anchorStageX, y: resize.anchorStageY },
        dragged: { x: resize.draggedStageX, y: resize.draggedStageY },
        pointer: { x: pointer.x + resize.pointerOffsetX, y: pointer.y + resize.pointerOffsetY },
        rotation: resize.rotation * 180 / Math.PI,
        scaleX: resize.startScaleX, scaleY: resize.startScaleY,
      });
      applyAxisResize(resize, scales.scaleX, scales.scaleY);
      resize.moved = Math.abs(scales.scaleX - resize.startScaleX) > 1e-6
        || Math.abs(scales.scaleY - resize.startScaleY) > 1e-6;
      hideSnapGuides();
      if (event.cancelable) event.preventDefault();
      return;
    }
    if (!resize.group && resize.edge) {
      updateAxisResize(resize, event, pointer);
      return;
    }
    const currentDistance = Math.hypot(
      pointer.x + (resize.pointerOffsetX ?? 0) - resize.anchorStageX,
      pointer.y + (resize.pointerOffsetY ?? 0) - resize.anchorStageY
    );
    if (!Number.isFinite(currentDistance)) return;

    let nextScale = resize.startScale * (currentDistance / resize.startDistance);
    nextScale = clampScale(nextScale);
    if (Math.abs(nextScale - 1) <= SCALE_SNAP_TOLERANCE) nextScale = 1;

    if (resize.group) {
      if (event.metaKey || event.ctrlKey) {
        resize.snapX = null; resize.snapY = null; hideSnapGuides();
      } else {
        const snapped = applyResizeSnap(resize, nextScale);
        if (snapped !== null) nextScale = snapped;
      }
      const position = anchorPreservingTranslate({ startX: resize.oldPose.x,
        startY: resize.oldPose.y, startScale: resize.startScale, scale: nextScale,
        anchorStageX: resize.anchorStageX, anchorStageY: resize.anchorStageY });
      if (!position) return;
      groupPoseAt(resize, { ...resize.oldPose, ...position, scale: nextScale });
      resize.moved = Math.abs(nextScale - resize.startScale) > 1e-6;
      if (event.cancelable) event.preventDefault();
      return;
    }

    if (!applyResizeTransformAt(resize, nextScale)) return;

    if (event.metaKey || event.ctrlKey) {
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
    handleHint?.remove(); handleHint = null;
    if (resize.group) {
      releaseResizePointer(resize);
      hideSnapGuides();
      restoreGroupPose(resize);
      return;
    }
    resize.container.style.setProperty("--x", `${resize.startX}px`);
    resize.container.style.setProperty("--y", `${resize.startY}px`);
    resize.container.style.setProperty("--scale", String(resize.startScale));
    ["--scale-x", "--scale-y"].forEach((css, index) => {
      if (resize.axisCss[index]) resize.container.style.setProperty(css, resize.axisCss[index]);
      else resize.container.style.removeProperty(css);
    });
    releaseResizePointer(resize);
    hideSnapGuides();
    refreshSelectionFrame();
  }

  function finishResize() {
    if (!activeResize) return null;

    const resize = activeResize;
    activeResize = null;
    handleHint?.remove(); handleHint = null;
    releaseResizePointer(resize);
    hideSnapGuides();

    if (resize.group) {
      if (!resize.moved) { restoreGroupPose(resize); return null; }
      return finishGroupTransform(resize);
    }

    if (!resize.moved) return null;

    const transform = readTransform(resize.container);
    if (resize.edge === 'e' || resize.edge === 'w') {
      if (!resize.axisCss[1]) delete transform.scaleY;
    } else if (resize.edge && !resize.axisCss[0]) {
      delete transform.scaleX;
    }
    if (transform.scaleX !== undefined && transform.scaleX === transform.scaleY) {
      transform.scale = transform.scaleX;
      delete transform.scaleX;
      delete transform.scaleY;
    }
    const record = enqueueWrite(
      resize.writeContext,
      resize.overlayId,
      { transform },
      "transform"
    );
    syncLeafTransformOnSuccess(record, resize.overlayId, transform);
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
    if (!interactionEnabled) return;
    if (event.button !== 0 || activeDrag || activeResize || activeRotate || activeLine) return;
    if (selectedId && stage && event.target instanceof Element) {
      const bounds = stage.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom;
      const protectedTarget = event.target.closest('button, [role="button"], input, textarea, select, a[href], '
        + '[data-akari-interaction], [data-akari-ui="preview-scope-breadcrumb"], '
        + '.caption-row-plate, #caption-select-box, #layer-select-box, #cut-select-box, '
        + '.transport-controls, [role="menu"]');
      if (outside && !protectedTarget) { clearSelection(); return; }
    }
    flushNudge();
    hideHover();
    clickOrigin = { selectedId, scopeId, moved: false, hadMultiple: selectedIds.length > 1 };

    if (selectionTree().length) {
      if (event.target instanceof Element && event.target.closest('[data-akari-ui="preview-scope-breadcrumb"]')) return;
      const handle = findHandleElement(event.target);
      if (handle) {
        if (selectedIds.length > 1) return;
        if (handle.classList.contains('is-line-start') || handle.classList.contains('is-line-end')) {
          beginLineEndpoint(event, handle); return;
        }
        if (groupSelection) {
          if (handle.classList.contains('is-rotate')) beginRotate(event, handle);
          else if (handle.classList.contains('is-move')) beginGroupDrag(event, selectedOverlay);
          else beginGroupResize(event, handle);
        } else if (isMovable(selectedOverlay)) {
          if (handle.classList.contains('is-rotate')) beginRotate(event, handle);
          else if (handle.classList.contains('is-move')) beginLeafDrag(event, selectedOverlay);
          else beginResize(event, selectedOverlay, handle);
        }
        return;
      }
      const hit = overlayForEvent(event);
      const stageRect = stage?.getBoundingClientRect();
      const insideStage = stageRect && event.clientX >= stageRect.left && event.clientX <= stageRect.right
        && event.clientY >= stageRect.top && event.clientY <= stageRect.bottom;
      const fallbackBlank = insideStage && !activeEdit
        && !(event.target instanceof Element && event.target.closest('button, [role="button"], input, textarea, select, a[href], [data-akari-interaction]'));
      const canMarquee = !isSelectable(hit) && !event.altKey && (window.akari.shouldStartPreviewMarquee
        ? window.akari.shouldStartPreviewMarquee(event) : fallbackBlank);
      if (!isSelectable(hit) && (canMarquee || insideStage)) {
        const bag = treeNode(scopeId);
        pendingBlank = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          shift: event.shiftKey, scopeId, marquee: canMarquee, release: Boolean(insideStage),
          bagExit: bag?.kind === 'bag' && bag.lazy
            && scopeId !== floorScopeId ? bag.parentId : undefined, started: false, hits: [] };
        return;
      }
      if (!isSelectable(hit)) {
        return;
      }
      if (activeEdit?.container === hit && eventHitsElement(event, activeEdit.element)) return;
      clickOrigin.scopedHit = true;
      if (activeEdit) void commitEdit();
      const next = resolveScopedSelection(selectionTree(), scopeId, scopedHitId(hit, event),
        { deep: Boolean(event.metaKey || event.ctrlKey) });
      // Preserve the set while pressing an already selected sibling, so a plain
      // drag moves the set. A stationary click collapses it in onClick.
      const keepSet = selectedIds.length > 1 && !event.shiftKey && !event.metaKey && !event.ctrlKey
        && next.scopeId === scopeId && selectedIds.includes(next.selectId);
      if (!keepSet && !selectScopedHit(hit, event)) return;
      if (collectiveSelection()) { beginGroupDrag(event, hit); return; }
      if (!selectedOverlay || selectedOverlay !== hit) return;
      // Continue the existing leaf drag with the already-resolved container.
    }
    const handleEl = findHandleElement(event.target);
    if (handleEl) {
      if (!isMovable(selectedOverlay)) return;
      if (handleEl.classList.contains('is-line-start') || handleEl.classList.contains('is-line-end')) {
        beginLineEndpoint(event, handleEl); return;
      }
      if (handleEl.classList.contains('is-rotate')) beginRotate(event, handleEl);
      else if (handleEl.classList.contains('is-move')) beginLeafDrag(event, selectedOverlay);
      else beginResize(event, selectedOverlay, handleEl);
      return;
    }

    const container = overlayForEvent(event);
    if (!isSelectable(container)) {
      if (selectedOverlay && stage && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        const stageRect = stage.getBoundingClientRect();
        if (event.clientX >= stageRect.left && event.clientX <= stageRect.right
          && event.clientY >= stageRect.top && event.clientY <= stageRect.bottom) {
          if (activeEdit) void commitEdit();
          clearSelection();
        }
      }
      return;
    }

    selectOverlay(container);

    if (
      activeEdit?.container === container &&
      eventHitsElement(event, activeEdit.element)
    ) {
      return;
    }

    if (activeEdit) void commitEdit();

    // 背景（role==="background"）は選択できるが動かせない。選択はここまでで完了させ、
    // ドラッグは開始しない（isSelectable のみで isMovable を通さないと、選択直後に
    // pointermove が来た瞬間 activeDrag が動き出してしまう）。
    if (!isMovable(container)) return;

    beginLeafDrag(event, container);
  }

  function beginLeafDrag(event, container) {
    if (!container || !isMovable(container)) return;
    const transform = readTransform(container);
    const motionDriven = container.dataset.akariMotionDriven === 'true';
    if (motionDriven) container.dataset.akariMotionDragging = 'true';
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
      duplicate: event.altKey,
      motionDriven,
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
    if (pendingBlank && event.pointerId === pendingBlank.pointerId) {
      const dx = event.clientX - pendingBlank.x, dy = event.clientY - pendingBlank.y;
      if (!pendingBlank.started && dx * dx + dy * dy > dragStartDistance * dragStartDistance) {
        if (clickOrigin) clickOrigin.moved = true;
        if (!pendingBlank.marquee) clearMarquee();
        else {
          pendingBlank.started = true;
          if (activeEdit) void commitEdit();
        }
      }
      if (pendingBlank?.started) {
        updateMarquee(event);
        if (event.cancelable) event.preventDefault();
        return;
      }
    }
    scheduleHover(event);
    if (activeLine && event.pointerId === activeLine.pointerId) {
      updateLineEndpoint(event); return;
    }
    if (activeRotate && event.pointerId === activeRotate.pointerId) {
      updateRotate(event);
      return;
    }
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
    if (clickOrigin) clickOrigin.moved = true;
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
    const lockedAxis = event.shiftKey
      ? Math.abs(videoDeltaX) >= Math.abs(videoDeltaY) ? 'x' : 'y' : null;
    if (drag.group) {
      const locked = globalThis.akariHandleGeometry?.axisLock(videoDeltaX, videoDeltaY, event.shiftKey)
        ?? (event.shiftKey && Math.abs(videoDeltaX) >= Math.abs(videoDeltaY)
          ? { x: videoDeltaX, y: 0 }
          : event.shiftKey ? { x: 0, y: videoDeltaY } : { x: videoDeltaX, y: videoDeltaY });
      moveGroupDrag(drag, locked.x, locked.y, event.metaKey || event.ctrlKey, lockedAxis);
      if (event.cancelable) event.preventDefault();
      return;
    }
    const locked = globalThis.akariHandleGeometry?.axisLock(videoDeltaX, videoDeltaY, event.shiftKey)
      ?? (event.shiftKey && Math.abs(videoDeltaX) >= Math.abs(videoDeltaY)
        ? { x: videoDeltaX, y: 0 }
        : event.shiftKey ? { x: 0, y: videoDeltaY } : { x: videoDeltaX, y: videoDeltaY });
    applyDragSnapping(
      drag,
      drag.startX + locked.x,
      drag.startY + locked.y,
      event.metaKey || event.ctrlKey,
      lockedAxis
    );

    if (event.cancelable) event.preventDefault();
  }

  function onPointerUp(event) {
    if (activeLine && event.pointerId === activeLine.pointerId) {
      finishLineEndpoint(); return;
    }
    if (pendingBlank && event.pointerId === pendingBlank.pointerId) {
      const dx = event.clientX - pendingBlank.x, dy = event.clientY - pendingBlank.y;
      if (!pendingBlank.started && dx * dx + dy * dy > dragStartDistance * dragStartDistance) {
        if (clickOrigin) clickOrigin.moved = true;
        if (!pendingBlank.marquee) clearMarquee();
        else pendingBlank.started = true;
      }
      if (pendingBlank) { finishMarquee(event); return; }
    }
    if (activeRotate && event.pointerId === activeRotate.pointerId) {
      finishRotate();
      return;
    }
    if (activeResize && event.pointerId === activeResize.pointerId) {
      finishResize();
      return;
    }
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return;
    finishDrag();
  }

  function onPointerCancel(event) {
    if (activeLine && event.pointerId === activeLine.pointerId) {
      finishLineEndpoint(true); return;
    }
    if (pendingBlank && event.pointerId === pendingBlank.pointerId) { clearMarquee(); return; }
    if (activeRotate && event.pointerId === activeRotate.pointerId) {
      cancelRotate();
      return;
    }
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
    if (!root) throw new Error("オーバーレイ断片のルート要素がありません");

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

  function cancelEdit() {
    if (!activeEdit) return;
    const edit = activeEdit;
    // Clear before blur: cancellation must never enter the commit/write path.
    activeEdit = null;
    for (const snapshot of edit.originalContents) {
      snapshot.element.innerHTML = snapshot.html;
      restoreAttribute(snapshot.element, "data-akari-split-units",
        snapshot.hadSplitUnits, snapshot.splitUnits);
    }
    restoreAttribute(edit.element, "contenteditable",
      edit.hadContentEditable, edit.contentEditableValue);
    restoreAttribute(edit.element, "spellcheck", edit.hadSpellcheck, edit.spellcheckValue);
    restoreAttribute(edit.element, "data-akari-interaction-editing",
      edit.hadEditingMarker, edit.editingMarkerValue);
    if (document.activeElement === edit.element) edit.element.blur();
    invalidateOverlayHitPolicy(edit.container);
    applyOverlayHitPolicy(edit.container);
    syncOverlayHitRegion(edit.container);
    refreshSelectionFrame();
  }

  function commitEdit({ blur = true } = {}) {
    if (!activeEdit) return Promise.resolve(undefined);

    const edit = activeEdit;
    activeEdit = null;

    // source.text replaces the whole named part. A nested/ancestor/unrelated
    // text element must never flatten that structure or serialize its mask.
    // Slots keep their existing params route, including inside a part overlay.
    if (edit.part && !edit.slotName && edit.element !== edit.partElement) {
      edit.fragment.replaceWith(edit.originalFragment);
      invalidateOverlayHitPolicy(edit.container);
      applyOverlayHitPolicy(edit.container);
      syncOverlayHitRegion(edit.container);
      const error = new Error("この部品は文字を 1 つだけ持つ形にしてください");
      reportWriteError("text", edit.overlayId, error);
      window.akari.showWriteError?.(error);
      const failure = Promise.reject(error);
      failure.catch(() => undefined);
      return failure;
    }

    // 保存直前の安全網: input/compositionend を取りこぼした場合でも、確定した
    // 編集層のテキストで全ミラー層を同期してから書き出す（P0-R 契約 §3）。
    syncMirrorLayers(edit.container, edit.element);

    // 編集開始時に畳んだテキスト分割を、確定したテキストで分割し直す（--i を振り直す）。
    // ミラー同期の後に行う（ミラー層は素のテキストを保つ）。
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

    // テキスト編集で描画要素が変わり得るため、pointer-events 規約を適用し直す。
    invalidateOverlayHitPolicy(edit.container);
    applyOverlayHitPolicy(edit.container);
    syncOverlayHitRegion(edit.container);

    if (edit.slotName) {
      const record = enqueueWrite(
        edit.writeContext,
        edit.overlayId,
        { params: { [edit.slotName]: edit.element.textContent ?? "" } },
        "params"
      );
      return record.promise;
    }

    if (edit.part) {
      const record = enqueueWrite(
        edit.writeContext,
        edit.overlayId,
        { text: edit.element.textContent ?? "" },
        "text"
      );
      return record.promise;
    }

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
    flushNudge();
    hideHover();
    if (activeEdit?.element === element) {
      element.focus({ preventScroll: true });
      return;
    }
    if (activeEdit) void commitEdit();

    // Capture before split collapse or input synchronization. Keep each mirror
    // and slot's own markup, even when its initial text differs from the editor.
    const splitHost = window.akari.textSplit?.closestHost?.(element);
    const slotName = slotNameForElement(element);
    const affected = new Set([element, ...(splitHost ? [splitHost] : []),
      ...(mirrorSyncScope(container, element)?.querySelectorAll('[data-mirror="text"]') ?? []),
      ...[...container.querySelectorAll('[data-akari-slot]')]
        .filter(slot => slotName && slot.getAttribute('data-akari-slot') === slotName)]);
    const originalContents = [...affected]
      .filter(candidate => ![...affected].some(parent => parent !== candidate && parent.contains(candidate)))
      .map(candidate => {
        const clone = candidate.cloneNode(true);
        restoreHitPolicyStyles(clone, candidate);
        return { element: candidate, html: clone.innerHTML,
          hadSplitUnits: candidate.hasAttribute('data-akari-split-units'),
          splitUnits: candidate.getAttribute('data-akari-split-units') ?? '' };
      });
    activeEdit = {
      originalContents,
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
      slotName: slotNameForElement(element),
      writeContext: captureWriteContext(),
    };

    const part = window.akari.state?.summary?.overlays?.find(
      overlay => overlay.id === activeEdit.overlayId
    )?.part;
    if (typeof part === "string" && part && !activeEdit.slotName) {
      const fragment = fragmentRoot(container);
      activeEdit.part = part;
      activeEdit.partElement = [fragment, ...fragment.querySelectorAll("[data-akari-part]")]
        .find(candidate => candidate.getAttribute("data-akari-part") === part);
      activeEdit.fragment = fragment;
      // Snapshot before split collapse, mirror synchronization, or any typing.
      // Remove injected hit styles so the restored clone can acquire its own
      // hit-policy bookkeeping instead of treating them as author CSS.
      activeEdit.originalFragment = fragment.cloneNode(true);
      restoreHitPolicyStyles(activeEdit.originalFragment, fragment);
    }

    // テキスト分割断片（data-akari-split）は編集中だけ素のテキストへ畳む。
    // <span class="akari-u"> のまま contenteditable にすると、打鍵で span が
    // 割れる・消える・キャレットが単位境界で飛ぶ、といった壊れ方をするため。
    // 確定時（commitEdit）に分割し直す（contract-2026-08-15-telop-motion-grammar-v0 §4）。
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
    if (!interactionEnabled || activeEdit) return;
    const hit = overlayForEvent(event);
    // pointerdown already toggled. Do not toggle twice or update the cycle clock.
    if (event.shiftKey && clickOrigin?.scopedHit) {
      event.stopPropagation(); clickOrigin = null; return;
    }
    // The shell's forced stage-click report would duplicate the representative
    // notification already published by this set transition. Leave UI clicks alone.
    if (isSelectable(hit) && (selectedIds.length > 1 || clickOrigin?.hadMultiple)) event.stopPropagation();
    if (clickOrigin?.moved) { clickOrigin = null; lastClick = null; return; }
    if (!isSelectable(hit)) { if (!event.shiftKey) lastClick = null; return; }
    const now = performance.now();
    const origin = clickOrigin ?? { selectedId, scopeId };
    const canCycle = event.detail === 1 && !event.shiftKey && !event.metaKey && !event.ctrlKey
      && !event.altKey && !origin.moved && lastClick && lastClick.scopeId === scopeId
      && origin.scopeId === scopeId && now - lastClick.time <= 600
      && Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) <= 6;
    const nextId = canCycle ? nextCycleCandidate(cycleCandidates(event), origin.selectedId) : null;
    if (nextId) applyScopedSelection({ selectId: nextId, scopeId });
    else if (selectionTree().length) selectScopedHit(hit, event);
    else selectOverlay(hit);
    if (event.shiftKey) { clickOrigin = null; return; }
    lastClick = event.detail === 1 && !origin.moved && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
      ? { x: event.clientX, y: event.clientY, scopeId, time: now } : null;
    clickOrigin = null;
  }

  function onDoubleClick(event) {
    if (!interactionEnabled) return;
    lastClick = null;
    hideHover();
    if (selectedIds.length > 1) {
      const hit = overlayForEvent(event);
      if (!isSelectable(hit)) return;
      applyScopedSelection(resolveScopedSelection(selectionTree(), scopeId, scopedHitId(hit, event)));
    }
    if (selectionTree().length && groupSelection) {
      const hit = overlayForEvent(event);
      if (!isSelectable(hit)) return;
      applyScopedSelection(enterScope(selectionTree(), selectedId, scopedHitId(hit, event)));
      event.preventDefault(); event.stopPropagation();
      return;
    }
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
    syncSlotInstances(
      activeEdit.container,
      activeEdit.element,
      activeEdit.slotName
    );
  }

  function onKeyDown(event) {
    if (event.isComposing) return;
    if (handleNudge(event)) return;
    if (selectionTree().length) {
      if (event.key === 'Enter' && event.target instanceof Element
        && event.target.closest('[data-akari-ui="preview-scope-breadcrumb"]')) return;
      const handled = () => {
        event.preventDefault();
        // Theia pre/main.js installs handleInnerKeydown on window in BUBBLE
        // phase (without a defaultPrevented guard). We run in capture phase.
        // stopImmediatePropagation also covers a key targeted at window itself.
        event.stopPropagation(); event.stopImmediatePropagation();
      };
      if (event.key === 'Escape') {
        if (pendingBlank?.started) { clearMarquee(); handled(); return; }
        if (activeDrag) { cancelDrag(); handled(); return; }
        if (activeResize) { cancelResize(); handled(); return; }
        if (activeLine) { finishLineEndpoint(true); handled(); return; }
        if (activeRotate) { cancelRotate(); handled(); return; }
        if (activeEdit) { cancelEdit(); handled(); return; }
        if (selectedIds.length > 1) {
          applyScopedSelection({ selectId: selectedId, scopeId }); handled(); return;
        }
        if (shouldHandleScopeEscape(selectedId, scopeId, floorScopeId)) {
          applyScopedSelection(exitScope(selectionTree(), selectedId, scopeId, floorScopeId), { notify: false });
          handled(); return;
        }
        // Idle at the floor: let Theia forward this key to the timeline,
        // which owns the next (focus-mode) step.
        return;
      }
      if (event.key === 'Enter') {
        if (activeEdit) {
          if (event.target === activeEdit.element) { void commitEdit(); handled(); }
          return;
        }
        if (selectedIds.length > 1) applyScopedSelection({ selectId: selectedId, scopeId });
        if (event.shiftKey && (selectedId !== null || scopeId !== floorScopeId)) {
          applyScopedSelection(exitScope(selectionTree(), selectedId, scopeId, floorScopeId));
          handled(); return;
        }
        if (groupSelection) {
          applyScopedSelection(enterScope(selectionTree(), selectedId)); handled(); return;
        }
        if (selectedOverlay) {
          const root = fragmentRoot(selectedOverlay);
          const text = root && [root, ...root.querySelectorAll('*')].find(canEditText);
          if (text) { beginEdit(selectedOverlay, text); handled(); }
        }
        return;
      }
    }
    if (
      event.key === "Enter" &&
      activeEdit &&
      event.target === activeEdit.element &&
      !event.isComposing
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void commitEdit();
      return;
    }

    if (
      event.key !== "Escape" ||
      (!selectedOverlay && !activeDrag && !activeResize && !activeEdit)
    ) {
      isolateEditKey(event);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (activeDrag) cancelDrag();
    if (activeResize) cancelResize();
    if (activeEdit) { cancelEdit(); event.stopImmediatePropagation(); return; }
    clearSelection();
  }

  function isolateEditKey(event) {
    if (event.isComposing || !activeEdit || event.target !== activeEdit.element) return;
    // Keep native contenteditable input, deletion, caret motion and shortcuts.
    // Theia forwards keys from window bubble, including keyup used to commit
    // timeline nudges. Only propagation must stop; never preventDefault here.
    event.stopPropagation();
    event.stopImmediatePropagation();
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
            metaKey: true,
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
            metaKey: true,
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

  // host の document/祖先捕捉より先に retarget する。click も通して再選択を防ぐ。
  for (const type of ["pointerdown", "pointerup", "click", "dblclick"]) {
    window.addEventListener(type, passTransparentCanvasEvent, true);
  }
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
  window.addEventListener("keyup", isolateEditKey, true);
  window.addEventListener("keypress", isolateEditKey, true);
  window.addEventListener('blur', () => { clearMarquee(); flushNudge(); hideHover(); lastClick = null; });
  document.addEventListener('pointerleave', hideHover);

  return {
    get selectedId() { return selectedId; },
    get selectedIds() { return [...selectedIds]; },
    get selectionKind() { return selectionKind(); },
    get scopeId() { return scopeId; },
    get floorScopeId() { return floorScopeId; },
    get activeEdit() { return Boolean(activeEdit); },
    get hasSelectionTree() { return selectionTree().length > 0; },
    selectFromTimeline,
    setSelectionFloor,
    selftest,
    fragmentBounds,
    canvasAlphaAtPoint,
    canvasClientBounds,
    captureCanvasContent,
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
    setEnabled,
  };
})();
