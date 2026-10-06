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
    text?: string;
    text_style?: { color?: string; karaoke?: CaptionKaraokeSettings };
    words: CaptionMotionWord[];
    src?: string;
    time_domain?: string;
}

export interface CaptionKaraokeSettings {
    done_color?: string;
    fill?: 'char' | 'word' | 'smooth';
    start_index?: number;
}

/** One captions.json write keeps the word mode and its defaults in one undo step. */
export function upsertCaptionKaraoke(source: string, captionId: string,
    settings: CaptionKaraokeSettings, selectStyle = false): string {
    const raw = JSON.parse(source) as unknown;
    const rows = Array.isArray(raw) ? raw : object(raw) ? raw.captions : undefined;
    if (!Array.isArray(rows)) throw new Error('字幕データを読み取れません。');
    const row = rows.find(item => object(item) && item.id === captionId);
    if (!object(row)) throw new Error('字幕が見つかりません。');
    if (selectStyle) row.style = 'karaoke';
    const style = object(row.text_style) ? row.text_style : {};
    const current = object(style.karaoke) ? style.karaoke : {};
    style.karaoke = { ...current, ...settings };
    row.text_style = style;
    return `${JSON.stringify(raw, null, 2)}\n`;
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
    const inherited = object(document) && object(document.default_text_style) ? document.default_text_style : {};
    const own = object(raw.text_style) ? raw.text_style : {};
    const inheritedKaraoke = object(inherited.karaoke) ? inherited.karaoke : undefined;
    const ownKaraoke = object(own.karaoke) ? own.karaoke : undefined;
    const words = Array.isArray(raw.words) ? raw.words.filter(word => object(word)
        && typeof word.text === 'string' && Number.isFinite(word.start) && Number.isFinite(word.end)
        && Number(word.start) >= 0 && Number(word.end) > Number(word.start)) as CaptionMotionWord[] : [];
    return { id: captionId, words,
        ...(typeof raw.display_text === 'string' ? { text: raw.display_text }
            : typeof raw.text === 'string' ? { text: raw.text } : {}),
        ...(typeof raw.style === 'string' ? { style: raw.style } : {}),
        ...(Object.keys(own).length || Object.keys(inherited).length ? { text_style: {
            color: typeof own.color === 'string' ? own.color : typeof inherited.color === 'string' ? inherited.color : undefined,
            ...(inheritedKaraoke || ownKaraoke ? { karaoke: { ...inheritedKaraoke, ...ownKaraoke } as CaptionKaraokeSettings } : {})
        } } : {}),
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
    const duration = Number(item.duration);
    const output = object(document.output) ? document.output : {};
    const fps = Number(output.fps ?? 30);
    return { id: ownerId,
        ...(object(item.motion) ? { motion: item.motion } : {}),
        durationFrames: Math.max(1, Math.round(Number.isFinite(duration) ? duration
            : fallbackSeconds * (Number.isFinite(fps) && fps > 0 ? fps : 30))) };
}
