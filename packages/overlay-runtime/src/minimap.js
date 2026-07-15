// 出典: akari-os/akari-video-on-os/src/panels/PreviewPanel.tsx（ZoomMinimap）
// スタイル出典: akari-os/akari-video-on-os/src/styles.css（Zoom minimap）
// パンは表示のみ: offset セッターの新設は main.js の結線 1 行制約に反するため。
(function initMinimap() {
  const EPS = 0.5;
  const DEFAULT_STATE = {
    visible: false,
    zoom: 1,
    viewport: { x: 0, y: 0, w: 0, h: 0 },
  };

  let currentState = DEFAULT_STATE;

  function clamp(value) {
    return Math.min(1, Math.max(0, value));
  }

  function stageScale() {
    if (typeof window.akari.stageScale !== "function") return 1;
    const scale = Number(window.akari.stageScale());
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  function setHidden(minimap, hidden) {
    if (!minimap) return;
    minimap.hidden = hidden;
  }

  function update() {
    const fallbackZoom = stageScale();
    const minimap = document.getElementById("minimap");
    const minimapFrame = document.getElementById("minimap-frame");
    const minimapViewport = document.getElementById("minimap-viewport");
    const frameElement = document.getElementById("overlay-stage");
    const paneElement = document.getElementById("preview-pane");

    if (!frameElement || !paneElement || !minimapFrame || !minimapViewport) {
      currentState = {
        visible: false,
        zoom: fallbackZoom,
        viewport: { x: 0, y: 0, w: 0, h: 0 },
      };
      setHidden(minimap, true);
      return;
    }

    const frame = frameElement.getBoundingClientRect();
    const pane = paneElement.getBoundingClientRect();
    if (
      !Number.isFinite(frame.width) ||
      !Number.isFinite(frame.height) ||
      !Number.isFinite(pane.width) ||
      !Number.isFinite(pane.height) ||
      frame.width <= 0 ||
      frame.height <= 0 ||
      pane.width <= 0 ||
      pane.height <= 0
    ) {
      currentState = {
        visible: false,
        zoom: fallbackZoom,
        viewport: { x: 0, y: 0, w: 0, h: 0 },
      };
      setHidden(minimap, true);
      return;
    }

    const intersectionLeft = Math.max(frame.left, pane.left);
    const intersectionTop = Math.max(frame.top, pane.top);
    const intersectionRight = Math.min(frame.right, pane.right);
    const intersectionBottom = Math.min(frame.bottom, pane.bottom);
    const viewport = {
      x: clamp((intersectionLeft - frame.left) / frame.width),
      y: clamp((intersectionTop - frame.top) / frame.height),
      w: clamp((intersectionRight - intersectionLeft) / frame.width),
      h: clamp((intersectionBottom - intersectionTop) / frame.height),
    };
    const visible =
      frame.width > pane.width + EPS || frame.height > pane.height + EPS;
    const aspect = frame.width / frame.height;
    const fittedW = Math.min(pane.width, pane.height * aspect);
    const zoom = fittedW > 0 ? frame.width / fittedW : fallbackZoom;

    currentState = { visible, zoom, viewport };
    setHidden(minimap, !visible);
    minimapFrame.style.aspectRatio = `${frame.width} / ${frame.height}`;
    minimapViewport.style.left = `${viewport.x * 100}%`;
    minimapViewport.style.top = `${viewport.y * 100}%`;
    minimapViewport.style.width = `${viewport.w * 100}%`;
    minimapViewport.style.height = `${viewport.h * 100}%`;
  }

  function state() {
    return {
      visible: currentState.visible,
      zoom: currentState.zoom,
      viewport: { ...currentState.viewport },
    };
  }

  window.akari = window.akari || {};
  window.akari.minimap = { update, state };

  window.addEventListener("resize", update);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", update, { once: true });
  } else {
    update();
  }
})();
