export interface PreviewShapePayload {
    kind: 'shape';
    preset: string;
    name?: string;
    vb?: readonly [number, number];
}

export function previewShapePayload(value: unknown): PreviewShapePayload | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    if (candidate.kind !== 'shape' || typeof candidate.preset !== 'string' || !candidate.preset.trim()) return undefined;
    const vb = candidate.vb;
    return { kind: 'shape', preset: candidate.preset,
        ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}),
        ...(Array.isArray(vb) && vb.length === 2 && vb.every(part => typeof part === 'number' && Number.isFinite(part) && part > 0)
            ? { vb: [vb[0], vb[1]] as [number, number] } : {}) };
}

/** 図形の既定寸と同じく、長い辺を出力の短辺の 1/3 にする。 */
export function previewShapeDropBox(output: { width: number; height: number }, vb?: readonly [number, number]): {
    width: number; height: number
} | undefined {
    if (!(output.width > 0) || !(output.height > 0)) return undefined;
    const [w, h] = vb ?? [1, 1];
    const side = Math.max(1, Math.round(Math.min(output.width, output.height) / 3));
    return w >= h ? { width: side, height: Math.max(1, Math.round(side * h / w)) }
        : { width: Math.max(1, Math.round(side * w / h)), height: side };
}
