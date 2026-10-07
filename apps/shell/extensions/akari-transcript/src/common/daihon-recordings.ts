export interface CaptionRecording {
    itemId: string;
    atSec: number;
    engine: 'microphone' | 'tts' | 'other';
    script?: string;
    path?: string;
}

type RecordObject = Record<string, unknown>;

function object(value: unknown): RecordObject | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as RecordObject : undefined;
}

function engineOf(provenance: unknown): CaptionRecording['engine'] {
    const details = object(provenance);
    if (details?.engine === 'microphone') return 'microphone';
    return typeof details?.provider === 'string' && details.provider !== 'human' ? 'tts' : 'other';
}

export function captionRecordingsFromEdit(edit: unknown, fps: number): Map<string, CaptionRecording[]> {
    const result = new Map<string, CaptionRecording[]>();
    const root = object(edit);
    if (!root) return result;
    const add = (captionRef: unknown, itemId: unknown, atSec: unknown, provenance: unknown,
        script: unknown, path: unknown): void => {
        if (typeof captionRef !== 'string' || typeof itemId !== 'string'
            || typeof atSec !== 'number' || !Number.isFinite(atSec) || atSec < 0) return;
        const recording: CaptionRecording = { itemId, atSec, engine: engineOf(provenance) };
        if (typeof script === 'string') recording.script = script;
        if (typeof path === 'string') recording.path = path;
        const list = result.get(captionRef) ?? [];
        list.push(recording);
        result.set(captionRef, list);
    };

    const paths = new Map<string, string>();
    if (Array.isArray(root.sources)) {
        for (const source of root.sources) {
            const entry = object(source);
            if (typeof entry?.id === 'string' && typeof entry.path === 'string') paths.set(entry.id, entry.path);
        }
    }
    if (Array.isArray(root.tracks) && Number.isFinite(fps) && fps > 0) {
        for (const track of root.tracks) {
            const items = object(track)?.items;
            if (!Array.isArray(items)) continue;
            for (const candidate of items) {
                const item = object(candidate);
                if (!item || (item.role !== 'speech' && item.role !== 'narration')) continue;
                const src = object(item.source)?.src;
                add(item.caption_ref, item.id, typeof item.at === 'number' ? item.at / fps : undefined,
                    item.provenance, item.script, typeof src === 'string' ? paths.get(src) : undefined);
            }
        }
    }
    const narration = object(root.audio)?.narration;
    if (Array.isArray(narration)) {
        for (const candidate of narration) {
            const item = object(candidate);
            if (item) add(item.caption_ref, item.id, item.t, item.provenance, item.script, item.path);
        }
    }
    for (const list of result.values()) list.sort((a, b) => a.atSec - b.atSec);
    return result;
}

export function recordedBadge(recordings: readonly CaptionRecording[] | undefined, rowText: string):
    { label: string; stale: boolean; title: string; atSec: number } | undefined {
    const microphone = recordings?.filter(recording => recording.engine === 'microphone');
    if (!microphone?.length) return undefined;
    const latest = microphone[microphone.length - 1];
    const stale = latest.script !== undefined
        && latest.script.replace(/\s+/g, '') !== rowText.replace(/\s+/g, '');
    const label = `🎙 録音済み${microphone.length > 1 ? ` ×${microphone.length}` : ''}${stale ? ' · 文が変わりました' : ''}`;
    const tenths = Math.round(latest.atSec * 10);
    const time = `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
    const name = latest.path?.split(/[\\/]/).pop();
    const title = `録音 ${microphone.length} 本 · 最新 ${time}${name ? `（${name}）` : ''}。押すとその位置へ`;
    return { label, stale, title, atSec: latest.atSec };
}
