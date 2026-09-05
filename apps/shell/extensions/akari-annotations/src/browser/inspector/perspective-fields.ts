export type InspectorPerspectiveCorner = 'tl' | 'tr' | 'bl' | 'br';
export type InspectorPerspectiveAxis = 'x' | 'y';
export interface InspectorPerspective { corners: [number, number][]; }

export const INSPECTOR_PERSPECTIVE_IDENTITY: readonly (readonly [number, number])[] = [
    [0, 0], [1, 0], [0, 1], [1, 1]
];

/** 欠けた座標や非有限値だけを補完する。範囲と四角形の検証は別に行う。 */
export function normalizeInspectorPerspective(raw: unknown): [number, number][] {
    const corners = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>).corners : undefined;
    return INSPECTOR_PERSPECTIVE_IDENTITY.map((point, index) => {
        const candidate = Array.isArray(corners) ? corners[index] : undefined;
        return point.map((fallback, axis) => {
            const value = Array.isArray(candidate) ? candidate[axis] : undefined;
            return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
        }) as [number, number];
    });
}

export function isIdentityInspectorPerspective(corners: readonly (readonly number[])[]): boolean {
    return corners.length === 4 && corners.every((point, index) => point.length === 2
        && point.every((value, axis) => value === INSPECTOR_PERSPECTIVE_IDENTITY[index][axis]));
}

export function updateInspectorPerspective(
    raw: unknown,
    corner: InspectorPerspectiveCorner,
    axis: InspectorPerspectiveAxis,
    value: number | null
): InspectorPerspective | null {
    const corners = normalizeInspectorPerspective(raw);
    const index = (['tl', 'tr', 'bl', 'br'] as const).indexOf(corner);
    const coordinate = axis === 'x' ? 0 : 1;
    corners[index][coordinate] = value ?? INSPECTOR_PERSPECTIVE_IDENTITY[index][coordinate];
    return isIdentityInspectorPerspective(corners) ? null : { corners };
}

/** プレビューの validateLayerPerspectivePatch と同じ規則・文言。 */
export function validateInspectorPerspective(corners: unknown): asserts corners is [number, number][] {
    if (!Array.isArray(corners) || corners.length !== 4) {
        throw new Error('perspective.corners は [TL,TR,BL,BR] の 4 要素配列である必要があります。');
    }
    const names = ['TL', 'TR', 'BL', 'BR'];
    for (let i = 0; i < 4; i += 1) {
        const corner = corners[i];
        if (!Array.isArray(corner) || corner.length !== 2) {
            throw new Error(`perspective.corners[${i}] (${names[i]}) は [x, y] の 2 要素配列である必要があります。`);
        }
        const [x, y] = corner;
        if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1) {
            throw new Error(`perspective.corners[${i}] (${names[i]}) は 0 から 1 の範囲の有限数である必要があります。`);
        }
    }
    const [tl, tr, bl, br] = corners;
    const ring = [tl, tr, br, bl];
    let area2 = 0;
    for (let i = 0; i < ring.length; i += 1) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        area2 += x1 * y2 - x2 * y1;
    }
    if (Math.abs(area2) < 1e-4) {
        throw new Error('perspective.corners は退化した四角形（面積がほぼ 0）であってはなりません。');
    }
}
