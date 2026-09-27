export const CAPTION_WORD_STYLES = [
    { id: 'karaoke', label: 'カラオケ' }, { id: 'pop', label: 'ポップ' },
    { id: 'reveal', label: '1 行ずつ' }, { id: 'reveal-word', label: '1 語ずつ' }
] as const;

export const CAPTION_EMPHASIS_STYLES = [
    { id: 'one-char-bang', label: '1 文字ドン', emotion: 'surprise' },
    { id: 'one-char-jumble', label: 'ごちゃ混ぜ', emotion: 'disgust' },
    { id: 'size-pulse', label: '大きさの脈動', emotion: 'emphasis' },
    { id: 'color-accent', label: '色の強調', emotion: 'emphasis' },
    { id: 'color-only', label: '色だけ', emotion: 'emphasis' },
    { id: 'outline-bold', label: '縁取り太字', emotion: 'emphasis' },
    { id: 'danger', label: '危険', emotion: 'anger' },
    { id: 'positive', label: '肯定', emotion: 'joy' },
    { id: 'highlight', label: 'ハイライト', emotion: 'emphasis' }
] as const;

export interface CaptionMotionWord { text: string; start: number; end: number }
export interface CaptionMotionCue {
    id: string;
    style?: string;
    text_style?: { color?: string };
    words: CaptionMotionWord[];
    src?: string;
    time_domain?: string;
}

function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function readCaptionMotionCue(source: string, captionId: string): CaptionMotionCue {
    const document = JSON.parse(source) as unknown;
    const rows = Array.isArray(document) ? document : object(document) ? document.captions : undefined;
    if (!Array.isArray(rows)) throw new Error('字幕データを読み取れません。');
    const raw = rows.find(row => object(row) && row.id === captionId);
    if (!object(raw)) throw new Error('字幕が見つかりません。');
    const words = Array.isArray(raw.words) ? raw.words.filter(word => object(word)
        && typeof word.text === 'string' && Number.isFinite(word.start) && Number.isFinite(word.end)
        && Number(word.start) >= 0 && Number(word.end) > Number(word.start)) as CaptionMotionWord[] : [];
    return { id: captionId, words,
        ...(typeof raw.style === 'string' ? { style: raw.style } : {}),
        ...(object(raw.text_style) ? { text_style: { color: typeof raw.text_style.color === 'string'
            ? raw.text_style.color : undefined } } : {}),
        ...(typeof raw.src === 'string' && raw.src.trim() ? { src: raw.src } : {}),
        ...(typeof raw.time_domain === 'string' ? { time_domain: raw.time_domain } : {}) };
}

/** Existing unrelated records and caption fields are retained. Array roots become object roots. */
export function upsertCaptionEmphasis(source: string, captionId: string, wordIndex: number,
    style: typeof CAPTION_EMPHASIS_STYLES[number]['id']): string {
    const cue = readCaptionMotionCue(source, captionId);
    if (cue.time_domain === 'output') throw new Error('出力時間軸の字幕は語の source 時刻を確定できません。');
    const word = cue.words[wordIndex];
    if (!word) throw new Error('強調する語を選んでください。');
    const definition = CAPTION_EMPHASIS_STYLES.find(item => item.id === style);
    if (!definition) throw new Error('強調の種類を選んでください。');
    const raw = JSON.parse(source) as unknown;
    const document: Record<string, unknown> = Array.isArray(raw) ? { captions: raw } : raw as Record<string, unknown>;
    const entries = Array.isArray(document.emphasis_words) ? [...document.emphasis_words] : [];
    const sameWord = (entry: unknown): boolean => object(entry)
        && entry.word === word.text && entry.t_start === word.start && entry.t_end === word.end
        && (entry.src ?? undefined) === cue.src;
    const index = entries.findIndex(sameWord);
    const existing = index >= 0 && object(entries[index]) ? entries[index] as Record<string, unknown> : undefined;
    const used = new Set(entries.filter(object).map(entry => entry.id));
    let id = existing?.id;
    if (typeof id !== 'string') {
        for (let number = 1; number <= 9999; number++) {
            const candidate = `e-${String(number).padStart(4, '0')}`;
            if (!used.has(candidate)) { id = candidate; break; }
        }
    }
    if (typeof id !== 'string') throw new Error('強調の ID を採番できません。');
    const next = { ...(existing ?? {}), id, word: word.text, t_start: word.start, t_end: word.end,
        ...(cue.src ? { src: cue.src } : {}), emotion: definition.emotion, style_hint: style };
    if (index >= 0) entries[index] = next;
    else entries.push(next);
    document.emphasis_words = entries;
    return `${JSON.stringify(document, null, 2)}\n`;
}

export function readOwnerMotion(editSource: string, ownerId: string, fallbackSeconds: number): {
    id: string; motion?: Record<string, unknown>; durationFrames: number
} {
    const document = JSON.parse(editSource) as Record<string, unknown>;
    const find = (items: unknown): Record<string, unknown> | undefined => {
        if (!Array.isArray(items)) return undefined;
        for (const entry of items) {
            if (!object(entry)) continue;
            if (entry.id === ownerId) return entry;
            const nested = find(entry.items);
            if (nested) return nested;
        }
        return undefined;
    };
    const tracks = Array.isArray(document.tracks) ? document.tracks : [];
    const item = tracks.map(track => object(track) ? find(track.items) : undefined).find(Boolean);
    if (!item) throw new Error('字幕の袋が見つかりません。');
    const output = object(document.output) ? document.output : {};
    const fps = Number(output.fps ?? 30);
    const duration = Number(item.duration ?? fallbackSeconds);
    return { id: ownerId,
        ...(object(item.motion) ? { motion: item.motion } : {}),
        durationFrames: Math.max(1, Math.round(duration * (Number.isFinite(fps) && fps > 0 ? fps : 30))) };
}
