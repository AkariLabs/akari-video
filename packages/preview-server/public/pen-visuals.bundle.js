// ../pen-visuals/src/index.ts
function normalizePersistentStrokeItems(value) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate;
    const metadata = {
      ...typeof item.id === "string" ? { id: item.id } : {},
      ...Number.isFinite(item.recTStart) ? { recTStart: item.recTStart } : {},
      ...Number.isFinite(item.recTEnd) ? { recTEnd: item.recTEnd } : {}
    };
    if ((item.tool === "pen" || item.tool === void 0) && Array.isArray(item.points)) {
      const points = item.points.filter((point) => Array.isArray(point) && point.length === 2 && point.every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)).map((point) => [point[0], point[1]]);
      if (points.length >= 2) normalized.push({ tool: "pen", points, ...metadata });
      continue;
    }
    if (item.tool === "rect" && Array.isArray(item.box) && item.box.length === 4 && item.box.every((coordinate) => Number.isFinite(coordinate))) {
      const [x, y, width, height] = item.box;
      if (x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1) {
        normalized.push({ tool: "rect", box: [x, y, width, height], ...metadata });
      }
    }
  }
  return normalized;
}
var PEN_TUNING = {
  maxDevicePixelRatio: 2,
  coreWidthPx: 3.4,
  staticCoreWidthPx: 3,
  coreAlpha: 0.98,
  glowAlpha: 0.5,
  glowSizePx: 30,
  sparkleSpritePx: 32,
  sparklesPerSegment: 2,
  sparkleMaxPoolSize: 220,
  sparkleJitterPx: 9,
  sparkleMinSizePx: 5,
  sparkleMaxSizePx: 13,
  sparkleLifetimeMs: 620,
  sparkleTwinkleHz: 2.2,
  fadeDurationMs: 600
};
function createGlowSprite(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,0.95)");
  gradient.addColorStop(0.4, "rgba(226,234,255,0.55)");
  gradient.addColorStop(1, "rgba(226,234,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
function createSparkleSprite(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const center = size / 2;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.85)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(center, center - size * 0.42);
  ctx.lineTo(center, center + size * 0.42);
  ctx.moveTo(center - size * 0.42, center);
  ctx.lineTo(center + size * 0.42, center);
  ctx.stroke();
  return canvas;
}
function createPlatinumGradient(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.48, "#d9deea");
  gradient.addColorStop(0.72, "#ffffff");
  gradient.addColorStop(1, "#c8cfdd");
  return gradient;
}
function drawPenSegment(ctx, glowSprite, platinumGradient, from, to, canvasWidth, canvasHeight, coreWidthPx = PEN_TUNING.coreWidthPx, glowSizePx = PEN_TUNING.glowSizePx) {
  const fromPx = [from[0] * canvasWidth, from[1] * canvasHeight];
  const toPx = [to[0] * canvasWidth, to[1] * canvasHeight];
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = PEN_TUNING.glowAlpha;
  ctx.drawImage(glowSprite, toPx[0] - glowSizePx / 2, toPx[1] - glowSizePx / 2, glowSizePx, glowSizePx);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = PEN_TUNING.coreAlpha;
  ctx.strokeStyle = platinumGradient ?? "#eef2fb";
  ctx.lineWidth = coreWidthPx;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(fromPx[0], fromPx[1]);
  ctx.lineTo(toPx[0], toPx[1]);
  ctx.stroke();
  ctx.restore();
}
export {
  PEN_TUNING,
  createGlowSprite,
  createPlatinumGradient,
  createSparkleSprite,
  drawPenSegment,
  normalizePersistentStrokeItems
};
