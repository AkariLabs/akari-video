export async function writeCaptionWeightOptimistically<T extends { ok: boolean }>(
    previous: string,
    next: string,
    paint: (value: string) => void,
    preview: (state: 'start' | 'committed' | 'failed', weight: number) => void,
    write: () => Promise<T>,
    isLatest: () => boolean,
    isSelected: () => boolean = () => true
): Promise<T> {
    const weight = Number(next);
    paint(next);
    preview('start', weight);
    try {
        const result = await write();
        if (isLatest()) {
            if (result.ok) preview('committed', weight);
            else {
                paint(previous);
                preview('failed', weight);
            }
        } else if (!isSelected()) preview('failed', weight);
        return result;
    } catch (error) {
        if (isLatest()) {
            paint(previous);
            preview('failed', weight);
        } else if (!isSelected()) preview('failed', weight);
        throw error;
    }
}
