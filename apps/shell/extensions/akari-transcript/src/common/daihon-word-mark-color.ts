function luminance(color: string): number | undefined {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(color);
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/iu.exec(color);
    if (!hex && (!rgb || rgb[4] !== undefined && Number(rgb[4]) < 1)) return undefined;
    const channels = hex ? hex[1].length === 3
        ? [0, 1, 2].map(offset => parseInt(hex[1][offset] + hex[1][offset], 16) / 255)
        : [0, 2, 4].map(offset => parseInt(hex[1].slice(offset, offset + 2), 16) / 255)
        : [Number(rgb![1]), Number(rgb![2]), Number(rgb![3])].map(value => value / 255);
    const linear = channels
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function readableWordMarkColor(color: string, background: string): boolean {
    const foregroundLight = luminance(color);
    const backgroundLight = luminance(background);
    if (foregroundLight === undefined || backgroundLight === undefined) return false;
    const contrast = (Math.max(foregroundLight, backgroundLight) + 0.05)
        / (Math.min(foregroundLight, backgroundLight) + 0.05);
    return contrast >= 3;
}

type WordMark = string | { color?: string; background?: string } | undefined;
export function changedWordMarkRows(previous?: Map<string, WordMark[]>, next?: Map<string, WordMark[]>): Set<string> {
    const changed = new Set<string>();
    for (const id of new Set([...(previous?.keys() ?? []), ...(next?.keys() ?? [])])) {
        const marks = next?.get(id) ?? [];
        const before = previous?.get(id) ?? [];
        if (before.length !== marks.length || marks.some((mark, index) => {
            const old = before[index];
            return typeof mark === 'object' && mark !== null
                ? typeof old !== 'object' || old === null || mark.color !== old.color
                    || mark.background !== old.background
                : mark !== old;
        })) changed.add(id);
    }
    return changed;
}
