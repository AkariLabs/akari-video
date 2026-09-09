/** カード用の波形を、尺に応じて最大 4 行に折り返す。 */
export function waveformCardFilter(durationSeconds: number | undefined, size = 640): string {
    const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : undefined;
    const rows = duration === undefined ? 1 : Math.min(4, Math.max(1, Math.ceil(duration / 30)));
    const height = Math.floor(size / rows);
    const wave = `showwavespic=s=${size}x${height}:colors=0d6efd:draw=full:scale=sqrt`;
    if (rows === 1) {
        return wave;
    }
    const audioLabels = Array.from({ length: rows }, (_, row) => `[a${row}]`);
    const videoLabels = Array.from({ length: rows }, (_, row) => `[v${row}]`);
    const filters = audioLabels.map((label, row) =>
        `${label}atrim=${duration * row / rows}:${duration * (row + 1) / rows},asetpts=PTS-STARTPTS,${wave}${videoLabels[row]}`);
    return [
        `[0:a]asplit=${rows}${audioLabels.join('')}`,
        ...filters,
        `${videoLabels.join('')}vstack=inputs=${rows}`
    ].join(';');
}
