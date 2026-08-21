import { AudioMediaItemV2, EditV2, ItemV2, readEditV2 } from './edit-v2';

/**
 * v2 の出力フレーム格子を変更し、すべての出力側時刻を境界丸めで再スケールする。
 * 素材側の source.in / source.out（秒）は変更しない。
 *
 * この変換は量子化を伴うため非可逆であり、fpsOld → fpsNew → fpsOld で元には戻らない。
 * 文字列入力も受け付けるが、返り値は常に検証済みの v2 オブジェクトである。
 */
export function retime(source: string | unknown, fpsNew: number): EditV2 {
    if (!Number.isInteger(fpsNew) || fpsNew < 1) {
        throw new Error(`fpsNew は 1 以上の整数である必要があります: ${String(fpsNew)}`);
    }
    const parsed = typeof source === 'string' ? JSON.parse(source) as unknown : source;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        && (parsed as Record<string, unknown>).version !== 2) {
        throw new Error('retime は edit.json v2 専用です（v0/v1 は対象外です）。');
    }
    const edit = readEditV2(parsed);
    const ratio = fpsNew / edit.output.fps;
    return {
        version: 2,
        output: { ...edit.output, fps: fpsNew },
        sources: edit.sources.map(entry => ({ ...entry })),
        tracks: edit.tracks.map(track => {
            if (!('items' in track)) {
                const { z: _z, ...contentTrack } = track;
                return { ...contentTrack, content: { ...track.content } };
            }
            const { z: _z, ...itemsTrack } = track;
            if (track.lane === 'audio') {
                return {
                    ...itemsTrack,
                    lane: 'audio' as const,
                    items: track.items.map(item => retimeAudioItem(item, ratio))
                };
            }
            let downstreamShift = 0;
            let previousAt: number | undefined;
            const items = track.items.map(item => {
                let at = Math.round(item.at * ratio) + downstreamShift;
                let end = Math.round((item.at + item.duration) * ratio) + downstreamShift;

                // 丸めで同値になった開始境界は、宣言順を保ったまま 1 フレームずつ離す。
                if (previousAt !== undefined && at === previousAt) {
                    const push = previousAt + 1 - at;
                    at += push;
                    end += push;
                    downstreamShift += push;
                }

                // 0 フレーム尺は 1 に切り上げ、その増分を同じトラックの後続へ伝播する。
                let duration = end - at;
                if (duration < 1) {
                    const push = 1 - duration;
                    duration = 1;
                    downstreamShift += push;
                }
                previousAt = at;
                return retimeItem(item, at, duration, ratio);
            });
            return { ...itemsTrack, items };
        }) as EditV2['tracks']
    };
}

function retimeAudioItem(item: AudioMediaItemV2, ratio: number): AudioMediaItemV2 {
    const at = Math.round(item.at * ratio);
    const duration = item.duration === 0
        ? 0
        : Math.max(1, Math.round((item.at + item.duration) * ratio) - at);
    return { ...item, at, duration, source: { ...item.source } };
}

function retimeItem(item: ItemV2, at: number, duration: number, ratio: number): ItemV2 {
    return {
        ...item,
        at,
        duration,
        ...(item.transform !== undefined ? { transform: { ...item.transform } } : {}),
        ...(item.crop !== undefined ? { crop: { ...item.crop } } : {}),
        ...(item.keyframes !== undefined
            ? {
                keyframes: item.keyframes.map(keyframe => ({
                    ...keyframe,
                    t: Math.round(keyframe.t * ratio),
                    ...(keyframe.transform !== undefined ? { transform: { ...keyframe.transform } } : {}),
                    ...(keyframe.crop !== undefined ? { crop: { ...keyframe.crop } } : {}),
                    ...(keyframe.perspective !== undefined ? { perspective: { ...keyframe.perspective } } : {})
                }))
            }
            : {}),
        source: { ...item.source }
    } as ItemV2;
}
