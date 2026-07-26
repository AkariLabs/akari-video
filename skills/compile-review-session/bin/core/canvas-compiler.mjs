// キャンバス面（contract-2026-07-26-canvas-surface）の review/canvas/c-NNNN/ 記録原本を
// review.json annotation へ着地させるための純関数群。session 系（compiler.mjs / time-mapping.mjs）と
// 違い、キャンバスには timeline/cuts が存在しないため参照解決は不要 — target は常に
// `canvas:<id>` に固定される。v0 は録音なし（audio は常に null）のため、strokes + メモを
// 1 annotation に集約する経路のみを実装する（契約 §3「録音なしでも成立する」・
// report.md の調査結果: 録音ありの発話ペアリング経路は本タスクでは未実装）。

const CANVAS_ID_PATTERN = /^c-(\d{4,})$/;
const STROKE_ID_PATTERN = /^st-\d{4,}$/;

export function isValidCanvasId(id) {
  return typeof id === "string" && CANVAS_ID_PATTERN.test(id);
}

/** canvas.json（契約 §2）の構造検証。不正なら null を返す（呼び出し側が warning + skip する）。 */
export function validateCanvasManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.version !== 0) return null;
  if (typeof value.id !== "string" || !isValidCanvasId(value.id)) return null;
  if (typeof value.createdAt !== "string" || !value.createdAt.trim()) return null;
  const aspect = value.aspect;
  if (!aspect || typeof aspect !== "object"
    || !Number.isFinite(aspect.w) || aspect.w <= 0
    || !Number.isFinite(aspect.h) || aspect.h <= 0) {
    return null;
  }
  if (value.background !== null) {
    const background = value.background;
    if (
      !background || typeof background !== "object"
      || typeof background.ref !== "string" || !background.ref.trim()
      || typeof background.hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(background.hash)
    ) {
      return null;
    }
  }
  if (value.audio !== null && typeof value.audio !== "string") return null;
  if (value.memo !== undefined && value.memo !== null && typeof value.memo !== "string") return null;
  if (!["recorded", "compiled"].includes(value.status)) return null;
  return value;
}

/** strokes.json（review-session §4.1 と同型・space canvas-rect・frame なし）1 要素の検証。 */
export function validateCanvasStroke(stroke) {
  return Boolean(
    stroke
    && typeof stroke === "object"
    && STROKE_ID_PATTERN.test(stroke.id)
    && stroke.tool === "pen"
    && stroke.space === "canvas-rect"
    && Array.isArray(stroke.points)
    && stroke.points.length >= 2
    && stroke.points.every((point) => (
      Array.isArray(point)
      && point.length === 2
      && point.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    )),
  );
}

export function simplifyCanvasStrokePoints(points, maximum = 100) {
  if (points.length <= maximum) return points;
  return Array.from({ length: maximum }, (_, index) => (
    points[Math.round((index * (points.length - 1)) / (maximum - 1))]
  ));
}

/**
 * 録音なしキャンバスの着地（契約 §4「strokes + 添付メモを1 annotation にまとめて着地
 * （分割の材料がないため）」）。全ストロークを canvasRef 付きで埋め込む。
 */
export function buildMemoOnlyCanvasAnnotation({ canvasId, strokes, memo, createdAt }) {
  const trimmedMemo = typeof memo === "string" ? memo.trim() : "";
  const text = trimmedMemo || "キャンバスにペンで構図案を記録（メモなし）";
  const embeddedStrokes = strokes.length > 0
    ? strokes.map((stroke) => ({
      tool: "pen",
      space: "canvas-rect",
      points: simplifyCanvasStrokePoints(stroke.points),
      canvasRef: `${canvasId}/${stroke.id}`,
    }))
    : null;
  return {
    createdAt,
    sourceT: null,
    sourceRange: null,
    timelineT: null,
    target: `canvas:${canvasId}`,
    targetKind: null,
    region: null,
    strokes: embeddedStrokes,
    refs: null,
    insertPosition: null,
    intent: null,
    text,
    // 録音なし v0（audio は常に null）: メモは typed テキストとして扱う（契約 §3）。
    input: "typed",
    audio: null,
    transcript: null,
    session: null,
    poses: null,
    status: "open",
    response: null,
  };
}
