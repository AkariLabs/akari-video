/** fixed 配置のメニューを、描画後に測った実寸で表示領域へ収める。 */
export function contextMenuPosition(
    anchor: { x: number; y: number }, size: { width: number; height: number },
    viewport: { width: number; height: number }, margin = 4
): { left: number; top: number } {
    const clamp = (at: number, length: number, limit: number): number =>
        Math.max(margin, Math.min(at, Math.max(margin, limit - length - margin)));
    return { left: clamp(anchor.x, size.width, viewport.width), top: clamp(anchor.y, size.height, viewport.height) };
}
