import type { ResolvedLayerVisual } from '../types.js';

export interface LayerKeyframe {
  t: number;
  transform?: { x?: number; y?: number; scale?: number; rotate?: number };
  crop?: { x: number; y: number; w: number; h: number };
  perspective?: { corners: readonly (readonly [number, number])[] };
  /** contract-2026-08-30-motion-and-keyframes-v0.md §2.1 (a): opacity is a keyframe-able leaf. */
  opacity?: number;
  easing?: 'linear' | 'ease-in-out';
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function ease(point: LayerKeyframe, u: number): number {
  return point.easing === 'ease-in-out'
    ? u < 0.5
      ? 4 * u * u * u
      : 1 - (-2 * u + 2) ** 3 / 2
    : u;
}

function valueAt(
  points: readonly LayerKeyframe[],
  pick: (point: LayerKeyframe) => number,
  t: number,
): number {
  if (t <= points[0]!.t) return pick(points[0]!);
  const last = points[points.length - 1]!;
  if (t >= last.t) return pick(last);
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    if (t <= end.t) {
      const span = end.t - start.t;
      if (span <= 0) return pick(end);
      const u = ease(end, (t - start.t) / span);
      return pick(start) + (pick(end) - pick(start)) * u;
    }
  }
  return pick(last);
}

export function computeLayerKeyframesVisual(
  keyframes: readonly LayerKeyframe[] | undefined,
  layerLocalSeconds: number,
): {
  transform: ResolvedLayerVisual['transform'] | null;
  crop: ResolvedLayerVisual['crop'] | null;
  perspective: ResolvedLayerVisual['perspective'];
  /** null when no point declares a finite `opacity`; otherwise the interpolation clamped to [0, 1]. */
  opacity: number | null;
} | null {
  const points = (keyframes ?? [])
    .filter((point) => finite(point?.t) && point.t >= 0)
    .slice()
    .sort((left, right) => left.t - right.t);
  if (points.length < 2) return null;
  const t = finite(layerLocalSeconds) ? layerLocalSeconds : 0;
  const transformPoints = points.filter(
    (point) => point.transform && typeof point.transform === 'object',
  );
  const leaf = (name: 'x' | 'y' | 'scale' | 'rotate', fallback: number) =>
    valueAt(
      transformPoints,
      (point) =>
        finite(point.transform?.[name]) ? point.transform[name]! : fallback,
      t,
    );
  const rawScale = transformPoints.length ? leaf('scale', 1) : 1;
  const transform = transformPoints.length
    ? {
        x: leaf('x', 0),
        y: leaf('y', 0),
        scale: rawScale > 0 ? rawScale : 1,
        rotateDegrees: leaf('rotate', 0),
      }
    : null;
  const cropPoints = points.filter(
    (point) =>
      point.crop &&
      finite(point.crop.x) &&
      finite(point.crop.y) &&
      finite(point.crop.w) &&
      point.crop.w > 0 &&
      finite(point.crop.h) &&
      point.crop.h > 0,
  );
  const cropLeaf = (name: 'x' | 'y' | 'w' | 'h') =>
    valueAt(cropPoints, (point) => point.crop![name], t);
  const crop = cropPoints.length
    ? {
        x: cropLeaf('x'),
        y: cropLeaf('y'),
        width: cropLeaf('w'),
        height: cropLeaf('h'),
      }
    : null;
  const perspectivePoints = points.filter(
    (point) =>
      Array.isArray(point.perspective?.corners) &&
      point.perspective!.corners.length === 4 &&
      point.perspective!.corners.every(
        (corner) =>
          corner.length === 2 && finite(corner[0]) && finite(corner[1]),
      ),
  );
  const perspective = perspectivePoints.length
    ? {
        corners: [0, 1, 2, 3].map(
          (index) =>
            [
              valueAt(
                perspectivePoints,
                (point) => point.perspective!.corners[index]![0],
                t,
              ),
              valueAt(
                perspectivePoints,
                (point) => point.perspective!.corners[index]![1],
                t,
              ),
            ] as const,
        ),
      }
    : null;
  const opacityPoints = points.filter((point) => finite(point.opacity));
  const opacity = opacityPoints.length
    ? Math.max(0, Math.min(1, valueAt(opacityPoints, (point) => point.opacity!, t)))
    : null;
  return { transform, crop, perspective, opacity };
}

/** Heckbert unit-square to [TL,TR,BL,BR] quadrilateral matrix, row-major. */
export function cornersToHomography(
  corners: readonly (readonly [number, number])[],
): readonly number[] {
  const [p0, p1, p3, p2] = corners;
  if (!p0 || !p1 || !p2 || !p3)
    throw new Error('perspective requires four corners');
  const [x0, y0] = p0;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = dx3 === 0 && dy3 === 0 ? 0 : (dx3 * dy2 - dx2 * dy3) / den;
  const h = dx3 === 0 && dy3 === 0 ? 0 : (dx1 * dy3 - dx3 * dy1) / den;
  return [
    x1 - x0 + g * x1,
    x3 - x0 + h * x3,
    x0,
    y1 - y0 + g * y1,
    y3 - y0 + h * y3,
    y0,
    g,
    h,
    1,
  ];
}

export function applyHomography(
  matrix: readonly number[],
  x: number,
  y: number,
): readonly [number, number] {
  const w = matrix[6]! * x + matrix[7]! * y + matrix[8]!;
  return [
    (matrix[0]! * x + matrix[1]! * y + matrix[2]!) / w,
    (matrix[3]! * x + matrix[4]! * y + matrix[5]!) / w,
  ];
}

export function invertMat3(matrix: readonly number[]): readonly number[] {
  if (matrix.length !== 9) throw new Error('mat3 requires exactly nine values');
  const a = matrix[0]!;
  const b = matrix[1]!;
  const c = matrix[2]!;
  const d = matrix[3]!;
  const e = matrix[4]!;
  const f = matrix[5]!;
  const g = matrix[6]!;
  const h = matrix[7]!;
  const i = matrix[8]!;
  const cofactor00 = e * i - f * h;
  const cofactor10 = f * g - d * i;
  const cofactor20 = d * h - e * g;
  const det = a * cofactor00 + b * cofactor10 + c * cofactor20;
  if (Math.abs(det) < 1e-12) throw new Error('perspective matrix is singular');
  return [
    cofactor00 / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    cofactor10 / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    cofactor20 / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
}
