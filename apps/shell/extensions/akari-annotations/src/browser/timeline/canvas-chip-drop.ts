/** チップのドラッグ結果。時刻と尺は整数フレームで確定する。 */
export function canvasChipDropPatch(
    item: { at: number; duration: number }, deltaFrames: number, edge: 'body' | 'right'
): { at: number } | { duration: number } {
    if (!Number.isInteger(deltaFrames)) throw new Error('移動量は整数フレームで指定してください。');
    return edge === 'right'
        ? { duration: Math.max(1, item.duration + deltaFrames) }
        : { at: Math.max(0, item.at + deltaFrames) };
}

/** フレームへ丸め、整数秒から 1 フレーム以内の端だけ整数秒へ吸い付ける。 */
export function canvasRangeFrames(start: number, end: number, fps: number): { at: number; duration: number } {
    const edge = (seconds: number): number => {
        const frame = Math.max(0, Math.round(seconds * fps));
        const wholeSecond = Math.max(0, Math.round(seconds) * fps);
        return Math.abs(frame - wholeSecond) <= 1 ? wholeSecond : frame;
    };
    const at = edge(start);
    return { at, duration: Math.max(1, edge(end) - at) };
}
