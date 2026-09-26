/**
 * プレビューで「動きを描く」中の overlayWrite の選別。
 *
 * overlay-runtime の interaction.js は document capture で pointerdown を拾うため、描画の
 * ポインタ操作と通常のドラッグが並走し、pointerup で通常ドラッグの transform 書き込みが
 * もう 1 回出る（実測: 書き込み 2 回・undo 1 回で戻らない）。描画中（と描画直後の同じ
 * pointerup 処理）は、道筋の xyKeyframes を含まない transform だけの書き込みを捨てる。
 */
export function motionDrawWriteGuard(patch: unknown): boolean {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
    const record = patch as Record<string, unknown>;
    return 'transform' in record && !('xyKeyframes' in record) && record.duplicate !== true;
}
