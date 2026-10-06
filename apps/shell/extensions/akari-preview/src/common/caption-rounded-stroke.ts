/** Convert a CSS stroke declaration to a round outline with the same outward radius. */
export function roundedCaptionStrokeShadows(stroke: string, originalShadow?: string): string | null {
    const match = /^\s*([\d.]+)px\s+(.+?)\s*$/u.exec(stroke);
    if (!match) return null;
    const width = Number(match[1]);
    if (!Number.isFinite(width) || width <= 0 || width > 1000) return null;
    const radius = width / 2;
    const color = match[2];
    const circle = Array.from({ length: 32 }, (_, index) => {
        const angle = index * Math.PI / 16;
        const x = Number((Math.cos(angle) * radius).toFixed(3));
        const y = Number((Math.sin(angle) * radius).toFixed(3));
        return `${x}px ${y}px 0 ${color}`;
    }).join(',');
    return originalShadow && originalShadow !== 'none' ? `${circle},${originalShadow}` : circle;
}
