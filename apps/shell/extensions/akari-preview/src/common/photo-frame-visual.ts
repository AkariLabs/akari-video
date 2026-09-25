export interface PhotoFrameVisualInput {
    crop: { x: number; y: number; w: number; h: number; rotate?: number };
    frame?: { stroke?: { color: string; width: number }; cornerRadius?: number };
    sourceWidth: number;
    sourceHeight: number;
    scaleX: number;
    scaleY: number;
    outputWidth: number;
    outputHeight: number;
    x: number;
    y: number;
    rotate: number;
    flip?: { h?: boolean; v?: boolean };
}

/** Build the crop clip and inner border in output pixels, before the item's outer rotation. */
export function photoFrameVisual(input: PhotoFrameVisualInput): {
    clipPath: string;
    mediaMatrix: string;
    ghostMatrix: string;
    box: { left: number; top: number; width: number; height: number; rotate: number };
    radiusPx: number;
    strokePx: number;
    color: string;
} {
    const { crop, frame, sourceWidth: sw, sourceHeight: sh, scaleX: sx, scaleY: sy,
        outputWidth: ow, outputHeight: oh } = input;
    const width = crop.w * sw * sx, height = crop.h * sh * sy;
    const radiusPx = Math.min(width, height) * Math.max(0, Math.min(100, frame?.cornerRadius ?? 0)) / 200;
    const strokePx = Math.max(0, Math.min(100, frame?.stroke?.width ?? 0)) * ow / 1920;
    const cropAngle = (crop.rotate ?? 0) * Math.PI / 180;
    const c = Math.cos(cropAngle), s = Math.sin(cropAngle);
    const fx = input.flip?.h ? -1 : 1, fy = input.flip?.v ? -1 : 1;
    const matrix = (degrees: number): string => {
        const a = degrees * Math.PI / 180, cg = Math.cos(a), sg = Math.sin(a);
        return `matrix(${cg * fx * c - sg * fy * sy / sx * s}, ${sg * fx * c + cg * fy * sy / sx * s}, `
            + `${-cg * fx * sx / sy * s - sg * fy * c}, ${-sg * fx * sx / sy * s + cg * fy * c}, 0, 0)`;
    };
    const halfW = width / 2, halfH = height / 2;
    const points: [number, number][] = [];
    if (radiusPx <= 0) {
        points.push([-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]);
    } else {
        for (const [cx, cy, start] of [
            [-halfW + radiusPx, -halfH + radiusPx, Math.PI],
            [halfW - radiusPx, -halfH + radiusPx, Math.PI * 1.5],
            [halfW - radiusPx, halfH - radiusPx, 0],
            [-halfW + radiusPx, halfH - radiusPx, Math.PI * .5]
        ]) {
            for (let step = 0; step <= 16; step++) {
                const angle = start + step * Math.PI / 32;
                points.push([cx + radiusPx * Math.cos(angle), cy + radiusPx * Math.sin(angle)]);
            }
        }
    }
    const centerX = crop.x + crop.w / 2, centerY = crop.y + crop.h / 2;
    const clipPath = `polygon(${points.map(([dx, dy]) => {
        const srcX = (c * dx / sx + s * dy / sy) / sw + centerX;
        const srcY = (-s * dx / sx + c * dy / sy) / sh + centerY;
        return `${srcX * 100}% ${srcY * 100}%`;
    }).join(', ')})`;
    return {
        clipPath, mediaMatrix: matrix(input.rotate), ghostMatrix: matrix(0),
        box: { left: ow / 2 + input.x - halfW, top: oh / 2 + input.y - halfH,
            width, height, rotate: input.rotate },
        radiusPx, strokePx, color: frame?.stroke?.color ?? '#ffffff'
    };
}
